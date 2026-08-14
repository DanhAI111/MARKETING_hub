import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertPostMediaForPlatform } = require('../shared/post-media-validation.cjs');

test('Facebook accepts text-only schedules while Instagram requires public media', () => {
  assert.doesNotThrow(() => assertPostMediaForPlatform(
    { platform: 'facebook', name: 'Facebook Page' },
    { mediaItems: [], mediaUrl: '' }
  ));

  assert.throws(
    () => assertPostMediaForPlatform(
      { platform: 'instagram', name: 'Instagram Account' },
      { mediaItems: [], mediaUrl: '' }
    ),
    error => error.status === 400 && error.message.includes('ít nhất một ảnh hoặc video')
  );
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
