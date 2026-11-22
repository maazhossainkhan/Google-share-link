package com.canvau.googlesharetest

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var urlInput: EditText
    private lateinit var resultView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        handleIncomingShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingShare(intent)
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 42, 36, 36)
            gravity = Gravity.TOP
        }

        val heading = TextView(this).apply {
            text = "Google App Share Link Test"
            textSize = 23f
        }
        root.addView(heading)

        val help = TextView(this).apply {
            text = "1) Paste an original URL.\n2) Open it directly in the Google app.\n3) In Google app, tap Share and select “Google Share Test”.\n4) This app will inspect the URL returned by Google."
            textSize = 15f
            setPadding(0, 20, 0, 20)
        }
        root.addView(help)

        urlInput = EditText(this).apply {
            hint = "https://example.com/page"
            setSingleLine(true)
            textSize = 15f
        }
        root.addView(urlInput, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        val openButton = Button(this).apply {
            text = "Open in Google App"
            setOnClickListener { openInGoogleApp() }
        }
        root.addView(openButton)

        resultView = TextView(this).apply {
            text = "Waiting for a link from Google App…"
            textSize = 15f
            setPadding(0, 24, 0, 0)
            textIsSelectable = true
        }
        root.addView(resultView)
        setContentView(root)
    }

    private fun openInGoogleApp() {
        val raw = urlInput.text.toString().trim()
        val uri = runCatching { Uri.parse(raw) }.getOrNull()
        if (uri == null || (uri.scheme != "https" && uri.scheme != "http") || uri.host.isNullOrBlank()) {
            resultView.text = "Please enter a valid HTTP or HTTPS URL."
            return
        }

        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage(GOOGLE_APP_PACKAGE)
        }

        try {
            startActivity(intent)
            resultView.text = "Opened with Google app. In Google app, use its Share button and choose “Google Share Test”."
        } catch (_: ActivityNotFoundException) {
            resultView.text = "Google app did not accept this URL through ACTION_VIEW on this device. This is an important test result; do not use Chrome as a substitute."
        } catch (e: Exception) {
            resultView.text = "Could not launch Google app: ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    private fun handleIncomingShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        if (sharedText.isBlank()) {
            resultView.text = "Google share action returned no text."
            return
        }

        val candidate = SHARE_URL.find(sharedText)?.value?.trimEnd('.', ',', ')', ']', '>')
        val isGoogleShortLink = candidate != null &&
            (Uri.parse(candidate).host.equals("share.google", true) ||
             Uri.parse(candidate).host.equals("www.share.google", true) ||
             Uri.parse(candidate).host.equals("search.app", true))

        resultView.text = buildString {
            append(if (isGoogleShortLink) "PASS: Google short-link domain received.\n\n" else "NOT A GOOGLE SHORT LINK (yet).\n\n")
            append("Received text:\n")
            append(sharedText)
            if (candidate != null) {
                append("\n\nDetected URL:\n")
                append(candidate)
            }
        }
    }

    companion object {
        private const val GOOGLE_APP_PACKAGE = "com.google.android.googlequicksearchbox"
        private val SHARE_URL = Regex("https?://[^\\s]+", RegexOption.IGNORE_CASE)
    }
}
