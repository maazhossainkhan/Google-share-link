# Canvau cPanel deployment

This folder is the website document root for the Canvau Telegram Mini App.

## Upload

1. Upload the **contents** of this folder to the cPanel domain's `public_html` directory.
2. Keep `.htaccess`, `config.php`, `config.js`, `go.php`, `index.html`, `app.js`, and `styles.css` together.
3. Enable HTTPS for `canvau.com`.
4. PHP cURL must be enabled for short-link redirects. PHP 7.4 or newer is recommended.

## Supabase

The project is separate from `google-trim-shadow`:
- Project ref: `pnlzohecnaayoaxjjiuc`
- Project URL: `https://pnlzohecnaayoaxjjiuc.supabase.co`

Deploy these Edge Functions with JWT verification disabled (the two user-facing functions validate Telegram's signed `initData` themselves; the public redirect endpoint resolves public short codes):
- `telegram-mini-auth`
- `canvau-api`
- `canvau-redirect`

Set these **server-side** Edge Function secrets in Supabase Dashboard → Edge Functions → Secrets:
- `TELEGRAM_BOT_TOKEN`: the Canvau Telegram bot token
- `TELEGRAM_ADMIN_IDS`: comma-separated Telegram numeric IDs allowed to approve requests
- `CANVAU_BASE_URL`: `https://canvau.com`

Do not put the bot token or Supabase service-role key in this folder. The publishable key in `config.js` and `config.php` is intended for public client use.

## Telegram

Set the bot's Mini App / Web App URL to `https://canvau.com`. The page must be opened inside Telegram so that Telegram supplies signed `initData`.

## Google share-link limitation

Canvau creates its own short URL first. A `share.google` or `search.app` URL can only be saved after it is returned by Google's own app sharing flow. Google does not publish a server-side API for minting these URLs. The current web UI therefore asks the user to paste the returned Google URL; it does not invent a Google token. The URL validation checks the Google-owned hostname, but cannot independently prove how the user obtained that URL.

The Android proof-of-concept in `android-google-share-test/` tests whether a physical Android device can pass an arbitrary Canvau short URL through the Google app and receive its shortened URL through the Android Sharesheet. That still needs testing on a real phone and may vary with the Google app version and settings.

## Redirect behaviour

`.htaccess` rewrites `https://canvau.com/{short_code}` to `go.php`, which asks the public `canvau-redirect` Edge Function for the destination and forwards its HTTP redirect. The function checks active/expiry state and increments the click counter atomically.
