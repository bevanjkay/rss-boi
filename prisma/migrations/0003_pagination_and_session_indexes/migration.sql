-- Supports keyset pagination over the aggregate timeline (published_at DESC, id DESC).
CREATE INDEX "entries_published_at_id_idx" ON "entries"("published_at", "id");

-- Supports pruning of expired sessions.
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
