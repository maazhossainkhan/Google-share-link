# Canvau implementation notes

## User flow
1. Open the Mini App from the Telegram bot.
2. Send Telegram `initData` to the server for signature and freshness validation.
3. If the Telegram ID is unknown, create a pending user and access request.
4. Pending/rejected/blocked users cannot access the link dashboard.
5. An administrator approves the request.
6. Approved users can submit an original URL and view only their own saved records.

## Admin flow
- Admin identity is determined from server-side `TELEGRAM_ADMIN_IDS`, not from browser-supplied role flags.
- Admin endpoints must independently verify Telegram `initData` and check the configured admin ID.
- Approval/rejection updates both the user access state and the associated request record.

## Link-generation contract
- The server accepts a Google share URL only after it has been returned by a verified Google-supported sharing flow.
- Never construct a share token, guess a token, scrape private endpoints, or treat a normal redirect as a Google share link.
- The UI must distinguish "not yet connected" from a successful conversion.
- Investigate an Android companion app/share-target proof of concept separately; do not claim zero-click conversion until demonstrated with real Google App output.

## Security requirements
- Verify Telegram Web App init data on the server with the bot token.
- Reject stale authentication payloads.
- Keep the bot token and Supabase service-role key server-side.
- Do not expose service-role database access to the browser.
- Apply per-user ownership checks in every link-list/create endpoint.
- Validate URL scheme and length; accept HTTPS/HTTP URLs only.
