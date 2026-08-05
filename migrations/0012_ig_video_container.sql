-- IG video (Reels) needs async server-side encoding (30-90s). Polling the container to
-- FINISHED inside one cron invocation exceeds Cloudflare's per-invocation CPU limit and
-- silently kills the isolate, stranding the post (see publish-stale-root-cause). Instead
-- we defer: tick 1 creates the REELS container and parks its id here; a later tick checks
-- status once (cheap) and publishes. igContainerId non-empty => a publish is mid-flight.
ALTER TABLE posts ADD COLUMN igContainerId TEXT;
