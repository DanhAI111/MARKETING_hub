import test from 'node:test';
import assert from 'node:assert/strict';

test('a long content blob does not hijack header detection', () => {
  // Data rows carry a 1000+ char content cell full of words like "post"/"page".
  // The real header (row 2) must still win so columns stay aligned.
  const fanpages = [{ id: 'fp-1', name: 'Dorothy Vietnam', platform: 'facebook' }];
  const blob = 'This post is for our page. ' + 'nội dung '.repeat(200);
  const csv = [
    'CONTENT DETAIL,,,,,,',
    'STT,Fanpage,Ngày,Giờ,Định dạng,content,media',
    `1,Dorothy Vietnam,01/07/2026,15:30,Video,"${blob}",https://example.com/a.jpg`
  ].join('\n');
  const rows = parseScheduleSheet(csv, { fanpages, timezoneOffset: '+07:00' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valid, true, JSON.stringify(rows[0].errors));
  assert.equal(rows[0].fanpageId, 'fp-1');
  assert.ok(rows[0].content.startsWith('This post is for our page'));
  assert.equal(rows[0].scheduledAt, '2026-07-01T08:30:00.000Z');
});
import { parseScheduleSheet } from '../shared/schedule-sheet.mjs';

const fanpages = [
  { id: 'fb-1', name: 'Công ty ABC Official', platform: 'facebook', link: 'https://facebook.com/abc' },
  { id: 'ig-1', name: 'ABC Instagram', platform: 'instagram', link: 'https://instagram.com/abc' }
];

test('parses Vietnamese schedule headers with split date and time columns', () => {
  const csv = [
    'mã bài,tên page,nội dung,ngày đăng,giờ đăng,link ảnh',
    'POST-01,Công ty ABC Official,"Nội dung, có dấu phẩy",22/06/2026,10:30,https://cdn.example.test/post.jpg'
  ].join('\n');

  const [item] = parseScheduleSheet(csv, { fanpages, timezoneOffset: '+07:00' });

  assert.equal(item.valid, true);
  assert.equal(item.sheetRowKey, 'id:post-01');
  assert.equal(item.fanpageId, 'fb-1');
  assert.equal(item.content, 'Nội dung, có dấu phẩy');
  assert.equal(item.date, '2026-06-22');
  assert.equal(item.scheduledAt, '2026-06-22T03:30:00.000Z');
  assert.equal(item.mediaItems[0].type, 'image');
});

test('uses default fanpage when the sheet omits a fanpage column value', () => {
  const csv = [
    'content,scheduledAt',
    'Bài mặc định,2026-06-22 09:00'
  ].join('\n');

  const [item] = parseScheduleSheet(csv, {
    fanpages,
    defaultFanpageId: 'fb-1',
    timezoneOffset: '+07:00'
  });

  assert.equal(item.valid, true);
  assert.equal(item.fanpageId, 'fb-1');
  assert.equal(item.scheduledAt, '2026-06-22T02:00:00.000Z');
});

test('marks an Instagram schedule without media invalid before it enters the queue', () => {
  const csv = [
    'fanpage,content,scheduledAt,media',
    'ABC Instagram,Bài không ảnh,2026-06-22 09:00,'
  ].join('\n');

  const [item] = parseScheduleSheet(csv, { fanpages, timezoneOffset: '+07:00' });

  assert.equal(item.valid, false);
  assert.ok(item.errors.some(error => error.includes('ít nhất một ảnh hoặc video')));
});

test('marks unknown fanpages and Instagram video rows invalid', () => {
  const csv = [
    'fanpage,content,scheduledAt,media',
    'Không tồn tại,Bài lỗi,2026-06-22 09:00,https://cdn.example.test/photo.jpg',
    'ABC Instagram,Reel,2026-06-22 10:00,https://cdn.example.test/video.mp4'
  ].join('\n');

  const items = parseScheduleSheet(csv, { fanpages, timezoneOffset: '+07:00' });

  assert.equal(items[0].valid, false);
  assert.deepEqual(items[0].errors, ['Không tìm thấy fanpage']);
  assert.equal(items[1].valid, false);
  assert.equal(items[1].errors.includes('Instagram chưa hỗ trợ video/Reels'), true);
});
