# Google App Share Link Test (Android)

This is a small proof of concept, not the Canvau app.

## What it tests

1. Sends a user-entered HTTP(S) URL to the installed Google app using Android `ACTION_VIEW`, explicitly targeting package `com.google.android.googlequicksearchbox`.
2. Registers as a text-sharing destination.
3. Receives the text the user shares back from the Google app and checks whether it contains a `share.google` or `search.app` URL.

It does not generate, guess, or fabricate Google tokens. The short URL must come back from the Google app itself.

## Build and run

1. Open this `android-google-share-test` folder in Android Studio.
2. Use JDK 17 and install Android SDK Platform 35 if prompted.
3. Build and install the app on a physical Android phone with the Google app installed.
4. In Google app: Profile picture → Settings → General → enable **Open web pages in the app**.
5. In the same settings page, enable **Shorten links to web pages**.
6. Open this test app, paste an original URL, and tap **Open in Google App**.
7. In the Google app, use its Share button and select **Google Share Test** from the Android Sharesheet.
8. Record whether the received URL starts with `https://share.google/` or `https://search.app/`.

## Important test limits

- Google documents that the Google app can generate short links such as `share.google` and `search.app`, and that link shortening can be disabled in its settings.
- Android documents the generic `ACTION_VIEW` and `ACTION_SEND` app-to-app mechanisms; Google does not document a dedicated public API that returns a short link to another app.
- Whether the Google app accepts an arbitrary URL through the targeted `ACTION_VIEW` intent, and whether the share action returns a shortened link to a receiving app, must be verified on a real device and may vary by Google app version/account/settings.
- A PASS on one device is not proof of zero-click automation. The user still performs the Share action.

Official references:
- https://support.google.com/websearch/answer/7013866
- https://developer.android.com/develop/ui/compose/sharing/send
