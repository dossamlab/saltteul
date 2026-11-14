package kr.saltteul.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import kr.saltteul.app.widget.OpenTargets;
import kr.saltteul.app.widget.RefreshJob;

/**
 * The Capacitor activity plus the widget contract (design 2026-11-14 section 6): a widget launch carries
 * OpenTargets.EXTRA_OPEN, which is handed to the web page as window.saltteulOpen(target) (or left in
 * window.__saltteulPendingOpen until the web app starts), and SaltteulNative.captureDone() sends the app back to the
 * home screen after a quick add that a widget opened.
 */
public class MainActivity extends BridgeActivity {

    /** Set on an intent once its target was taken, so the same intent is never handled twice. */
    private static final String EXTRA_HANDLED = "kr.saltteul.app.OPEN_HANDLED";

    /** The page has finished loading (reset when it starts loading again, e.g. a live update switching screens). */
    private boolean pageLoaded;
    /** Target waiting for the page to load. */
    private String pendingTarget;
    /** The current launch came from a widget's quick-add target; only then does captureDone() leave the app. */
    private boolean widgetCapture;
    /** True while onCreate restores an activity; its intent is the old launch, not a new tap. */
    private boolean restoring;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        restoring = savedInstanceState != null;
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                pageLoaded = false;
            }

            @Override
            public void onPageLoaded(WebView webView) {
                pageLoaded = true;
                deliverOpen();
            }
        });
        // BridgeActivity.load() creates the WebView and passes the launch intent to onNewIntent.
        super.onCreate(savedInstanceState);
        restoring = false;
        WebView webView = bridge == null ? null : bridge.getWebView();
        // Added in the same UI task that started the first load, so the page that is loading already sees it.
        if (webView != null) webView.addJavascriptInterface(new NativeBridge(), "SaltteulNative");
        // No-op when load() already handled it (marked); covers a Capacitor version that stops doing that.
        handleOpen(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent != getIntent()) setIntent(intent);
        handleOpen(intent);
    }

    @Override
    public void onStop() {
        super.onStop();
        // Leaving the app: show what was just changed (or the new sign-in) on the home-screen widgets.
        RefreshJob.enqueue(this, true);
    }

    private void handleOpen(Intent intent) {
        if (intent == null || intent.getBooleanExtra(EXTRA_HANDLED, false)) return;
        intent.putExtra(EXTRA_HANDLED, true);
        String target = intent.getStringExtra(OpenTargets.EXTRA_OPEN);
        // Reopening from recents (or a restore) replays the old intent: do not open quick add again.
        boolean replay = restoring || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (replay || !OpenTargets.isValid(target)) {
            // A plain launch (launcher icon, notification) ends a quick add that a widget opened.
            if (!replay) widgetCapture = false;
            return;
        }
        widgetCapture = OpenTargets.isCapture(target);
        pendingTarget = target;
        deliverOpen();
    }

    /** UI thread only. Waits for the page; the web app takes it now (saltteulOpen) or at start-up (pending value). */
    private void deliverOpen() {
        if (!pageLoaded || pendingTarget == null || bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        String target = pendingTarget;
        pendingTarget = null;
        webView.evaluateJavascript(OpenTargets.deliverScript(target), null);
        // The web focuses the text box for capture, but a WebView does not always raise the soft keyboard for a
        // focus set from script. capture-mic records instead, so it gets no keyboard.
        if (OpenTargets.CAPTURE.equals(target)) {
            for (long delay : KEYBOARD_DELAYS_MS) webView.postDelayed(new ShowKeyboard(webView), delay);
        }
    }

    /** After the sheet has rendered and focused its box; the second try covers a slow cold start. */
    private static final long[] KEYBOARD_DELAYS_MS = {350L, 1200L};

    private final class ShowKeyboard implements Runnable {
        private final WebView webView;

        ShowKeyboard(WebView webView) {
            this.webView = webView;
        }

        @Override
        public void run() {
            if (!widgetCapture || isFinishing()) return; // already saved, cancelled or left
            webView.requestFocus();
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(webView, 0);
        }
    }

    /** window.SaltteulNative in the web page. */
    private final class NativeBridge {
        /** Quick add opened from a widget was saved or cancelled: back to the home screen. Ignored otherwise. */
        @JavascriptInterface
        public void captureDone() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!widgetCapture) return;
                    widgetCapture = false;
                    moveTaskToBack(true);
                }
            });
        }
    }
}
