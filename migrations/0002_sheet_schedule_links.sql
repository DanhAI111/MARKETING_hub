ALTER TABLE posts ADD COLUMN sheetUrl TEXT;
ALTER TABLE posts ADD COLUMN sheetRowKey TEXT;
ALTER TABLE posts ADD COLUMN sheetDefaultFanpageId TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sheet_row
  ON posts(sheetUrl, sheetRowKey)
  WHERE sheetUrl IS NOT NULL AND sheetRowKey IS NOT NULL;
