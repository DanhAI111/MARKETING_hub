const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish'
];

const dataUrlToBlob = (dataUrl) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, base64] = match;
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
};

const formatMetaError = (body, fallback) => {
  const metaError = body?.error;
  if (!metaError) return fallback;
  const detail = metaError.error_user_msg || metaError.error_user_title || '';
  const message = [metaError.message, detail && detail !== metaError.message ? detail : ''].filter(Boolean).join(': ');
  const code = [metaError.code, metaError.error_subcode].filter(value => value !== undefined).join('/');
  return `${message || fallback}${code ? ` (Meta ${code})` : ''}`;
};

const getGoogleDriveFileId = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)drive\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/i.test(url.hostname)) return '';
    return url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id') || '';
  } catch {
    return '';
  }
};

const getGoogleDriveFolderId = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return '';
    return url.pathname.match(/\/drive\/folders\/([^/]+)/)?.[1] || '';
  } catch {
    return '';
  }
};

const normalizeMediaUrl = (rawUrl) => {
  const fileId = getGoogleDriveFileId(rawUrl);
  return fileId
    ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`
    : rawUrl;
};

const googleDriveThumbnailUrl = (fileId) =>
  `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;

const decodeHtml = (value = '') => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

const listGoogleDriveFolderMedia = async (folderId) => {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Không thể đọc folder Google Drive (HTTP ${response.status}). Hãy bật quyền "Anyone with the link".`);
  }
  const html = await response.text();
  const entries = [];
  const pattern = /<div class="flip-entry"[^>]*id="entry-([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtml(match[2]).trim();
    if (!/\.(png|jpe?g|gif|webp|tiff?|heic|heif)$/i.test(name)) continue;
    entries.push({
      type: 'image',
      url: googleDriveThumbnailUrl(match[1]),
      name
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!entries.length) {
    throw new Error('Folder Google Drive không có ảnh hợp lệ hoặc chưa được chia sẻ công khai.');
  }
  return entries.slice(0, 10);
};

const filenameFromDisposition = (value = '') => {
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch { return utf8Match[1]; }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] || value.match(/filename=([^;]+)/i)?.[1]?.trim() || '';
};

const isVideoName = (value = '') => /\.(mp4|mov|m4v|avi|webm|mkv)(?:$|[?#])/i.test(value);

const resolveMediaItem = async (media) => {
  const originalUrl = media?.url || '';
  const driveFolderId = getGoogleDriveFolderId(originalUrl);
  if (driveFolderId) return listGoogleDriveFolderMedia(driveFolderId);
  const driveFileId = getGoogleDriveFileId(originalUrl);
  const resolved = { ...media, url: normalizeMediaUrl(originalUrl) };
  if (!driveFileId) {
    if (media?.type === 'video' || isVideoName(originalUrl) || isVideoName(media?.name)) resolved.type = 'video';
    return [resolved];
  }

  const response = await fetch(resolved.url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Không thể tải media từ Google Drive (HTTP ${response.status}). Hãy bật quyền "Anyone with the link".`);
  }
  const filename = filenameFromDisposition(response.headers.get('content-disposition') || '');
  const contentType = response.headers.get('content-type') || '';
  resolved.name = filename || resolved.name;
  resolved.type = contentType.startsWith('video/') || isVideoName(filename) ? 'video' : 'image';
  if (resolved.type === 'image') resolved.url = googleDriveThumbnailUrl(driveFileId);
  return [resolved];
};

const resolveMediaItems = async (post) => {
  const groups = await Promise.all(getMediaItems(post).map(resolveMediaItem));
  return groups.flat().slice(0, 10);
};

const getOldestSyncDate = (dates = []) => dates
  .filter(Boolean)
  .map((value) => String(value).slice(0, 10))
  .sort()[0] || '';

const getPostMessage = (post) => (post.content || post.title || '').trim();
const getMediaItems = (post) => {
  if (Array.isArray(post.mediaItems) && post.mediaItems.length) {
    return post.mediaItems.filter((item) => item?.url);
  }
  return post.mediaUrl ? [{ type: 'image', url: post.mediaUrl }] : [];
};

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
    const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const response = await fetch(url);
    const body = await response.json().catch(() => ({}));
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
    const response = await fetch(url, { method: 'POST', body });
    const responseBody = await response.json().catch(() => ({}));
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

  async addFacebookVideo({ pageId, token, media, description = '' }) {
    if (!/^https?:\/\//i.test(media.url)) throw new Error('Facebook video yêu cầu URL tải công khai.');
    return this.graphPost(`${pageId}/videos`, {
      access_token: token,
      file_url: media.url,
      description,
      published: 'true'
    });
  }

  async publishFacebookPost(fanpage, post) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.metaPageId) {
      throw new Error('Fanpage Facebook chưa có Page access token. Vui lòng liên kết Meta lại.');
    }
    const message = getPostMessage(post);
    const mediaItems = await resolveMediaItems(post);
    if (!mediaItems.length) {
      const result = await this.graphPost(`${fanpage.metaPageId}/feed`, { access_token: token, message });
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
          description: message
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
      attached_media: JSON.stringify(uploaded)
    });
    return {
      externalPostId: result.id || '',
      permalink: result.id ? `https://www.facebook.com/${result.id}` : '',
      mediaUrl: mediaItems[0]?.url || ''
    };
  }

  async publishInstagramPost(fanpage, post) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.instagramBusinessId) {
      throw new Error('Tài khoản Instagram chưa có Instagram Business ID/Page token. Vui lòng liên kết Meta lại.');
    }
    const media = (await resolveMediaItem(getMediaItems(post)[0]))[0];
    if (!media?.url) throw new Error('Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.');
    if (!/^https?:\/\//i.test(media.url)) {
      throw new Error('Instagram Graph API không nhận file local/base64. Vui lòng dùng URL ảnh công khai.');
    }
    if (media.type === 'video') {
      throw new Error('Lịch đăng Instagram hiện chỉ hỗ trợ ảnh; chưa hỗ trợ video/Reels.');
    }
    const container = await this.graphPost(`${fanpage.instagramBusinessId}/media`, {
      access_token: token,
      image_url: media.url,
      caption: getPostMessage(post)
    });
    const published = await this.graphPost(`${fanpage.instagramBusinessId}/media_publish`, {
      access_token: token,
      creation_id: container.id
    });
    const details = published.id
      ? await this.graphGet(published.id, { access_token: token, fields: 'permalink,media_url' }).catch(() => ({}))
      : {};
    return {
      externalPostId: published.id || '',
      permalink: details.permalink || '',
      mediaUrl: details.media_url || media.url
    };
  }

  async publishScheduledPost(post) {
    const fanpage = await this.repo.getFanpage(post.fanpageId);
    if (!fanpage) throw new Error('Không tìm thấy fanpage để đăng bài.');
    if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');
    if (fanpage.platform === 'facebook') {
      // Retry-idempotent: if FB already published (post.externalPostId set) but the
      // Instagram cross-post failed, reuse the FB result instead of posting twice.
      const fbResult = post.externalPostId
        ? { externalPostId: post.externalPostId, permalink: post.permalink || '', mediaUrl: post.mediaUrl || '' }
        : await this.publishFacebookPost(fanpage, post);

      if (fanpage.crossPostInstagram) {
        const igPage = await this.repo.getInstagramSiblingFanpage(fanpage.metaPageId);
        if (igPage) {
          // Persist FB result before IG attempt so a failed IG keeps the FB id.
          if (!post.externalPostId) {
            await this.repo.setPostPublishState(post.id, { ...fbResult, source: 'facebook' });
          }
          await this.publishInstagramPost(igPage, post);
        }
      }
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
    const fieldSets = ['id,message,created_time,updated_time,permalink_url,full_picture', 'id,created_time,updated_time'];
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
    for (const post of posts) {
      const publishedAt = post.created_time || post.updated_time || new Date().toISOString();
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
        mediaUrl: post.full_picture || '',
        source: 'facebook',
        status: 'published'
      });
      count++;
    }
    await this.repo.markMissingSyncedPostsDeleted?.({
      fanpageId: fanpage.id,
      source: 'facebook',
      externalPostIds: syncedIds,
      sinceDate: getOldestSyncDate(syncedDates)
    });
    return count;
  }

  async syncInstagramMedia(fanpage, { limit = 100 } = {}) {
    const token = await this.repo.decryptPageToken(fanpage);
    if (!token || !fanpage.instagramBusinessId) return 0;
    const media = await this.graphGet(`${fanpage.instagramBusinessId}/media`, {
      access_token: token,
      limit,
      fields: 'id,caption,timestamp,permalink,media_url,thumbnail_url'
    }).catch(() => this.graphGet(`${fanpage.instagramBusinessId}/media`, {
      access_token: token,
      limit,
      fields: 'id,timestamp'
    }));
    let count = 0;
    const syncedIds = [];
    const syncedDates = [];
    for (const item of media.data || []) {
      const publishedAt = item.timestamp || new Date().toISOString();
      syncedIds.push(item.id);
      syncedDates.push(publishedAt);
      await this.repo.upsertPost({
        fanpageId: fanpage.id,
        externalPostId: item.id,
        title: item.caption || 'Bài đăng Instagram',
        date: publishedAt.slice(0, 10),
        publishedAt,
        permalink: item.permalink || '',
        mediaUrl: item.media_url || item.thumbnail_url || '',
        source: 'instagram',
        status: 'published'
      });
      count++;
    }
    await this.repo.markMissingSyncedPostsDeleted?.({
      fanpageId: fanpage.id,
      source: 'instagram',
      externalPostIds: syncedIds,
      sinceDate: getOldestSyncDate(syncedDates)
    });
    return count;
  }

  async syncAll({ cursor = null, maxFanpages = 1, postLimit = 100 } = {}) {
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
          ? await this.syncInstagramMedia(syncFanpage, { limit: postLimit })
          : await this.syncFacebookPosts(syncFanpage, { limit: postLimit });
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
    await this.repo.saveState('lastMetaSyncCursor', result.nextCursor);
    await this.repo.saveState('lastMetaSync', result);
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
