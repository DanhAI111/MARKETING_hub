# Content media and performance — TDD evidence

## Source

The user journeys were derived from production UI feedback on 2026-07-25.

## User journeys

- As a marketing operator, I want to see each fanpage avatar so I can identify channels quickly.
- As a marketing operator, I want post thumbnails in the publishing list so I can scan creative assets visually.
- As a marketing operator, I want the Content tab to open promptly even when the month contains hundreds of posts.
- As an operator, I want Meta sync to finish so refreshed avatars and thumbnails reach the UI.

## RED

Command:

```text
node --test test/content-media-performance.test.mjs
```

Initial result: 0 passed, 5 failed. The failures reproduced repeated Store
reads, missing avatar/thumbnail rendering, an unbounded initial post list,
missing Instagram video thumbnails, and a D1 query with more than 100 bound
variables.

Checkpoint: `f155d4e`

## GREEN

Command:

```text
node --test test/content-media-performance.test.mjs
```

Result: 5 passed, 0 failed.

Checkpoint: `d939ac4`

## Full regression

Command:

```text
npm test
```

Result: 73 passed, 0 failed.

## Browser QA

The local browser run used 14 fanpages and 500 posts in July 2026.

- Content navigation: 9.3 ms.
- Initial DOM rows: 60.
- Avatar images: 14.
- Thumbnail images: 60.
- “Show more” result: 120 rows.
- Broken loaded images: 0.
- Desktop/mobile horizontal overflow: none.
- Page errors: none.

## Guarantees

| # | Guarantee | Evidence |
|---|---|---|
| 1 | Content renders from one Store snapshot | `test/content-media-performance.test.mjs` |
| 2 | Fanpage controls use `imageUrl` and have text fallback | `test/content-media-performance.test.mjs` |
| 3 | Post rows lazy-load available media thumbnails | `test/content-media-performance.test.mjs` |
| 4 | Only 60 posts render initially and more can be revealed | Unit test plus browser QA |
| 5 | Instagram videos store a still thumbnail when available | `test/content-media-performance.test.mjs` |
| 6 | D1 pruning binds the ID list as one JSON variable | Repository unit test |

## Coverage and gaps

The repository has no coverage script, so a numeric coverage percentage is not
available. The new behavior is covered by five focused tests, the full 73-test
suite, syntax/build checks, and a browser run at desktop and mobile widths.
Production avatar CDN availability will be confirmed after an explicitly
approved deployment.
