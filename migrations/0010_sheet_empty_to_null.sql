-- Empty-string sheet keys land inside the partial UNIQUE index idx_posts_sheet_row
-- (WHERE sheetUrl IS NOT NULL), so every sheet-less post collides on publish/run-test.
-- Normalize legacy '' rows back to NULL; new writes now coalesce '' -> NULL in upsertPost.
UPDATE posts SET sheetUrl = NULL WHERE sheetUrl = '';
UPDATE posts SET sheetRowKey = NULL WHERE sheetRowKey = '';
