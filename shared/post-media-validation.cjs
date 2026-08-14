'use strict';

const publicMediaUrls = (post = {}) => {
  const items = Array.isArray(post.mediaItems) && post.mediaItems.length
    ? post.mediaItems
    : (post.mediaUrl ? [{ url: post.mediaUrl }] : []);
  return items.map(item => String(item?.url || '').trim()).filter(Boolean);
};

const validationError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const assertPostMediaForPlatform = (fanpage, post = {}) => {
  const platform = String(fanpage?.platform || '').toLowerCase();
  if (!['facebook', 'instagram'].includes(platform)) return;
  const urls = publicMediaUrls(post);
  const name = fanpage?.name || (platform === 'facebook' ? 'Facebook' : 'Instagram');
  if (!urls.length) {
    const requirement = platform === 'facebook'
      ? 'Facebook yêu cầu ít nhất một ảnh hoặc video.'
      : 'Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.';
    throw validationError(`${name}: ${requirement}`);
  }
  if (platform === 'instagram' && urls.some(url => !/^https?:\/\//i.test(url))) {
    throw validationError(`${name}: Instagram chỉ nhận media có URL công khai.`);
  }
};

module.exports = { assertPostMediaForPlatform, publicMediaUrls };
