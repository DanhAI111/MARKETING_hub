import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// js/utils.js is a browser IIFE (no exports). Extract parseCSV from source so
// the test exercises the real shipped code, not a copy that could drift.
const utilsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'utils.js'),
  'utf8'
);
const match = utilsSrc.match(/const parseCSV = \(text\) => \{[\s\S]*?\n {2}\};/);
assert.ok(match, 'parseCSV should be found in js/utils.js');
// eslint-disable-next-line no-eval
const parseCSV = eval(`(${match[0].replace(/^\s*const parseCSV = /, '').replace(/;\s*$/, '')})`);
const escapeMatch = utilsSrc.match(/const escapeHtml = \(str\) => \{[\s\S]*?\n {2}\};/);
assert.ok(escapeMatch, 'escapeHtml should be found in js/utils.js');
const escapeHtml = Function('document', `
  return (${escapeMatch[0].replace(/^\s*const escapeHtml = /, '').replace(/;\s*$/, '')});
`)({
  createElement: () => {
    let text = '';
    return {
      set textContent(value) { text = String(value); },
      get innerHTML() {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
    };
  }
});

test('parseCSV splits simple rows', () => {
  assert.deepEqual(parseCSV('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCSV keeps commas inside quoted fields', () => {
  assert.deepEqual(parseCSV('name,note\n"Doe, John",hi'), [['name', 'note'], ['Doe, John', 'hi']]);
});

test('parseCSV keeps newlines inside quoted fields', () => {
  assert.deepEqual(parseCSV('a\n"line1\nline2",b'), [['a'], ['line1\nline2', 'b']]);
});

test('parseCSV unescapes doubled quotes', () => {
  assert.deepEqual(parseCSV('"say ""hi"""'), [['say "hi"']]);
});

test('parseCSV strips BOM and CRLF, drops blank rows', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('escapeHtml is safe in quoted HTML attributes', () => {
  assert.equal(
    escapeHtml(`"><img src=x onerror='alert(1)'>&`),
    '&quot;&gt;&lt;img src=x onerror=&#39;alert(1)&#39;&gt;&amp;'
  );
});
