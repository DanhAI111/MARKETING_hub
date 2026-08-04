import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import MediaGallery from '../js/media-gallery.js';

const contentSource = fs.readFileSync(new URL('../js/pages/content.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../manage_MKT.html', import.meta.url), 'utf8');

test('previewUrl turns supported Google Drive links into image thumbnail URLs', () => {
  const fileId = '1LoNKjbp5hTNYi1hpV4mtOOul6T-fD9Y2';

  assert.equal(
    MediaGallery.previewUrl(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`),
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`
  );
  assert.equal(
    MediaGallery.previewUrl(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`),
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`
  );
  assert.equal(
    MediaGallery.previewUrl('https://cdn.example.com/images/hero.jpg'),
    'https://cdn.example.com/images/hero.jpg'
  );
});

test('displayName provides a useful label instead of exposing a Google Drive file id', () => {
  assert.equal(
    MediaGallery.displayName('https://drive.google.com/file/d/1LoNKjbp5hTNYi1hpV4mtOOul6T-fD9Y2/view?usp=sharing'),
    'Ảnh Google Drive'
  );
  assert.equal(
    MediaGallery.displayName('https://cdn.example.com/images/hero%20banner.jpg'),
    'hero banner.jpg'
  );
  assert.equal(
    MediaGallery.displayName('https://picsum.photos/id/237/600/400'),
    'picsum.photos'
  );
});

test('reorder moves media without mutating the original array', () => {
  const original = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const reordered = MediaGallery.reorder(original, 0, 2);

  assert.deepEqual(reordered.map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(original.map(item => item.id), ['a', 'b', 'c']);
  assert.notEqual(reordered, original);
});

test('reorder leaves the order unchanged for invalid or identical positions', () => {
  const original = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(MediaGallery.reorder(original, -1, 1), original);
  assert.deepEqual(MediaGallery.reorder(original, 0, 5), original);
  assert.deepEqual(MediaGallery.reorder(original, 1, 1), original);
});

test('schedule form loads an accessible draggable gallery with explicit reorder controls', () => {
  assert.match(htmlSource, /js\/media-gallery\.js/);
  assert.match(contentSource, /MediaGallery\.previewUrl/);
  assert.match(contentSource, /MediaGallery\.reorder/);
  assert.match(contentSource, /draggable="true"/);
  assert.match(contentSource, /dragstart/);
  assert.match(contentSource, /drop/);
  assert.match(contentSource, /move-schedule-media-btn/);
  assert.match(contentSource, /aria-label="Đưa ảnh/);
  assert.match(contentSource, /Ảnh \$\{index \+ 1\}/);
});
