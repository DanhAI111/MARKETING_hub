# Drive folder and Meta sync CPU TDD evidence

## Source and user journeys

Journeys were derived from the production incidents reported on 2026-08-13.

- A scheduler can use a public Google Drive folder whose files are named without extensions, and the publisher still resolves the actual images.
- A Meta history sync cannot ask one Cloudflare Worker invocation to process the CPU-heavy 100-post batch that produced `outcome: exceededCpu`.

## Task report

| Guarantee | Test / validation | Type | Result | Evidence |
|---|---|---|---|---|
| Current Drive `AF_initDataCallback` records are parsed without executing page JavaScript | `test/meta-publish.test.mjs` | Unit | PASS | RED: folder resolver threw the no-media error. GREEN: modern record test passed. |
| Extensionless shared files use Drive's media label and resolve to ordered thumbnails | `test/meta-publish.test.mjs` | Regression + live read | PASS | RED: production-shaped `PNG Image` entries returned zero items. GREEN: the real production folder returned four images named `1`–`4`. |
| Folder images use a direct `drive.usercontent.google.com/download` URL instead of the thumbnail redirect Meta rejected | `test/meta-publish.test.mjs` + live header check | Regression + live read | PASS | RED: Meta rejected the thumbnail redirect with `9004/2207052`. GREEN: all folder image tests return direct URLs and the production file responds `image/png`; production safe test remains a post-deploy gate. |
| Worker Meta sync caps an untrusted `postLimit=100` request at 25 | `test/post-retention.test.mjs` | Integration | PASS | RED: observed limits were `[100, 100]`. GREEN: observed limits were `[25, 25]` and `result.postLimit` was `25`. |
| Existing behavior remains intact | `npm test` | Full regression | PASS | 187/187 tests passed. |
| Coverage remains above the project gate | `npm run test:coverage` | Coverage | PASS | 90.14% lines, 78.42% branches, 93.23% functions; enforced line threshold is 80%. |
| Worker bundle remains deployable | `npm run deploy:check` | Build/deploy dry run | PASS | Wrangler read 37 assets and completed the dry run with all production bindings. |

## Checkpoints

- `d99455b` — RED for current Drive callback data.
- `09266cd` — RED for extensionless Drive media.
- `3c4543f` — RED for the Cloudflare 100-post CPU overflow.
- `f496076` — GREEN implementation for Drive parsing and bounded sync work.
- `022465b` — RED for Meta rejecting a Drive thumbnail redirect.
- `ba6e636` — GREEN implementation using direct Drive image downloads.

## Known boundaries

- The sync limit is deliberately 25 posts per fanpage invocation. This favors reliable recent-data refreshes over a single 100-post response; fanpage traversal remains cursor-based.
- Google Drive HTML is not a stable public API. Both the legacy embedded markup and the current callback data are supported, with regression coverage for each.
