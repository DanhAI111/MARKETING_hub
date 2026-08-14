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
  if (String(fanpage?.platform || '').toLowerCase() !== 'instagram') return;
  const urls = publicMediaUrls(post);
  const name = fanpage?.name || 'Instagram';
  if (!urls.length) {
    throw validationError(`${name}: Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai.`);
  }
  if (urls.some(url => !/^https?:\/\//i.test(url))) {
    throw validationError(`${name}: Instagram chỉ nhận media có URL công khai.`);
  }
};

module.exports = { assertPostMediaForPlatform, publicMediaUrls };
