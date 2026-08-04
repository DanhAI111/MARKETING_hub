-- mediaUrl duplicated the base64 bytes already stored in mediaItems, bloating rows.
-- It is only a thumbnail fallback; data: URIs render fine from mediaItems. Clear them.
UPDATE posts SET mediaUrl = '' WHERE mediaUrl LIKE 'data:%';
