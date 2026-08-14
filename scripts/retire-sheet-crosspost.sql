PRAGMA foreign_keys = ON;

DELETE FROM publish_attempts
WHERE postId IN (
  SELECT id FROM posts
  WHERE source = 'scheduled-sheet'
     OR COALESCE(sheetUrl, '') != ''
     OR COALESCE(sheetRowKey, '') != ''
     OR COALESCE(sheetDefaultFanpageId, '') != ''
);

DELETE FROM publish_jobs
WHERE postId IN (
  SELECT id FROM posts
  WHERE source = 'scheduled-sheet'
     OR COALESCE(sheetUrl, '') != ''
     OR COALESCE(sheetRowKey, '') != ''
     OR COALESCE(sheetDefaultFanpageId, '') != ''
);

DELETE FROM posts
WHERE source = 'scheduled-sheet'
   OR COALESCE(sheetUrl, '') != ''
   OR COALESCE(sheetRowKey, '') != ''
   OR COALESCE(sheetDefaultFanpageId, '') != '';

UPDATE fanpages SET crossPostInstagram = 0 WHERE crossPostInstagram != 0;
