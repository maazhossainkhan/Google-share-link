# Canvau — Google Share Link Manager

Canvau is a Telegram-only web app for managing links submitted by approved Telegram users.

## Initial scope
- Telegram Mini App authentication using Telegram's signed `initData`.
- New users submit an access request; an administrator approves or rejects access.
- Approved users submit an original URL and save the genuine Google share URL returned by a supported Google sharing workflow.
- Users can view their own previously saved links.
- Admins can review access requests.

## Important Google-link limitation
Canvau must not invent `share.google/<token>` values or rely on undocumented/private Google endpoints. A valid Google share URL must be produced by Google's own supported sharing flow. Until an official/verified generation method is integrated, the app must clearly report that generation is not available rather than returning a fake link. A companion Android share-intent workflow can be evaluated separately.

## Repository layout
- `canvau/` — application design and implementation.
- `supabase/migrations/` — database schema and security policies.

## Configuration
Secrets belong in Supabase Edge Function secrets / server environment variables, never in browser code:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_IDS` (comma-separated numeric Telegram user IDs)

## Development status
Foundation and database schema are being added on the `main` branch. The existing Supabase project is intentionally not modified.
