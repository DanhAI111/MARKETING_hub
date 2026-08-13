const repo = require('./repository');
const {
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
} = require('../shared/meta-helpers.cjs');
const { getPostRetentionCutoff, isWithinPostRetention } = require('../shared/repository-helpers.cjs');

let durablePublisherPromise;
const getDurablePublisher = () => {
  if (!durablePublisherPromise) {
    durablePublisherPromise = import('../worker/meta.js').then(({ MetaService }) => new MetaService(
      process.env,
      repo,
      process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'
    ));
  }
  return durablePublisherPromise;
};

const configuredScopes = () => {
  const raw = process.env.META_SCOPES || DEFAULT_SCOPES.join(',');
  return raw.split(',').map((scope) => scope.trim()).filter(Boolean);
};

const requiredEnv = () => ({
  appId: process.env.META_APP_ID,
  appSecret: process.env.META_APP_SECRET,
  redirectUri: process.env.META_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'}/auth/meta/callback`
});

const assertConfigured = () => {
  const env = requiredEnv();
  if (!env.appId || !env.appSecret) {
    const err = new Error('META_APP_ID và META_APP_SECRET chưa được cấu hình trong .env');
    err.status = 503;
    throw err;
  }
  return env;
};

const authUrl = (state) => {
  const env = assertConfigured();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.appId);
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', configuredScopes().join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
};

const graphTimeoutMs = () => {
  const configured = Number(process.env.META_GRAPH_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 60_000)
    : 15_000;
};

const fetchGraph = async (url, options) => {
  const controller = new AbortController();
  const timeoutMs = graphTimeoutMs();
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
};

const graphGet = async (path, params = {}) => {
  // Keep access_token out of the query string (leaks via logs/proxies); Graph API
  // accepts it as an Authorization: Bearer header on GET.
  const { access_token, ...rest } = params;
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  Object.entries(rest).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const { response: res, body } = await fetchGraph(
    url,
    access_token ? { headers: { Authorization: `Bearer ${access_token}` } } : undefined
  );
  if (!res.ok) {
    const message = formatMetaError(body, `Meta API error ${res.status}`);
    const err = new Error(message);
    err.status = res.status;
    err.meta = body;
    throw err;
  }
  return body;
};

const graphPost = async (path, params = {}, { multipart = false } = {}) => {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  let body;

  if (multipart) {
    body = new FormData();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') body.append(key, value);
    });
  } else {
    body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') body.set(key, value);
    });
  }

  const { response: res, body: responseBody } = await fetchGraph(url, { method: 'POST', body });
  if (!res.ok) {
    const message = formatMetaError(responseBody, `Meta API error ${res.status}`);
    const err = new Error(message);
    err.status = res.status;
    err.meta = responseBody;
    throw err;
  }
  return responseBody;
};

const dataUrlToBlob = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, base64] = match;
  return new Blob([Buffer.from(base64, 'base64')], { type: mime });
};

const addFacebookPhoto = async ({ pageId, token, media, caption = '', published = true }) => {
  const dataBlob = dataUrlToBlob(media.url);
  const params = {
    access_token: token,
    caption,
    published: String(published)
  };
  if (dataBlob) {
    params.source = dataBlob;
    return graphPost(`${pageId}/photos`, params, { multipart: true });
  }
  params.url = media.url;
  return graphPost(`${pageId}/photos`, params);
};

const addFacebookVideo = async ({ pageId, token, media, description = '', published = true }) => {
  if (!/^https?:\/\//i.test(media.url)) throw new Error('Facebook video yêu cầu URL tải công khai.');
  return graphPost(`${pageId}/videos`, {
    access_token: token,
    file_url: media.url,
    description,
    published: String(published)
  });
};

const createInstagramVideoContainer = async (igId, token, videoUrl, caption) => {
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new Error('Instagram video yêu cầu URL tải công khai (không nhận file local/base64).');
  }
  // IG video = Reels: media_type=REELS + video_url (image path uses image_url).
  return graphPost(`${igId}/media`, {
    access_token: token,
    media_type: 'REELS',
    video_url: videoUrl,
    caption
  });
};

// Poll container status_code until FINISHED before media_publish. Bounded so a stuck
// encode fails one post, not the whole cron invocation. Delays are await-I/O (low CPU).
const waitInstagramContainerReady = async (containerId, token) => {
  const POLL_ATTEMPTS = 20;
  const POLL_DELAY_MS = 3000;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const details = await graphGet(containerId, {
      access_token: token,
      fields: 'status_code,status'
    });
    const statusCode = String(details.status_code || '').toUpperCase();
    if (statusCode === 'FINISHED') return;
    if (['ERROR', 'EXPIRED'].includes(statusCode)) {
      throw new Error(details.status || `Instagram xử lý video thất bại (${statusCode.toLowerCase()}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  }
  throw new Error('Instagram chưa xử lý xong video sau thời gian chờ. Bài sẽ tự thử lại ở lần đăng sau.');
};

const publishFacebookPost = async (fanpage, post, { published = true } = {}) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.metaPageId) {
    throw new Error('Fanpage Facebook chưa có Page access token. Vui lòng liên kết Meta lại.');
  }

  const message = getPostMessage(post);
  const mediaItems = await resolveMediaItems(post);
  if (!mediaItems.length) {
    const result = await graphPost(`${fanpage.metaPageId}/feed`, {
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
      const result = await addFacebookVideo({
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
    const result = await addFacebookPhoto({
      pageId: fanpage.metaPageId,
      token,
      media: mediaItems[0],
      caption: '',
      published: false
    });
    if (!result.id) throw new Error('Không thể tải ảnh lên Facebook.');
    const feedResult = await graphPost(`${fanpage.metaPageId}/feed`, {
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
    const result = await addFacebookPhoto({
      pageId: fanpage.metaPageId,
      token,
      media,
      caption: '',
      published: false
    });
    if (result.id) uploaded.push({ media_fbid: result.id });
  }
  if (!uploaded.length) throw new Error('Không thể tải ảnh lên Facebook.');

  const result = await graphPost(`${fanpage.metaPageId}/feed`, {
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
};

// Carousel (2-10 images): one child container per image, then a CAROUSEL container
// referencing the children. Caption lives on the carousel container only.
const createInstagramCarouselContainer = async (igId, token, images, caption) => {
  const children = [];
  for (const image of images) {
    const child = await graphPost(`${igId}/media`, {
      access_token: token,
      image_url: image.url,
      is_carousel_item: 'true'
    });
    if (!child.id) throw new Error('Meta không trả về container ID cho ảnh trong carousel.');
    children.push(child.id);
  }
  return graphPost(`${igId}/media`, {
    access_token: token,
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption
  });
};

const publishInstagramPost = async (fanpage, post) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.instagramBusinessId) {
    throw new Error('Tài khoản Instagram chưa có Instagram Business ID/Page token. Vui lòng liên kết Meta lại.');
  }

  const mediaItems = await resolveMediaItems(post);
  const media = mediaItems[0];
  if (!media?.url) {
    throw new Error('Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.');
  }
  const publicItems = mediaItems.filter((item) => /^https?:\/\//i.test(item.url || ''));
  if (!publicItems.length) {
    throw new Error('Instagram Graph API không nhận file local/base64. Vui lòng dùng URL ảnh công khai.');
  }
  const images = publicItems.filter((item) => item.type !== 'video');
  const container = media.type === 'video'
    ? await createInstagramVideoContainer(fanpage.instagramBusinessId, token, media.url, getPostMessage(post))
    : images.length > 1
      ? await createInstagramCarouselContainer(fanpage.instagramBusinessId, token, images, getPostMessage(post))
      : await graphPost(`${fanpage.instagramBusinessId}/media`, {
          access_token: token,
          image_url: (images[0] || publicItems[0]).url,
          caption: getPostMessage(post)
        });
  // IG video (and sometimes carousel/image) containers process async — media_publish
  // 400s until status FINISHED. Node has no CPU limit, so a bounded blocking poll is fine.
  if (media.type === 'video' || images.length > 1) await waitInstagramContainerReady(container.id, token);
  const published = await graphPost(`${fanpage.instagramBusinessId}/media_publish`, {
    access_token: token,
    creation_id: container.id
  });
  const details = published.id
    ? await graphGet(published.id, { access_token: token, fields: 'permalink,media_url' }).catch(() => ({}))
    : {};

  return {
    externalPostId: published.id || '',
    permalink: details.permalink || '',
    mediaUrl: details.media_url || media.url,
    // resolveMediaItems caps at 10 (= Meta's carousel limit); video posts carry one video.
    warning: media.type === 'video' && mediaItems.length > 1
      ? `Instagram: bài video chỉ đăng video đầu (${mediaItems.length} media)`
      : ''
  };
};

const testInstagramPost = async (fanpage, post) => {
  const token = repo.decryptPageToken(fanpage);
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
    ? await createInstagramVideoContainer(fanpage.instagramBusinessId, token, media.url, getPostMessage(post))
    : await graphPost(`${fanpage.instagramBusinessId}/media`, {
        access_token: token,
        image_url: media.url,
        caption: getPostMessage(post)
      });
  if (!container.id) throw new Error('Meta không trả về Instagram container ID.');

  let details = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    details = await graphGet(container.id, {
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
};

const testScheduledPost = async (post) => {
  const fanpage = await repo.getFanpage(post.fanpageId);
  if (!fanpage) throw new Error('Không tìm thấy fanpage để kiểm tra đăng bài.');
  if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');

  const completedAt = new Date().toISOString();
  if (fanpage.platform === 'facebook') {
    const fbResult = post.externalPostId
      ? { externalPostId: post.externalPostId, permalink: post.permalink || '', mediaUrl: post.mediaUrl || '' }
      : await publishFacebookPost(fanpage, post, { published: false });
    const testResult = {
      facebook: {
        status: 'completed',
        visibility: 'unpublished',
        objectId: fbResult.externalPostId,
        permalink: fbResult.permalink || ''
      },
      completedAt
    };
    if (!post.externalPostId) {
      await repo.setPostPublishState(post.id, { ...fbResult, source: 'facebook-test', testResult });
    }

    let crossPostError = '';
    if (fanpage.crossPostInstagram) {
      const igPage = await repo.getInstagramSiblingFanpage(fanpage.metaPageId);
      if (!igPage) {
        crossPostError = 'Instagram: chưa có tài khoản IG liên kết để kiểm tra';
        testResult.instagram = { status: 'skipped', error: crossPostError };
      } else {
        try {
          const igResult = await testInstagramPost(igPage, post);
          testResult.instagram = { status: 'completed', mode: 'container_only', ...igResult };
        } catch (error) {
          crossPostError = `Instagram: ${error.message}`;
          testResult.instagram = { status: 'failed', error: crossPostError };
        }
      }
    } else {
      testResult.instagram = { status: 'skipped', error: 'Instagram cross-post đang tắt.' };
    }
    return { ...fbResult, source: 'facebook-test', testResult, crossPostError };
  }

  if (fanpage.platform === 'instagram') {
    const igResult = await testInstagramPost(fanpage, post);
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
};

const publishScheduledPost = async (post) => {
  const fanpage = await repo.getFanpage(post.fanpageId);
  if (!fanpage) throw new Error('Không tìm thấy fanpage để đăng bài.');
  if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');

  if (fanpage.platform === 'facebook') {
    // Publish to Facebook. Skip if this is a retry where FB already succeeded
    // (post.externalPostId set) but the cross-post to Instagram failed — this
    // keeps retries idempotent so FB isn't posted twice.
    let fbResult;
    if (post.externalPostId) {
      fbResult = {
        externalPostId: post.externalPostId,
        permalink: post.permalink || '',
        mediaUrl: post.mediaUrl || ''
      };
    } else {
      fbResult = await publishFacebookPost(fanpage, post);
    }

    let crossPostError = '';
    if (fanpage.crossPostInstagram) {
      const igPage = await repo.getInstagramSiblingFanpage(fanpage.metaPageId);
      if (igPage) {
        // FB is already live — persist it as 'published' before the IG attempt so a
        // crash mid-IG can't strand the row in 'publishing'/'failed' (which would
        // never reclaim and would make the user re-create → double-post to FB).
        if (!post.externalPostId) {
          await repo.setPostPublishState(post.id, { ...fbResult, status: 'published', source: 'facebook' });
        }
        try {
          const igResult = await publishInstagramPost(igPage, post);
          if (igResult.warning) crossPostError = igResult.warning;
        } catch (igErr) {
          // FB already succeeded; do NOT throw (a throw becomes 'failed' → double-post).
          // ponytail: IG retry is manual only. Add auto IG re-publish when a
          // dedicated cross-post retry queue exists.
          crossPostError = `Instagram: ${igErr.message}`;
        }
      } else {
        crossPostError = 'Instagram: chưa có tài khoản IG liên kết để cross-post';
      }
    }
    return { ...fbResult, source: 'facebook', crossPostError };
  }
  if (fanpage.platform === 'instagram') {
    return { ...await publishInstagramPost(fanpage, post), source: 'instagram' };
  }
  throw new Error(`Chưa hỗ trợ đăng tự động cho nền tảng ${fanpage.platform}.`);
};

const refreshFanpageProfile = async (fanpage) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token) return fanpage;

  if (fanpage.platform === 'instagram' && fanpage.instagramBusinessId) {
    const ig = await graphGet(fanpage.instagramBusinessId, {
      access_token: token,
      fields: 'username,profile_picture_url'
    });
    return repo.upsertFanpage({
      id: fanpage.id,
      platform: 'instagram',
      name: ig.username || fanpage.name,
      link: ig.username ? `https://instagram.com/${ig.username}` : fanpage.link,
      imageUrl: ig.profile_picture_url || fanpage.imageUrl || '',
      metaPageId: fanpage.metaPageId,
      instagramBusinessId: fanpage.instagramBusinessId,
      connected: true,
      syncStatus: fanpage.syncStatus || 'connected'
    });
  }

  if (fanpage.metaPageId) {
    const page = await graphGet(fanpage.metaPageId, {
      access_token: token,
      fields: 'name,link,picture{url}'
    });
    return repo.upsertFanpage({
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
};

const exchangeCode = async (code) => {
  const env = assertConfigured();
  const shortToken = await graphGet('oauth/access_token', {
    client_id: env.appId,
    client_secret: env.appSecret,
    redirect_uri: env.redirectUri,
    code
  });

  const longToken = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: env.appId,
    client_secret: env.appSecret,
    fb_exchange_token: shortToken.access_token
  });

  const expiresAt = longToken.expires_in
    ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
    : null;

  await repo.saveMetaAccount({
    accessToken: longToken.access_token,
    tokenExpiresAt: expiresAt,
    scopes: configuredScopes().join(',')
  });

  return longToken.access_token;
};

const connectPages = async (userAccessToken) => {
  const accounts = await graphGet('me/accounts', {
    access_token: userAccessToken,
    fields: 'id,name,link,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}'
  });

  const connected = [];
  for (const page of accounts.data || []) {
    const pageRecord = await repo.upsertFanpage({
      platform: 'facebook',
      name: page.name,
      link: page.link || `https://facebook.com/${page.id}`,
      imageUrl: page.picture?.data?.url || '',
      metaPageId: page.id,
      pageAccessToken: page.access_token,
      connected: true,
      syncStatus: 'connected'
    });
    connected.push(pageRecord);

    const ig = page.instagram_business_account;
    if (ig?.id) {
      connected.push(await repo.upsertFanpage({
        platform: 'instagram',
        name: ig.username || `${page.name} Instagram`,
        link: ig.username ? `https://instagram.com/${ig.username}` : '',
        imageUrl: ig.profile_picture_url || page.picture?.data?.url || '',
        metaPageId: page.id,
        instagramBusinessId: ig.id,
        pageAccessToken: page.access_token,
        connected: true,
        syncStatus: 'connected'
      }));
    }
  }
  return connected;
};

const fetchFacebookPostBatch = async (fanpage, token, limit = 100) => {
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
      const posts = await graphGet(`${fanpage.metaPageId}/${edge}`, {
        access_token: token,
        limit,
        fields
      }).catch((err) => {
        edgeErrors.push(`${edge} (${fields}): ${err.message}`);
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
};

const syncFacebookPosts = async (fanpage, { limit = 100 } = {}) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.metaPageId) return 0;
  const { posts } = await fetchFacebookPostBatch(fanpage, token, limit);
  let count = 0;
  const syncedIds = [];
  const syncedDates = [];
  const cutoff = getPostRetentionCutoff();
  for (const post of posts) {
    const publishedAt = post.created_time || post.updated_time || new Date().toISOString();
    if (!isWithinPostRetention(publishedAt, cutoff)) continue;
    syncedIds.push(post.id);
    syncedDates.push(publishedAt);
    await repo.upsertPost({
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
  if (repo.markMissingSyncedPostsDeleted && posts.length > 0 && posts.length < limit) {
    await repo.markMissingSyncedPostsDeleted({
      fanpageId: fanpage.id,
      source: 'facebook',
      externalPostIds: syncedIds,
      sinceDate: getOldestSyncDate(syncedDates)
    });
  }
  return count;
};

const syncInstagramMedia = async (fanpage, { limit = 100 } = {}) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.instagramBusinessId) return 0;
  const media = await graphGet(`${fanpage.instagramBusinessId}/media`, {
    access_token: token,
    limit,
    fields: 'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,like_count,comments_count'
  }).catch(() => graphGet(`${fanpage.instagramBusinessId}/media`, {
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
    await repo.upsertPost({
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
  if (repo.markMissingSyncedPostsDeleted && mediaCount > 0 && mediaCount < limit) {
    await repo.markMissingSyncedPostsDeleted({
      fanpageId: fanpage.id,
      source: 'instagram',
      externalPostIds: syncedIds,
      sinceDate: getOldestSyncDate(syncedDates)
    });
  }
  return count;
};

// maxFanpages default null = sync all fanpages in one pass. The worker mirror
// defaults to 1 on purpose (Cloudflare CPU/subrequest limits force batching); the
// server has no such cap, so the defaults intentionally differ.
const syncAll = async ({ cursor = null, maxFanpages = null, postLimit = 100 } = {}) => {
  const fanpages = (await repo.getConnectedFanpages())
    .sort((a, b) => `${a.name || ''}:${a.id}`.localeCompare(`${b.name || ''}:${b.id}`));
  const isBatched = cursor !== null || maxFanpages !== null;
  const savedCursor = isBatched ? await repo.getState('lastMetaSyncCursor') : 0;
  const startIndex = Math.max(0, Math.min(
    isBatched && cursor === null ? Number(savedCursor || 0) : Number(cursor || 0),
    Math.max(fanpages.length - 1, 0)
  ));
  const batchSize = isBatched
    ? Math.max(1, Math.min(Number(maxFanpages || 1), fanpages.length || 1))
    : Math.max(fanpages.length, 1);
  const selectedFanpages = fanpages.slice(startIndex, startIndex + batchSize);
  const result = {
    startedAt: new Date().toISOString(),
    cursor: startIndex,
    fanpageCount: fanpages.length,
    fanpages: [],
    totalPosts: 0
  };

  for (const fanpage of selectedFanpages) {
    try {
      await repo.setFanpageSyncStatus(fanpage.id, 'syncing');
      const refreshed = await refreshFanpageProfile(fanpage).catch(() => fanpage);
      const syncFanpage = {
        ...refreshed,
        pageAccessTokenEncrypted: fanpage.pageAccessTokenEncrypted
      };
      const count = syncFanpage.platform === 'instagram'
        ? await syncInstagramMedia(syncFanpage, { limit: postLimit })
        : await syncFacebookPosts(syncFanpage, { limit: postLimit });
      await repo.setFanpageSyncStatus(refreshed.id, 'synced');
      result.fanpages.push({ id: refreshed.id, name: refreshed.name, platform: refreshed.platform, count, status: 'synced' });
      result.totalPosts += count;
    } catch (err) {
      await repo.setFanpageSyncStatus(fanpage.id, 'error', err.message);
      result.fanpages.push({ id: fanpage.id, name: fanpage.name, platform: fanpage.platform, count: 0, status: 'error', error: err.message });
    }
  }

  const nextCursor = startIndex + selectedFanpages.length;
  result.nextCursor = nextCursor < fanpages.length ? nextCursor : 0;
  result.hasMore = nextCursor < fanpages.length;
  result.finishedAt = new Date().toISOString();
  result.expiredPosts = await repo.cleanupOldPublishedPosts?.(getPostRetentionCutoff()) || 0;
  await repo.saveState('lastMetaSyncCursor', result.nextCursor);
  await repo.saveState('lastMetaSync', result);
  return result;
};

module.exports = {
  authUrl,
  exchangeCode,
  connectPages,
  syncAll,
  publishScheduledPost: async (post) => (await getDurablePublisher()).publishScheduledPost(post),
  testScheduledPost,
  assertConfigured
};
