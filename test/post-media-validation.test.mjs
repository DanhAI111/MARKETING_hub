import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertPostMediaForPlatform } = require('../shared/post-media-validation.cjs');

test('Facebook and Instagram reject text-only schedules', () => {
  assert.throws(() => assertPostMediaForPlatform(
    { platform: 'facebook', name: 'Facebook Page' },
    { mediaItems: [], mediaUrl: '' }
  ), error => error.status === 400 && error.message.includes('Facebook yêu cầu ít nhất một ảnh hoặc video'));

  assert.throws(
    () => assertPostMediaForPlatform(
      { platform: 'instagram', name: 'Instagram Account' },
      { mediaItems: [], mediaUrl: '' }
    ),
    error => error.status === 400 && error.message.includes('ít nhất một ảnh hoặc video')
  );
});

test('Facebook accepts inline image uploads and public media URLs', () => {
  assert.doesNotThrow(() => assertPostMediaForPlatform(
    { platform: 'facebook', name: 'Facebook Page' },
    { mediaItems: [{ type: 'image', url: 'data:image/png;base64,abc' }] }
  ));
  assert.doesNotThrow(() => assertPostMediaForPlatform(
    { platform: 'facebook', name: 'Facebook Page' },
    { mediaItems: [{ type: 'video', url: 'https://cdn.example.test/post.mp4' }] }
  ));
});

test('Instagram rejects inline data and accepts HTTP media at the API boundary', () => {
  assert.throws(
    () => assertPostMediaForPlatform(
      { platform: 'instagram', name: 'Instagram Account' },
      { mediaItems: [{ type: 'image', url: 'data:image/png;base64,abc' }] }
    ),
    error => error.status === 400 && error.message.includes('URL công khai')
  );

  assert.doesNotThrow(() => assertPostMediaForPlatform(
    { platform: 'instagram', name: 'Instagram Account' },
    { mediaItems: [{ type: 'image', url: 'https://cdn.example.test/post.jpg' }] }
  ));
});
