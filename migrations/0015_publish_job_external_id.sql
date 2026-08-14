-- Persist the platform media id before the posts row is finalized. This makes
-- a completed Meta mutation recoverable without repeating the external call.
ALTER TABLE publish_jobs ADD COLUMN externalPostId TEXT;

-- Facebook durable jobs historically stored the final post id in
-- parentContainerId. Instagram stores a creation container there, so only the
-- Facebook rows are safe to backfill.
UPDATE publish_jobs
SET externalPostId = parentContainerId
WHERE platform = 'facebook'
  AND stage = 'completed'
  AND parentContainerId IS NOT NULL
  AND parentContainerId != '';
