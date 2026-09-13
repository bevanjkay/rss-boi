-- Covers the per-feed timeline sort (published_at DESC, id DESC) so a feed page
-- no longer needs an extra sort step after the index scan.
DROP INDEX "entries_feed_id_published_at_idx";
CREATE INDEX "entries_feed_id_published_at_id_idx" ON "entries"("feed_id", "published_at", "id");
