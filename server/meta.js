const repo = require('./repository');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];

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

const graphGet = async (path, params = {}) => {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `Meta API error ${res.status}`;
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

  const res = await fetch(url, { method: 'POST', body });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = responseBody?.error?.message || `Meta API error ${res.status}`;
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

const getPostMessage = (post) => (post.content || post.title || '').trim();

const getMediaItems = (post) => {
  if (Array.isArray(post.mediaItems) && post.mediaItems.length) {
    return post.mediaItems.filter((item) => item?.url);
  }
  return post.mediaUrl ? [{ type: 'image', url: post.mediaUrl }] : [];
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

const publishFacebookPost = async (fanpage, post) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.metaPageId) {
    throw new Error('Fanpage Facebook chưa có Page access token. Vui lòng liên kết Meta lại.');
  }

  const message = getPostMessage(post);
  const mediaItems = getMediaItems(post);
  if (!mediaItems.length) {
    const result = await graphPost(`${fanpage.metaPageId}/feed`, {
      access_token: token,
      message
    });
    return {
      externalPostId: result.id || '',
      permalink: result.id ? `https://www.facebook.com/${result.id}` : '',
      mediaUrl: ''
    };
  }

  if (mediaItems.length === 1) {
    const result = await addFacebookPhoto({
      pageId: fanpage.metaPageId,
      token,
      media: mediaItems[0],
      caption: message,
      published: true
    });
    return {
      externalPostId: result.post_id || result.id || '',
      permalink: result.post_id ? `https://www.facebook.com/${result.post_id}` : '',
      mediaUrl: mediaItems[0].url || ''
    };
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
    attached_media: JSON.stringify(uploaded)
  });
  return {
    externalPostId: result.id || '',
    permalink: result.id ? `https://www.facebook.com/${result.id}` : '',
    mediaUrl: mediaItems[0]?.url || ''
  };
};

const publishInstagramPost = async (fanpage, post) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.instagramBusinessId) {
    throw new Error('Tài khoản Instagram chưa có Instagram Business ID/Page token. Vui lòng liên kết Meta lại.');
  }

  const media = getMediaItems(post)[0];
  if (!media?.url) {
    throw new Error('Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.');
  }
  if (!/^https?:\/\//i.test(media.url)) {
    throw new Error('Instagram Graph API không nhận file local/base64. Vui lòng dùng URL ảnh công khai.');
  }

  const container = await graphPost(`${fanpage.instagramBusinessId}/media`, {
    access_token: token,
    image_url: media.url,
    caption: getPostMessage(post)
  });
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
    mediaUrl: details.media_url || media.url
  };
};

const publishScheduledPost = async (post) => {
  const fanpage = await repo.getFanpage(post.fanpageId);
  if (!fanpage) throw new Error('Không tìm thấy fanpage để đăng bài.');
  if (!fanpage.connected) throw new Error('Fanpage chưa liên kết Meta.');

  if (fanpage.platform === 'facebook') {
    return publishFacebookPost(fanpage, post);
  }
  if (fanpage.platform === 'instagram') {
    return publishInstagramPost(fanpage, post);
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

const syncFacebookPosts = async (fanpage) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.metaPageId) return 0;
  const query = {
    access_token: token,
    limit: 100,
    fields: 'id,message,created_time,permalink_url,full_picture,from'
  };
  const postEdges = ['published_posts', 'posts', 'feed'];
  let posts = { data: [] };
  for (const edge of postEdges) {
    posts = await graphGet(`${fanpage.metaPageId}/${edge}`, query).catch(() => ({ data: [] }));
    if ((posts.data || []).length) break;
  }
  let count = 0;
  for (const post of posts.data || []) {
    if (post.from?.id && post.from.id !== fanpage.metaPageId) continue;
    const publishedAt = post.created_time || '';
    if (!publishedAt) continue;
    await repo.upsertPost({
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
  return count;
};

const syncInstagramMedia = async (fanpage) => {
  const token = repo.decryptPageToken(fanpage);
  if (!token || !fanpage.instagramBusinessId) return 0;
  const media = await graphGet(`${fanpage.instagramBusinessId}/media`, {
    access_token: token,
    limit: 100,
    fields: 'id,caption,timestamp,permalink,media_url,thumbnail_url'
  });
  let count = 0;
  for (const item of media.data || []) {
    await repo.upsertPost({
      fanpageId: fanpage.id,
      externalPostId: item.id,
      title: item.caption || 'Bài đăng Instagram',
      date: (item.timestamp || '').slice(0, 10),
      permalink: item.permalink || '',
      mediaUrl: item.media_url || item.thumbnail_url || '',
      source: 'instagram',
      status: 'published'
    });
    count++;
  }
  return count;
};

const syncAll = async () => {
  const fanpages = await repo.getConnectedFanpages();
  const result = { startedAt: new Date().toISOString(), fanpages: [], totalPosts: 0 };

  for (const fanpage of fanpages) {
    try {
      await repo.setFanpageSyncStatus(fanpage.id, 'syncing');
      const refreshed = await refreshFanpageProfile(fanpage).catch(() => fanpage);
      const count = refreshed.platform === 'instagram'
        ? await syncInstagramMedia(refreshed)
        : await syncFacebookPosts(refreshed);
      await repo.setFanpageSyncStatus(refreshed.id, 'synced');
      result.fanpages.push({ id: refreshed.id, name: refreshed.name, platform: refreshed.platform, count, status: 'synced' });
      result.totalPosts += count;
    } catch (err) {
      await repo.setFanpageSyncStatus(fanpage.id, 'error', err.message);
      result.fanpages.push({ id: fanpage.id, name: fanpage.name, platform: fanpage.platform, count: 0, status: 'error', error: err.message });
    }
  }

  result.finishedAt = new Date().toISOString();
  return result;
};

module.exports = {
  authUrl,
  exchangeCode,
  connectPages,
  syncAll,
  publishScheduledPost,
  assertConfigured
};
