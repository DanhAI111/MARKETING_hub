import {
  GRAPH_VERSION,
  GRAPH_BASE,
  DEFAULT_SCOPES,
  formatMetaError,
  getGoogleDriveFileId,
  getGoogleDriveFolderId,
  normalizeMediaUrl,
  googleDriveThumbnailUrl,
  decodeHtml,
  listGoogleDriveFolderMedia,
  filenameFromDisposition,
  isVideoName,
  getPostMessage,
  getMediaItems,
  resolveMediaItem,
  resolveMediaItems,
  getOldestSyncDate,
  getFacebookPostThumbnail,
  extractFacebookEngagement,
  extractInstagramEngagement
} from '../shared/meta-helpers.cjs';
import { getPostRetentionCutoff, isWithinPostRetention } from '../shared/repository-helpers.cjs';

// Worker-specific: Blob from a data URL using atob/Uint8Array (no Node Buffer).
const dataUrlToBlob = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
};

const MAX_AUTO_PUBLISH_ATTEMPTS = 8;
// A 100-post Graph payload caused a production Worker request to be killed at
// 195ms CPU. Keep every invocation small; syncAll also receives untrusted query
// parameters from /api/sync, so the cap is enforced here as the final boundary.
const MAX_META_SYNC_POSTS = 25;
const nextRetryAt = (attemptCount = 0) => new Date(
  Date.now() + Math.min(15 * 60_000, 30_000 * (2 ** Math.min(Number(attemptCount) || 0, 5)))
).toISOString();

export class MetaService {
  constructor(env, repo, origin) {
    this.env = env;
    this.repo = repo;
    this.origin = origin;
  }

  configuredScopes() {
    const raw = this.env.META_SCOPES || DEFAULT_SCOPES.join(',');
    return raw.split(',').map((scope) => scope.trim()).filter(Boolean);
  }

  requiredEnv() {
    return {
      appId: this.env.META_APP_ID,
      appSecret: this.env.META_APP_SECRET,
      redirectUri: this.env.META_REDIRECT_URI || `${this.env.PUBLIC_BASE_URL || this.origin}/auth/meta/callback`
    };
  }

  assertConfigured() {
    const configured = this.requiredEnv();
    if (!configured.appId || !configured.appSecret) {
      const error = new Error('META_APP_ID và META_APP_SECRET chưa được cấu hình.');
      error.status = 503;
      throw error;
    }
    return configured;
  }

  graphTimeoutMs() {
    const configured = Number(this.env.META_GRAPH_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(configured, 60_000)
      : 15_000;
  }

  async fetchGraph(url, options) {
    const controller = new AbortController();
    const timeoutMs = this.graphTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...(options || {}), signal: controller.signal });
      let body = {};
      try {
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
      return { response, body };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      const timeoutError = new Error(`Meta Graph request timed out after ${timeoutMs}ms.`);
      timeoutError.code = 'META_GRAPH_TIMEOUT';
      timeoutError.retryable = true;
      timeoutError.cause = error;
      throw timeoutError;
    } finally {
      clearTimeout(timeout);
    }
  }

  authUrl(state) {
    const configured = this.assertConfigured();
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set('client_id', configured.appId);
    url.searchParams.set('redirect_uri', configured.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.configuredScopes().join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('auth_type', 'rerequest');
    return url.toString();
  }

  async graphGet(path, params = {}) {
    // Keep access_token out of the query string (leaks via logs/proxies); Graph API
    // accepts it as an Authorization: Bearer header on GET.
    const { access_token, ...rest } = params;
    const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const { response, body } = await this.fetchGraph(
      url,
      access_token ? { headers: { Authorization: `Bearer ${access_token}` } } : undefined
    );
    if (!response.ok) {
      const error = new Error(formatMetaError(body, `Meta API error ${response.status}`));
      error.status = response.status;
      error.meta = body;
      throw error;
    }
    return body;
  }

  async graphPost(path, params = {}, { multipart = false } = {}) {
    const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
    const body = multipart ? new FormData() : new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        multipart ? body.append(key, value) : body.set(key, value);
      }
    });
    const { response, body: responseBody } = await this.fetchGraph(url, { method: 'POST', body });
    if (!response.ok) {
      const error = new Error(formatMetaError(responseBody, `Meta API error ${response.status}`));
      error.status = response.status;
      error.meta = responseBody;
      throw error;
    }
    return responseBody;
  }

  async addFacebookPhoto({ pageId, token, media, caption = '', published = true }) {
    const dataBlob = dataUrlToBlob(media.url);
    const params = { access_token: token, caption, published: String(published) };
    if (dataBlob) {
      params.source = dataBlob;
      return this.graphPost(`${pageId}/photos`, params, { multipart: true });
    }
    params.url = media.url;
    return this.graphPost(`${pageId}/photos`, params);
  }

  async addFacebookVideo({ pageId, token, media, description = '', published = true }) {
    if (!/^https?:\/\//i.test(media.url)) throw new Error('Facebook video yêu cầu URL tải công khai.');
    return this.graphPost(`${pageId}/videos`, {
      access_token: token,
      file_url: media.url,
      description,
      published: String(published)
    });
  }

  async createInstagramVideoContainer(igId, token, videoUrl, caption) {
    if (!/^https?:\/\//i.test(videoUrl)) {
      throw new Error('Instagram video yêu cầu URL tải công khai (không nhận file local/base64).');
    }
    // IG video = Reels: media_type=REELS + video_url (image path uses image_url).
    return this.graphPost(`${igId}/media`, {
      access_token: token,
      media_type: 'REELS',
      video_url: videoUrl,
      caption
    });
  }

  // Single cheap status check (one graphGet, ~no CPU) for the deferred 2-tick flow.
  // Returns lifecycle details so callers can distinguish retryable expiry from a
  // terminal publish. Blocking poll is NOT allowed in
  // the Worker — it blows Cloudflare's per-invocation CPU budget (publish-stale-root-cause).
  async checkInstagramContainerStatus(containerId, token) {
    const details = await this.graphGet(containerId, {
      access_token: token,
      fields: 'status_code,status'
    });
    const statusCode = String(details.status_code || '').toUpperCase();
    if (statusCode === 'ERROR') {
      throw new Error(details.status || `Instagram xử lý video thất bại (${statusCode.toLowerCase()}).`);
    }
    return { ...details, statusCode };
  }

  async publishFacebookPost(fanpage, post, { published = true } = {}) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.metaPageId) {
      throw new Error('Fanpage Facebook chưa có Page access token. Vui lòng liên kết Meta lại.');
    }
    if (published && this.supportsDurablePublishing(post)) {
      return this.publishFacebookPostDurable(fanpage, post, token);
    }
    const message = getPostMessage(post);
    const mediaItems = await resolveMediaItems(post);
    if (!mediaItems.length) {
      const result = await this.graphPost(`${fanpage.metaPageId}/feed`, {
        access_token: token,
        message,
        ...(published ? {} : { published: 'false' })
      });
      return {
        externalPostId: result.id || '',
        permalink: result.id ? `https://www.facebook.com/${result.id}` : '',
        mediaUrl: ''
      };
    }
    if (mediaItems.length === 1) {
      if (mediaItems[0].type === 'video') {
        const result = await this.addFacebookVideo({
          pageId: fanpage.metaPageId,
          token,
          media: mediaItems[0],
          description: message,
          published
        });
        return {
          externalPostId: result.id || '',
          permalink: result.id ? `https://www.facebook.com/${fanpage.metaPageId}/videos/${result.id}` : '',
          mediaUrl: mediaItems[0].url || ''
        };
      }
      const result = await this.addFacebookPhoto({
        pageId: fanpage.metaPageId,
        token,
        media: mediaItems[0],
        caption: '',
        published: false
      });
      if (!result.id) throw new Error('Không thể tải ảnh lên Facebook.');
      const feedResult = await this.graphPost(`${fanpage.metaPageId}/feed`, {
        access_token: token,
        message,
        ...(published ? {} : { published: 'false' }),
        attached_media: JSON.stringify([{ media_fbid: result.id }])
      });
      return {
        externalPostId: feedResult.id || '',
        permalink: feedResult.id ? `https://www.facebook.com/${feedResult.id}` : '',
        mediaUrl: mediaItems[0].url || ''
      };
    }
    if (mediaItems.some((media) => media.type === 'video')) {
      throw new Error('Mỗi bài Facebook chỉ hỗ trợ một video; không thể trộn video với media khác.');
    }
    const uploaded = [];
    for (const media of mediaItems) {
      const result = await this.addFacebookPhoto({
        pageId: fanpage.metaPageId,
        token,
        media,
        caption: '',
        published: false
      });
      if (result.id) uploaded.push({ media_fbid: result.id });
    }
    if (!uploaded.length) throw new Error('Không thể tải ảnh lên Facebook.');
    const result = await this.graphPost(`${fanpage.metaPageId}/feed`, {
      access_token: token,
      message,
      ...(published ? {} : { published: 'false' }),
      attached_media: JSON.stringify(uploaded)
    });
    return {
      externalPostId: result.id || '',
      permalink: result.id ? `https://www.facebook.com/${result.id}` : '',
      mediaUrl: mediaItems[0]?.url || ''
    };
  }

  // Carousel (2-10 images): one child container per image, then a CAROUSEL container
  // referencing the children. Caption lives on the carousel container only.
  async createInstagramCarouselContainer(igId, token, images, caption) {
    const children = [];
    for (const image of images) {
      const child = await this.graphPost(`${igId}/media`, {
        access_token: token,
        image_url: image.url,
        is_carousel_item: 'true'
      });
      if (!child.id) throw new Error('Meta không trả về container ID cho ảnh trong carousel.');
      children.push(child.id);
    }
    return this.graphPost(`${igId}/media`, {
      access_token: token,
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption
    });
  }

  supportsDurablePublishing(post) {
    return !!(
      post?.id
      && this.repo?.getPublishJob
      && this.repo?.savePublishJob
      && this.repo?.recordPublishAttempt
    );
  }

  async checkpointPublishJob(postId, job, updates, attempt) {
    const saved = await this.repo.savePublishJob(postId, {
      ...updates,
      attemptCount: Number(job?.attemptCount || 0) + 1,
      lastErrorCode: '',
      lastError: '',
      lastErrorAt: ''
    });
    await this.repo.recordPublishAttempt(postId, attempt);
    return saved;
  }

  async deferDurableJob(postId, job, updates, attempt) {
    const saved = await this.checkpointPublishJob(postId, job, {
      ...updates,
      // A durable checkpoint means the previous Meta step succeeded. Keep the
      // short polling delay independent from the number of completed steps so
      // long carousels do not accidentally hit the 15-minute error backoff.
      nextAttemptAt: updates.nextAttemptAt || nextRetryAt(0)
    }, attempt);
    return {
      deferred: true,
      igContainerId: saved.parentContainerId || '',
      publishStage: saved.stage,
      publishProgress: {
        completedChildren: saved.childContainerIds.length,
        totalMedia: saved.resolvedMedia.length
      }
    };
  }

  async handleDurablePublishError(post, job, error) {
    const errorCode = error.code
      || error.meta?.error?.error_subcode
      || error.meta?.error?.code
      || 'PUBLISH_FAILED';
    const attemptCount = Number(job?.attemptCount || 0) + 1;
    const previousAttempts = this.repo.listPublishAttempts
      ? await this.repo.listPublishAttempts(post.id, 500)
      : [];
    const errorAttemptCount = previousAttempts.filter((attempt) => (
      attempt.errorCode && ['deferred', 'failed'].includes(attempt.outcome)
    )).length + 1;
    const retryable = !!error.retryable && errorAttemptCount < MAX_AUTO_PUBLISH_ATTEMPTS;
    const saved = await this.repo.savePublishJob(post.id, {
      attemptCount,
      // Only actual failed/deferred error attempts drive exponential backoff;
      // successful media checkpoints must not make the first error wait 15 min.
      nextAttemptAt: retryable ? nextRetryAt(Math.max(0, errorAttemptCount - 1)) : '',
      lastErrorCode: String(errorCode),
      lastError: error.message || 'Không thể đăng bài',
      lastErrorAt: new Date().toISOString()
    });
    await this.repo.recordPublishAttempt(post.id, {
      stage: saved.stage,
      outcome: retryable ? 'deferred' : 'failed',
      errorCode: String(errorCode),
      errorMessage: error.message || ''
    });
    if (retryable) {
      return {
        deferred: true,
        igContainerId: saved.parentContainerId || '',
        publishStage: saved.stage,
        retryAt: saved.nextAttemptAt
      };
    }
    throw error;
  }

  async publishFacebookPostDurable(fanpage, post, token) {
    let job = await this.repo.getPublishJob(post.id);
    if (job?.platform && job.platform !== 'facebook') {
      throw new Error(`Bài đang có tác vụ ${job.platform}; không thể dùng lại làm tác vụ Facebook.`);
    }
    if (!job) {
      job = await this.repo.savePublishJob(post.id, {
        platform: 'facebook', stage: 'queued', resolvedMedia: [],
        childContainerIds: [], parentContainerId: ''
      });
    }
    try {
      if (job.stage === 'completed') {
        const externalPostId = post.externalPostId || job.parentContainerId || '';
        return {
          externalPostId,
          permalink: post.permalink || (externalPostId ? `https://www.facebook.com/${externalPostId}` : ''),
          mediaUrl: post.mediaUrl || job.resolvedMedia[0]?.url || '',
          recovered: true
        };
      }
      if (job.stage === 'publish_unknown') {
        const error = new Error('Facebook chưa xác nhận kết quả đăng trước đó. Đã dừng tự động để tránh đăng trùng; hãy đối soát trên Page trước khi thao tác lại.');
        error.code = 'FACEBOOK_PUBLISH_UNKNOWN';
        throw error;
      }
      if (job.stage === 'queued') {
        const resolvedMedia = await resolveMediaItems(post);
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'media_resolved', resolvedMedia, childContainerIds: [],
          parentContainerId: '', nextAttemptAt: ''
        }, { stage: 'resolve_media', outcome: 'checkpointed' });
        return { deferred: true, publishStage: job.stage };
      }

      const mediaItems = job.resolvedMedia;
      if (mediaItems.length > 1 && mediaItems.some((media) => media.type === 'video')) {
        throw new Error('Mỗi bài Facebook chỉ hỗ trợ một video; không thể trộn video với media khác.');
      }
      if (mediaItems.length && mediaItems.every((media) => media.type !== 'video')
        && job.childContainerIds.length < mediaItems.length) {
        const media = mediaItems[job.childContainerIds.length];
        const photo = await this.addFacebookPhoto({
          pageId: fanpage.metaPageId, token, media, caption: '', published: false
        });
        if (!photo.id) throw new Error('Không thể tải ảnh lên Facebook.');
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'media_resolved',
          childContainerIds: [...job.childContainerIds, photo.id],
          nextAttemptAt: nextRetryAt(0)
        }, { stage: 'upload_photo', outcome: 'checkpointed' });
        return {
          deferred: true,
          publishStage: job.stage,
          publishProgress: { completedChildren: job.childContainerIds.length, totalMedia: mediaItems.length }
        };
      }

      let published;
      try {
        published = mediaItems.length === 1 && mediaItems[0].type === 'video'
          ? await this.addFacebookVideo({
              pageId: fanpage.metaPageId, token, media: mediaItems[0],
              description: getPostMessage(post), published: true
            })
          : await this.graphPost(`${fanpage.metaPageId}/feed`, {
              access_token: token,
              message: getPostMessage(post),
              ...(job.childContainerIds.length ? {
                attached_media: JSON.stringify(job.childContainerIds.map((mediaFbid) => ({ media_fbid: mediaFbid })))
              } : {})
            });
      } catch (error) {
        if (error.code !== 'META_GRAPH_TIMEOUT') throw error;
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'publish_unknown', nextAttemptAt: nextRetryAt(0)
        }, { stage: 'publish', outcome: 'unknown', errorCode: error.code, errorMessage: error.message });
        return { deferred: true, publishStage: job.stage };
      }
      if (!published?.id) throw new Error('Meta không trả về Facebook post ID.');
      job = await this.checkpointPublishJob(post.id, job, {
        stage: 'completed', externalPostId: published.id,
        parentContainerId: published.id, nextAttemptAt: ''
      }, { stage: 'publish', outcome: 'published' });
      const isVideo = mediaItems[0]?.type === 'video';
      return {
        externalPostId: published.id,
        permalink: isVideo
          ? `https://www.facebook.com/${fanpage.metaPageId}/videos/${published.id}`
          : `https://www.facebook.com/${published.id}`,
        mediaUrl: mediaItems[0]?.url || '',
        publishStage: job.stage
      };
    } catch (error) {
      const latest = await this.repo.getPublishJob(post.id) || job;
      return this.handleDurablePublishError(post, latest, error);
    }
  }

  async publishInstagramPostDurable(fanpage, post, token) {
    let job = await this.repo.getPublishJob(post.id);
    if (job?.platform && job.platform !== 'instagram') {
      throw new Error(`Bài đang có tác vụ Facebook; không thể dùng lại làm tác vụ Instagram.`);
    }
    if (!job) {
      job = await this.repo.savePublishJob(post.id, {
        platform: 'instagram',
        stage: 'queued',
        resolvedMedia: [],
        childContainerIds: [],
        parentContainerId: post.igContainerId || ''
      });
    }
    try {
      if (job.stage === 'completed') {
        return {
          externalPostId: post.externalPostId || job.externalPostId || '',
          permalink: post.permalink || '',
          mediaUrl: post.mediaUrl || job.resolvedMedia[0]?.url || '',
          igContainerId: '',
          recovered: true,
          warning: ''
        };
      }

      if (!job.resolvedMedia.length) {
        const resolvedMedia = await resolveMediaItems(post);
        const publicMedia = resolvedMedia.filter((item) => /^https?:\/\//i.test(item.url || ''));
        if (!publicMedia.length) {
          throw new Error('Instagram Graph API yêu cầu ít nhất một ảnh hoặc video có URL công khai.');
        }
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'media_resolved',
          resolvedMedia: publicMedia,
          childContainerIds: [],
          parentContainerId: '',
          nextAttemptAt: ''
        }, { stage: 'resolve_media', outcome: 'checkpointed' });
        return {
          deferred: true,
          igContainerId: '',
          publishStage: job.stage,
          publishProgress: { completedChildren: 0, totalMedia: publicMedia.length }
        };
      }

      const mediaItems = job.resolvedMedia;
      const media = mediaItems[0];
      const images = mediaItems.filter((item) => item.type !== 'video');

      if (job.parentContainerId && ['container_created', 'publish_unknown'].includes(job.stage)) {
        const lifecycle = await this.checkInstagramContainerStatus(job.parentContainerId, token);
        if (lifecycle.statusCode === 'PUBLISHED') {
          job = await this.checkpointPublishJob(post.id, job, {
            stage: 'completed',
            nextAttemptAt: ''
          }, { stage: 'verify_publish', outcome: 'recovered' });
          return {
            externalPostId: post.externalPostId || '',
            permalink: post.permalink || '',
            mediaUrl: post.mediaUrl || media.url,
            igContainerId: '',
            recovered: true,
            warning: ''
          };
        }
        if (lifecycle.statusCode === 'EXPIRED') {
          job = await this.checkpointPublishJob(post.id, job, {
            stage: 'media_resolved',
            childContainerIds: [],
            parentContainerId: '',
            nextAttemptAt: ''
          }, { stage: 'verify_container', outcome: 'expired' });
          if (this.repo.setPostPublishState) {
            await this.repo.setPostPublishState(post.id, { igContainerId: '' });
          }
          return { deferred: true, igContainerId: '', publishStage: job.stage };
        }
        if (lifecycle.statusCode !== 'FINISHED') {
          return this.deferDurableJob(post.id, job, {
            stage: job.stage
          }, { stage: 'verify_container', outcome: 'processing' });
        }
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'ready',
          nextAttemptAt: ''
        }, { stage: 'verify_container', outcome: 'ready' });
        return {
          deferred: true,
          igContainerId: job.parentContainerId,
          publishStage: job.stage
        };
      }

      if (!job.parentContainerId) {
        if (images.length > 1 && job.childContainerIds.length < images.length) {
          const image = images[job.childContainerIds.length];
          const child = await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
            access_token: token,
            image_url: image.url,
            is_carousel_item: 'true'
          });
          if (!child.id) throw new Error('Meta không trả về container ID cho ảnh trong carousel.');
          return this.deferDurableJob(post.id, job, {
            stage: 'media_resolved',
            childContainerIds: [...job.childContainerIds, child.id]
          }, { stage: 'create_child', outcome: 'checkpointed' });
        }

        let parent;
        if (images.length > 1) {
          parent = await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
            access_token: token,
            media_type: 'CAROUSEL',
            children: job.childContainerIds.join(','),
            caption: getPostMessage(post)
          });
        } else if (media.type === 'video') {
          parent = await this.createInstagramVideoContainer(
            fanpage.instagramBusinessId,
            token,
            media.url,
            getPostMessage(post)
          );
        } else {
          parent = await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
            access_token: token,
            image_url: media.url,
            caption: getPostMessage(post)
          });
        }
        if (!parent?.id) throw new Error('Meta không trả về Instagram container ID.');
        job = await this.checkpointPublishJob(post.id, job, {
          stage: 'container_created',
          parentContainerId: parent.id,
          nextAttemptAt: ''
        }, { stage: 'create_parent', outcome: 'checkpointed' });
        if (this.repo.setPostPublishState) {
          await this.repo.setPostPublishState(post.id, { igContainerId: parent.id });
        }
        return {
          deferred: true,
          igContainerId: parent.id,
          publishStage: job.stage
        };
      }

      if (job.stage !== 'ready') {
        return this.deferDurableJob(post.id, job, {
          stage: 'container_created'
        }, { stage: 'resume', outcome: 'deferred' });
      }

      let published;
      try {
        published = await this.graphPost(`${fanpage.instagramBusinessId}/media_publish`, {
          access_token: token,
          creation_id: job.parentContainerId
        });
      } catch (error) {
        const code = error.meta?.error?.code;
        const subcode = error.meta?.error?.error_subcode;
        if (error.code === 'META_GRAPH_TIMEOUT') {
          return this.deferDurableJob(post.id, job, {
            stage: 'publish_unknown'
          }, {
            stage: 'media_publish', outcome: 'unknown',
            errorCode: error.code, errorMessage: error.message
          });
        }
        if (code === 9007 || subcode === 2207027) {
          return this.deferDurableJob(post.id, job, {
            stage: 'container_created'
          }, {
            stage: 'media_publish', outcome: 'not_ready',
            errorCode: String(subcode || code), errorMessage: error.message
          });
        }
        throw error;
      }
      job = await this.checkpointPublishJob(post.id, job, {
        stage: 'completed',
        externalPostId: published.id || '',
        nextAttemptAt: ''
      }, { stage: 'media_publish', outcome: 'published' });
      return {
        externalPostId: published.id || '',
        permalink: '',
        mediaUrl: media.url,
        igContainerId: '',
        publishStage: job.stage,
        warning: media.type === 'video' && mediaItems.length > 1
          ? `Instagram: bài video chỉ đăng video đầu (${mediaItems.length} media)`
          : ''
      };
    } catch (error) {
      const latest = await this.repo.getPublishJob(post.id) || job;
      return this.handleDurablePublishError(post, latest, error);
    }
  }

  async publishInstagramPost(fanpage, post, { durable = true } = {}) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.instagramBusinessId) {
      throw new Error('Tài khoản Instagram chưa có Instagram Business ID/Page token. Vui lòng liên kết Meta lại.');
    }
    if (durable && this.supportsDurablePublishing(post)) {
      return this.publishInstagramPostDurable(fanpage, post, token);
    }
    const mediaItems = await resolveMediaItems(post);
    const media = mediaItems[0];
    if (!media?.url) throw new Error('Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.');
    const publicItems = mediaItems.filter((item) => /^https?:\/\//i.test(item.url || ''));
    if (!publicItems.length) {
      throw new Error('Instagram Graph API không nhận file local/base64. Vui lòng dùng URL ảnh công khai.');
    }
    const images = publicItems.filter((item) => item.type !== 'video');
    // IG media processes async server-side (video 30-90s; images usually instant, but a
    // slow source like a Drive download can lag). Polling to FINISHED inside one cron tick
    // blows Cloudflare's CPU budget, so we defer across ticks: create the container, park
    // its id (post stays 'scheduled' → re-claimed next tick); later ticks do one cheap
    // status check and publish once FINISHED. See migrations/0012_ig_video_container.sql.
    let containerId = post.igContainerId || '';
    if (containerId) {
      let lifecycle;
      try {
        lifecycle = await this.checkInstagramContainerStatus(containerId, token);
      } catch (error) {
        if (error.code === 'META_GRAPH_TIMEOUT') {
          return { deferred: true, igContainerId: containerId };
        }
        throw error;
      }
      if (lifecycle.statusCode === 'PUBLISHED') {
        return {
          externalPostId: post.externalPostId || '',
          permalink: post.permalink || '',
          mediaUrl: post.mediaUrl || media.url,
          igContainerId: '',
          recovered: true,
          warning: ''
        };
      }
      if (lifecycle.statusCode === 'EXPIRED') containerId = '';
      else if (lifecycle.statusCode !== 'FINISHED') {
        return { deferred: true, igContainerId: containerId };
      }
    }
    if (!containerId) {
      let created;
      try {
        created = media.type === 'video'
          ? await this.createInstagramVideoContainer(
              fanpage.instagramBusinessId,
              token,
              media.url,
              getPostMessage(post)
            )
          : images.length > 1
            ? await this.createInstagramCarouselContainer(
                fanpage.instagramBusinessId,
                token,
                images,
                getPostMessage(post)
              )
            : await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
                access_token: token,
                image_url: (images[0] || publicItems[0]).url,
                caption: getPostMessage(post)
              });
      } catch (error) {
        if (error.code === 'META_GRAPH_TIMEOUT') return { deferred: true, igContainerId: '' };
        throw error;
      }
      if (!created?.id) throw new Error('Meta không trả về Instagram container ID.');
      containerId = created.id;
      if (post.id && this.repo.setPostPublishState) {
        await this.repo.setPostPublishState(post.id, { igContainerId: containerId });
      }
      if (media.type === 'video') return { deferred: true, igContainerId: containerId };
    }
    let published;
    try {
      published = await this.graphPost(`${fanpage.instagramBusinessId}/media_publish`, {
        access_token: token,
        creation_id: containerId
      });
    } catch (error) {
      // Meta 9007/2207027 "Media ID is not available" = container still processing
      // (seen in prod with image containers sourced from slow Drive URLs). Not a
      // failure — park the container and publish on a later tick.
      const code = error.meta?.error?.code;
      const subcode = error.meta?.error?.error_subcode;
      if (error.code === 'META_GRAPH_TIMEOUT' || code === 9007 || subcode === 2207027) {
        return { deferred: true, igContainerId: containerId };
      }
      throw error;
    }
    const details = published.id
      ? await this.graphGet(published.id, { access_token: token, fields: 'permalink,media_url' }).catch(() => ({}))
      : {};
    return {
      externalPostId: published.id || '',
      permalink: details.permalink || '',
      mediaUrl: details.media_url || media.url,
      igContainerId: '', // published → clear the mid-flight marker
      // resolveMediaItems caps at 10 (= Meta's carousel limit); video posts carry one video.
      warning: media.type === 'video' && mediaItems.length > 1
        ? `Instagram: bài video chỉ đăng video đầu (${mediaItems.length} media)`
        : ''
    };
  }

  async testInstagramPost(fanpage, post) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.instagramBusinessId) {
      throw new Error('Tài khoản Instagram chưa có Instagram Business ID/Page token. Vui lòng liên kết Meta lại.');
    }
    const mediaItems = getMediaItems(post);
    const media = (await resolveMediaItem(mediaItems[0]))[0];
    if (!media?.url) throw new Error('Instagram yêu cầu ít nhất một ảnh có URL công khai để kiểm tra.');
    if (!/^https?:\/\//i.test(media.url)) {
      throw new Error('Instagram Graph API không nhận file local/base64. Vui lòng dùng URL ảnh công khai.');
    }
    const container = media.type === 'video'
      ? await this.createInstagramVideoContainer(fanpage.instagramBusinessId, token, media.url, getPostMessage(post))
      : await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
          access_token: token,
          image_url: media.url,
          caption: getPostMessage(post)
        });
    if (!container.id) throw new Error('Meta không trả về Instagram container ID.');

    let details = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      details = await this.graphGet(container.id, {
        access_token: token,
        fields: 'id,status_code,status'
      });
      const statusCode = String(details.status_code || '').toUpperCase();
      if (!['IN_PROGRESS', ''].includes(statusCode)) break;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const statusCode = String(details.status_code || 'CREATED').toUpperCase();
    if (['ERROR', 'EXPIRED'].includes(statusCode)) {
      throw new Error(details.status || `Instagram container ${statusCode.toLowerCase()}.`);
    }
    if (statusCode !== 'FINISHED') {
      throw new Error(`Instagram chưa xác nhận media hợp lệ (trạng thái ${statusCode}). Hãy thử lại sau.`);
    }
    return {
      containerId: container.id,
      statusCode,
      status: details.status || '',
      mediaUrl: media.url
    };
  }

  async testScheduledPost(post) {
    const fanpage = await this.repo.getFanpage(post.fanpageId);
    if (!fanpage) throw new Error('Không tìm thấy fanpage để kiểm tra đăng bài.');
    if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');

    const completedAt = new Date().toISOString();
    if (fanpage.platform === 'facebook') {
      const fbResult = post.externalPostId
        ? { externalPostId: post.externalPostId, permalink: post.permalink || '', mediaUrl: post.mediaUrl || '' }
        : await this.publishFacebookPost(fanpage, post, { published: false });
      const testResult = {
        facebook: {
          status: 'completed',
          visibility: 'unpublished',
          objectId: fbResult.externalPostId,
          permalink: fbResult.permalink || ''
        },
        completedAt
      };

      if (!post.externalPostId && this.repo.setPostPublishState) {
        await this.repo.setPostPublishState(post.id, {
          ...fbResult,
          source: 'facebook-test',
          testResult
        });
      }

      return { ...fbResult, source: 'facebook-test', testResult };
    }

    if (fanpage.platform === 'instagram') {
      const igResult = await this.testInstagramPost(fanpage, post);
      return {
        externalPostId: igResult.containerId,
        permalink: '',
        mediaUrl: igResult.mediaUrl,
        source: 'instagram-test',
        testResult: {
          instagram: { status: 'completed', mode: 'container_only', ...igResult },
          completedAt
        }
      };
    }
    throw new Error(`Chưa hỗ trợ đăng thử cho nền tảng ${fanpage.platform}.`);
  }

  async publishScheduledPost(post) {
    const fanpage = await this.repo.getFanpage(post.fanpageId);
    if (!fanpage) throw new Error('Không tìm thấy fanpage để đăng bài.');
    if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');
    if (fanpage.platform === 'facebook') {
      const fbResult = post.externalPostId
        ? { externalPostId: post.externalPostId, permalink: post.permalink || '', mediaUrl: post.mediaUrl || '' }
        : await this.publishFacebookPost(fanpage, post);
      if (fbResult.deferred) return { ...fbResult, source: 'facebook' };
      return { ...fbResult, source: 'facebook' };
    }
    if (fanpage.platform === 'instagram') return { ...await this.publishInstagramPost(fanpage, post), source: 'instagram' };
    throw new Error(`Chưa hỗ trợ đăng tự động cho nền tảng ${fanpage.platform}.`);
  }

  async refreshFanpageProfile(fanpage) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token) return fanpage;
    if (fanpage.platform === 'instagram' && fanpage.instagramBusinessId) {
      const instagram = await this.graphGet(fanpage.instagramBusinessId, {
        access_token: token,
        fields: 'username,profile_picture_url'
      });
      return this.repo.upsertFanpage({
        id: fanpage.id,
        platform: 'instagram',
        name: instagram.username || fanpage.name,
        link: instagram.username ? `https://instagram.com/${instagram.username}` : fanpage.link,
        imageUrl: instagram.profile_picture_url || fanpage.imageUrl || '',
        metaPageId: fanpage.metaPageId,
        instagramBusinessId: fanpage.instagramBusinessId,
        connected: true,
        syncStatus: fanpage.syncStatus || 'connected'
      });
    }
    if (fanpage.metaPageId) {
      const page = await this.graphGet(fanpage.metaPageId, {
        access_token: token,
        fields: 'name,link,picture{url}'
      });
      return this.repo.upsertFanpage({
        id: fanpage.id,
        platform: fanpage.platform || 'facebook',
        name: page.name || fanpage.name,
        link: page.link || fanpage.link,
        imageUrl: page.picture?.data?.url || fanpage.imageUrl || '',
        metaPageId: fanpage.metaPageId,
        instagramBusinessId: fanpage.instagramBusinessId,
        connected: true,
        syncStatus: fanpage.syncStatus || 'connected'
      });
    }
    return fanpage;
  }

  async exchangeCode(code) {
    const configured = this.assertConfigured();
    const shortToken = await this.graphGet('oauth/access_token', {
      client_id: configured.appId,
      client_secret: configured.appSecret,
      redirect_uri: configured.redirectUri,
      code
    });
    const longToken = await this.graphGet('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: configured.appId,
      client_secret: configured.appSecret,
      fb_exchange_token: shortToken.access_token
    });
    const expiresAt = longToken.expires_in
      ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
      : null;
    await this.repo.saveMetaAccount({
      accessToken: longToken.access_token,
      tokenExpiresAt: expiresAt,
      scopes: this.configuredScopes().join(',')
    });
    return longToken.access_token;
  }

  async connectPages(userAccessToken) {
    const accounts = await this.graphGet('me/accounts', {
      access_token: userAccessToken,
      fields: 'id,name,link,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}'
    });
    const connected = [];
    for (const page of accounts.data || []) {
      connected.push(await this.repo.upsertFanpage({
        platform: 'facebook',
        name: page.name,
        link: page.link || `https://facebook.com/${page.id}`,
        imageUrl: page.picture?.data?.url || '',
        metaPageId: page.id,
        pageAccessToken: page.access_token,
        connected: true,
        syncStatus: 'connected'
      }));
      const instagram = page.instagram_business_account;
      if (instagram?.id) {
        connected.push(await this.repo.upsertFanpage({
          platform: 'instagram',
          name: instagram.username || `${page.name} Instagram`,
          link: instagram.username ? `https://instagram.com/${instagram.username}` : '',
          imageUrl: instagram.profile_picture_url || page.picture?.data?.url || '',
          metaPageId: page.id,
          instagramBusinessId: instagram.id,
          pageAccessToken: page.access_token,
          connected: true,
          syncStatus: 'connected'
        }));
      }
    }
    return connected;
  }

  async fetchFacebookPostBatch(fanpage, token, limit = 100) {
    const postEdges = ['published_posts', 'posts', 'feed'];
    const fieldSets = [
      'id,message,created_time,updated_time,permalink_url,full_picture,attachments{media,subattachments},shares,reactions.summary(total_count),comments.summary(total_count)',
      'id,message,created_time,updated_time,permalink_url,full_picture,attachments{media,subattachments}',
      'id,message,created_time,updated_time,permalink_url,full_picture',
      'id,created_time,updated_time'
    ];
    const edgeErrors = [];
    for (const edge of postEdges) {
      for (const fields of fieldSets) {
        const posts = await this.graphGet(`${fanpage.metaPageId}/${edge}`, {
          access_token: token,
          limit,
          fields
        }).catch((error) => {
          edgeErrors.push(`${edge} (${fields}): ${error.message}`);
          return { data: [] };
        });
        if ((posts.data || []).length) {
          return { posts: posts.data || [], edge, fields, edgeErrors };
        }
      }
    }
    if (edgeErrors.length === postEdges.length * fieldSets.length) {
      throw new Error(`Meta không cho đọc bài đã đăng. ${edgeErrors.join(' | ')}`);
    }
    return { posts: [], edge: '', fields: '', edgeErrors };
  }

  async syncFacebookPosts(fanpage, { limit = 100 } = {}) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.metaPageId) return 0;
    const { posts } = await this.fetchFacebookPostBatch(fanpage, token, limit);
    let count = 0;
    const syncedIds = [];
    const syncedDates = [];
    const cutoff = getPostRetentionCutoff();
    for (const post of posts) {
      const publishedAt = post.created_time || post.updated_time || new Date().toISOString();
      if (!isWithinPostRetention(publishedAt, cutoff)) continue;
      syncedIds.push(post.id);
      syncedDates.push(publishedAt);
      await this.repo.upsertPost({
        fanpageId: fanpage.id,
        externalPostId: post.id,
        title: post.message || 'Bài đăng Facebook',
        content: post.message || '',
        date: publishedAt.slice(0, 10),
        publishedAt,
        permalink: post.permalink_url || '',
        mediaUrl: getFacebookPostThumbnail(post),
        engagement: extractFacebookEngagement(post),
        source: 'facebook',
        status: 'published'
      });
      count++;
    }
    // Only prune when we saw the full tail. A full page (length >= limit) means
    // Meta may have more posts we did not fetch, so NOT-IN could delete real posts.
    if (posts.length > 0 && posts.length < limit) {
      await this.repo.markMissingSyncedPostsDeleted?.({
        fanpageId: fanpage.id,
        source: 'facebook',
        externalPostIds: syncedIds,
        sinceDate: getOldestSyncDate(syncedDates)
      });
    }
    return count;
  }

  async syncInstagramMedia(fanpage, { limit = 100 } = {}) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.instagramBusinessId) return 0;
    const media = await this.graphGet(`${fanpage.instagramBusinessId}/media`, {
      access_token: token,
      limit,
      fields: 'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count'
    }).catch(() => this.graphGet(`${fanpage.instagramBusinessId}/media`, {
      access_token: token,
      limit,
      fields: 'id,timestamp'
    }));
    let count = 0;
    const syncedIds = [];
    const syncedDates = [];
    const cutoff = getPostRetentionCutoff();
    for (const item of media.data || []) {
      const publishedAt = item.timestamp || new Date().toISOString();
      if (!isWithinPostRetention(publishedAt, cutoff)) continue;
      syncedIds.push(item.id);
      syncedDates.push(publishedAt);
      await this.repo.upsertPost({
        fanpageId: fanpage.id,
        externalPostId: item.id,
        title: item.caption || 'Bài đăng Instagram',
        date: publishedAt.slice(0, 10),
        publishedAt,
        permalink: item.permalink || '',
        mediaUrl: item.media_type === 'VIDEO'
          ? (item.thumbnail_url || item.media_url || '')
          : (item.media_url || item.thumbnail_url || ''),
        engagement: extractInstagramEngagement(item),
        source: 'instagram',
        status: 'published'
      });
      count++;
    }
    const mediaCount = (media.data || []).length;
    if (mediaCount > 0 && mediaCount < limit) {
      await this.repo.markMissingSyncedPostsDeleted?.({
        fanpageId: fanpage.id,
        source: 'instagram',
        externalPostIds: syncedIds,
        sinceDate: getOldestSyncDate(syncedDates)
      });
    }
    return count;
  }

  // maxFanpages default 1 = batch one fanpage per invocation (Cloudflare CPU/subrequest
  // limits). The server mirror defaults to null (all at once); this difference is intentional.
  async syncAll({ cursor = null, maxFanpages = 1, postLimit = MAX_META_SYNC_POSTS } = {}) {
    const boundedPostLimit = Math.max(
      1,
      Math.min(MAX_META_SYNC_POSTS, Number(postLimit) || MAX_META_SYNC_POSTS)
    );
    const fanpages = (await this.repo.getConnectedFanpages())
      .sort((a, b) => `${a.name || ''}:${a.id}`.localeCompare(`${b.name || ''}:${b.id}`));
    const savedCursor = await this.repo.getState('lastMetaSyncCursor');
    const startIndex = Math.max(0, Math.min(
      cursor === null ? Number(savedCursor || 0) : Number(cursor || 0),
      Math.max(fanpages.length - 1, 0)
    ));
    const batchSize = Math.max(1, Math.min(Number(maxFanpages || 1), fanpages.length || 1));
    const selectedFanpages = fanpages.slice(startIndex, startIndex + batchSize);
    const result = {
      startedAt: new Date().toISOString(),
      cursor: startIndex,
      fanpageCount: fanpages.length,
      postLimit: boundedPostLimit,
      fanpages: [],
      totalPosts: 0
    };
    for (const fanpage of selectedFanpages) {
      try {
        await this.repo.setFanpageSyncStatus(fanpage.id, 'syncing');
        const refreshed = await this.refreshFanpageProfile(fanpage).catch(() => fanpage);
        const syncFanpage = {
          ...refreshed,
          pageAccessTokenEncrypted: fanpage.pageAccessTokenEncrypted
        };
        const count = syncFanpage.platform === 'instagram'
          ? await this.syncInstagramMedia(syncFanpage, { limit: boundedPostLimit })
          : await this.syncFacebookPosts(syncFanpage, { limit: boundedPostLimit });
        await this.repo.setFanpageSyncStatus(refreshed.id, 'synced');
        result.fanpages.push({
          id: refreshed.id,
          name: refreshed.name,
          platform: refreshed.platform,
          count,
          status: 'synced'
        });
        result.totalPosts += count;
      } catch (error) {
        await this.repo.setFanpageSyncStatus(fanpage.id, 'error', error.message);
        result.fanpages.push({
          id: fanpage.id,
          name: fanpage.name,
          platform: fanpage.platform,
          count: 0,
          status: 'error',
          error: error.message
        });
      }
    }
    const nextCursor = startIndex + selectedFanpages.length;
    result.nextCursor = nextCursor < fanpages.length ? nextCursor : 0;
    result.hasMore = nextCursor < fanpages.length;
    result.finishedAt = new Date().toISOString();
    result.expiredPosts = await this.repo.cleanupOldPublishedPosts?.(getPostRetentionCutoff()) || 0;
    await this.repo.saveState('lastMetaSyncCursor', result.nextCursor);
    await this.repo.saveState('lastMetaSync', result);
    const syncFailures = result.fanpages.filter(item => item.status === 'error');
    if (syncFailures.length && this.repo.writeAppLog) {
      await this.repo.writeAppLog({
        level: 'error', component: 'meta', event: 'sync_failed',
        message: `${syncFailures.length} tài khoản Meta đồng bộ thất bại.`,
        details: { fanpages: syncFailures.map(item => ({ id: item.id, platform: item.platform, error: item.error || '' })) }
      }).catch(() => {});
    }
    return result;
  }

  async diagnostics() {
    const fanpages = await this.repo.getConnectedFanpages();
    const configured = this.assertConfigured();
    const appAccessToken = `${configured.appId}|${configured.appSecret}`;
    const result = { checkedAt: new Date().toISOString(), fanpages: [] };
    for (const fanpage of fanpages) {
      const token = await this.repo.decryptPageToken(fanpage);
      const item = {
        id: fanpage.id,
        name: fanpage.name,
        platform: fanpage.platform,
        connected: fanpage.connected,
        hasToken: !!token,
        scopes: [],
        granularScopes: [],
        edges: {}
      };
      if (!token) {
        result.fanpages.push(item);
        continue;
      }
      const tokenDebug = await this.graphGet('debug_token', {
        input_token: token,
        access_token: appAccessToken
      }).catch((error) => ({ error: error.message }));
      if (tokenDebug.error) {
        item.tokenError = tokenDebug.error;
      } else {
        item.scopes = tokenDebug.data?.scopes || [];
        item.granularScopes = tokenDebug.data?.granular_scopes || [];
        item.expiresAt = tokenDebug.data?.expires_at
          ? new Date(tokenDebug.data.expires_at * 1000).toISOString()
          : null;
      }
      if (fanpage.platform === 'instagram' && fanpage.instagramBusinessId) {
        const media = await this.graphGet(`${fanpage.instagramBusinessId}/media`, {
          access_token: token,
          limit: 5,
          fields: 'id,timestamp'
        }).catch((error) => ({ error: error.message, data: [] }));
        item.edges.media = { count: (media.data || []).length, error: media.error || '' };
      } else if (fanpage.metaPageId) {
        const batch = await this.fetchFacebookPostBatch(fanpage, token, 5);
        item.edges[batch.edge || 'none'] = {
          count: batch.posts.length,
          fields: batch.fields,
          errorCount: batch.edgeErrors.length
        };
      }
      result.fanpages.push(item);
    }
    return result;
  }
}
