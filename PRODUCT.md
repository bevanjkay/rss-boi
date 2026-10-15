# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Built first for its author and their household: a few people with their own accounts on one self-hosted server, reading on desktop and phone. Published as open source, so other self-hosters install it for themselves and their families; their needs matter, but they should not pull the product away from personal use.

## Product Purpose

RSS Boi is a self-hosted RSS reader. People subscribe to the sites they choose and read new posts newest first, without an algorithm deciding what comes next. Success is a reader people return to daily because it is calm, fast and comfortable to read in.

## Positioning

Your feeds, your way: a calm reader you run on your own server, with each feed checked on its own schedule, per-person accounts and read state, and nothing between you and the posts you subscribed to.

## Operating Context

- Runs as Docker Compose: React web app (`apps/web`), Fastify API (`apps/api`), background poller (`apps/worker`) and PostgreSQL.
- Used in the browser on desktop and installed to the phone Home Screen as a PWA, with unread counts on the app badge.
- Daily rhythm: open, read through Unread or Today, reach "All caught up".

## Capabilities and Constraints

- Per-user accounts with their own subscriptions and read state; an admin creates users.
- Per-feed check intervals (5 minutes to 1 day), conditional requests and failure backoff, feed debug info.
- Reader with keyboard shortcuts (switchable off per device), article PDF and images ZIP downloads, JSON subscription import/export.
- Reading options (typeface, including any Google Font proxied through the API, size, spacing, width) and themes (presets, a light and dark pairing that follows the device, and custom themes from three colours) are saved per account.
- Outbound fetches to private addresses are blocked unless allowlisted.
- Prebuilt images are amd64 only.

## Brand Commitments

- Name: RSS Boi. Mascot: the Boi (white character in a black beanie and hoodie holding an orange RSS sign), shown at the edges of a reading session, never mid-read.
- Voice: plain, calm and warm ("All caught up. Nothing left to read. The Boi will keep watch and new posts will land here.").
- Australian/UK spelling in copy.

## Evidence on Hand

- App icons and the Boi: `apps/web/public/` (`boi.webp`, `app-icons/`).
- Real screenshots of the app: `site/shots/`.
- No testimonials, user counts or benchmarks exist; do not invent them.

## Product Principles

- Reading comes first; chrome recedes while an article is open.
- Calm over engagement: no recommendations, streaks or attention tricks.
- Personal first, shareable second: defaults suit the author's household; options serve others without complicating them.
- Respect the reader's body and setting: comfort and accessibility are product features, not extras.

## Accessibility & Inclusion

- Reading options must serve people with low vision, dyslexia and light sensitivity, not only taste.
- Single-key shortcuts stay switchable off (WCAG 2.1.4); motion respects `prefers-reduced-motion`.
