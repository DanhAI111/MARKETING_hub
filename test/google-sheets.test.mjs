import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleSheetCsvText, googleSheetCsvUrls } from '../shared/google-sheets.mjs';

test('builds CSV export candidates for regular Google Sheets links', () => {
  const urls = googleSheetCsvUrls('https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=123');

  assert.equal(urls.length, 3);
  assert.equal(urls[0], 'https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=123');
  assert.equal(urls[1], 'https://docs.google.com/spreadsheets/d/sheet-id/gviz/tq?tqx=out:csv&gid=123');
});

test('rejects non-Google Sheets URLs', () => {
  assert.throws(() => googleSheetCsvUrls('https://example.test/sheet.csv'), /docs.google.com/);
});

test('fetchGoogleSheetCsvText skips HTML responses and returns CSV text', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    return new Response('id,content\n1,Hello', {
      status: 200,
      headers: { 'Content-Type': 'text/csv' }
    });
  };

  try {
    const text = await fetchGoogleSheetCsvText('https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0');
    assert.equal(text, 'id,content\n1,Hello');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
