# TDD evidence: scheduled media preview and ordering

## Source and user journey

No plan file was supplied. The journey was derived from the requested behavior:

> As a marketing operator, I want to see the images attached by URL and arrange their order before scheduling, so that I know exactly which media will be published first.

The order displayed in the gallery is persisted in the existing `mediaItems` array and is therefore the order sent to the social publisher.

## RED / GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --test test/media-gallery.test.mjs` | Expected failure | `ERR_MODULE_NOT_FOUND` for the not-yet-created `js/media-gallery.js`. Checkpoint: `85762e1`. |
| GREEN | `node --test test/media-gallery.test.mjs` | 5/5 passed | Preview URL conversion, useful labels, immutable reordering, invalid indices, and UI wiring passed. Checkpoint: `c8b2157`. |
| QA RED | `node --test test/media-gallery.test.mjs` | 4/5 passed | Browser QA found that a URL without a filename was labelled `400` instead of its hostname. Checkpoint: `db1015d`. |
| QA GREEN | `node --test test/media-gallery.test.mjs` | 5/5 passed | Filename-less media URLs now use the hostname label. Checkpoint: `82e5992`. |
| Regression | `npm test` | 129/129 passed | No failed or skipped repository tests. |
| Coverage | `node --experimental-test-coverage --test test/media-gallery.test.mjs` | Passed | `media-gallery.js`: 100% lines, 93.75% branches, 100% functions. |
| Build | `WRANGLER_LOG_PATH=/tmp/mkt-hub-media-gallery-deploy-check.log npm run deploy:check` | Passed | 37 assets validated by `wrangler deploy --dry-run`. |

## Test specification

| # | What is guaranteed | Test / check | Type | Result |
|---|---|---|---|---|
| 1 | Google Drive share/download links use a thumbnail URL for visual preview without changing the publish URL. | `previewUrl turns supported Google Drive links...` | Unit | PASS |
| 2 | Google Drive IDs and URL path counters are replaced by useful human-readable labels. | `displayName provides a useful label...` | Unit | PASS |
| 3 | Moving an image returns a new ordered array and does not mutate the original. | `reorder moves media...` | Unit | PASS |
| 4 | Invalid, out-of-range, or identical positions leave the order unchanged. | `reorder leaves the order unchanged...` | Unit | PASS |
| 5 | The UI exposes actual thumbnails, numbered positions, drag/drop, arrow controls, remove controls, and accessible labels. | `schedule form loads an accessible draggable gallery...` | UI contract | PASS |

## Browser QA

Browser QA ran against a local static server with sample app data. Two public image URLs were added inside the modal; the modal was closed without saving.

- Desktop 1200px: both thumbnails loaded with positive natural width; two numbered cards and four move buttons rendered; moving the second image earlier updated hidden `mediaItems`; dragging restored the original order; no console exception or horizontal overflow.
- Mobile 375x812: cards stacked into one column, both thumbnails loaded, modal remained inside the viewport, no horizontal overflow, and all move/remove controls exposed explicit Vietnamese ARIA labels.
- Browser QA exposed the filename-less label issue (`400`), which was fixed and covered by the QA RED/GREEN cycle above.
- Automated screenshot capture timed out, and no committed visual baseline exists. Pixel-level visual regression is therefore inconclusive; DOM, responsive, image-load, and interaction checks passed.

## Known gaps

- A non-public or hotlink-blocked URL cannot be previewed; the card displays `Không xem được` and preserves the URL so the operator can replace or remove it.
- Drag/drop is intended for pointer devices. The left/right controls provide the equivalent accessible/mobile ordering path.
- No API, database migration, dependency, or social publishing behavior changed.
