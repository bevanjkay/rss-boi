-- Per-user reading options and themes, plus a cache for proxied Google Fonts.
ALTER TABLE "users" ADD COLUMN "reading_preferences" JSONB;

CREATE TABLE "font_families" (
    "family" TEXT NOT NULL,
    "css" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "font_families_pkey" PRIMARY KEY ("family")
);

CREATE TABLE "font_files" (
    "path" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "data" BYTEA,
    "content_type" TEXT,
    "fetched_at" TIMESTAMP(3),

    CONSTRAINT "font_files_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "font_files_family_idx" ON "font_files"("family");

ALTER TABLE "font_files" ADD CONSTRAINT "font_files_family_fkey" FOREIGN KEY ("family") REFERENCES "font_families"("family") ON DELETE CASCADE ON UPDATE CASCADE;
