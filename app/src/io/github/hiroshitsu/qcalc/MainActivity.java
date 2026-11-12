package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final String TAG = "QCalc";
    private static final String START_PAGE = "file:///android_asset/index.html";
    private static final int REQUEST_SAVE = 1;
    /** File names the page may suggest for a saved file (QCalc-history-20261112.csv). */
    private static final Pattern FILE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,99}");
    private static final int MAX_SAVE = 16 * 1024 * 1024;

    /** When the page's renderer last went away (to stop a crash loop). */
    private static long lastRendererGone;

    private WebView web;
    /** Holds the page (or a message). On Android 15 and later it is kept clear of the system bars. */
    private FrameLayout content;
    /** Colours the status bar area on Android 15 and later, where the bars are see-through. */
    private View statusScrim;
    private volatile boolean destroyed;
    private boolean backPending;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Engine.EventListener events = new Engine.EventListener() {
        @Override
        public void onEvent(String json) {
            sendEvent(json);
        }
    };
    /** QCalc Pro (the purchase in Google Play, see Pro.java). */
    private Pro pro;
    /** The text of a file being saved, while the system's file picker is open. */
    private String pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // first: on its first start a build with billing looks for the data of older versions
        pro = new Pro(this, new Pro.Listener() {
            @Override
            public void changed(String eventJson) {
                sendEvent(eventJson);
            }
        });
        pro.start();
        Engine.get(this).warmUp();
        setUpWindow();
        try {
            web = new WebView(this);
        } catch (RuntimeException e) {
            // the system WebView is missing, disabled or being updated
            Log.e(TAG, "WebView", e);
            showMessage(tr("QCalc needs Android System WebView, which is not available. "
                    + "Update it in the Play Store or turn it on in the Settings app, then open QCalc again.",
                    "画面の表示に必要な「Android System WebView」を利用できません。"
                    + "Play ストアで更新するか、設定アプリで有効にしてから、もう一度開いてください。"));
            return;
        }
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        web.setBackgroundColor(backgroundColor());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:///android_asset/")) return false;
                openExternal(url);
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // The page's renderer crashed or was stopped to free memory. Without this the
                // whole app would be closed. History and the current input are saved, so start again.
                if (view != web) return true;
                web = null;
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                long now = SystemClock.elapsedRealtime();
                boolean again = lastRendererGone != 0 && now - lastRendererGone < 15000;
                lastRendererGone = now;
                if (again) showMessage(tr("The screen stopped again and again. Close the app and open it again.",
                        "画面の表示が繰り返し停止しました。アプリを閉じて、もう一度開いてください。"));
                else recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                int level = m.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR
                        : m.messageLevel() == ConsoleMessage.MessageLevel.WARNING ? Log.WARN : Log.DEBUG;
                Log.println(level, TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        web.addJavascriptInterface(new JsApi(), "QalcNative");
        web.loadUrl(START_PAGE);
        content.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        Engine.get(this).setEventListener(events);
    }

    /**
     * The window: a root view, an area for the page, the system bar colours and the back key.
     * Apps targeting Android 15 or later are always drawn edge to edge on Android 15 and later,
     * so there the page is moved clear of the status bar, the navigation bar, display cutouts
     * and the keyboard. Older versions keep the system's own layout.
     */
    private void setUpWindow() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(navigationBarColor());
        statusScrim = new View(this);
        statusScrim.setBackgroundColor(statusBarColor());
        root.addView(statusScrim, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        content = new FrameLayout(this);
        content.setBackgroundColor(backgroundColor());
        root.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) content.getLayoutParams();
                    lp.setMargins(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                    content.setLayoutParams(lp);
                    FrameLayout.LayoutParams sp = (FrameLayout.LayoutParams) statusScrim.getLayoutParams();
                    sp.height = bars.top;
                    statusScrim.setLayoutParams(sp);
                    return WindowInsets.CONSUMED;
                }
            });
        }
        setContentView(root);
        applySystemBarColors();
        if (Build.VERSION.SDK_INT >= 33) {
            // Android 13 and later (android:enableOnBackInvokedCallback="true" in the manifest).
            // Apps targeting Android 16 no longer get onBackPressed() there.
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackInvokedCallback() {
                        @Override
                        public void onBackInvoked() {
                            handleBack();
                        }
                    });
        }
    }

    /**
     * The text in the language of the app: Japanese when it is chosen in the page's settings
     * ("Language / 言語", saved by the page as qalc.settings), otherwise English.
     */
    private String tr(String en, String ja) {
        try {
            String s = StateStore.load(this, "qalc.settings");
            if (s != null && "ja".equals(new JSONObject(s).optString("lang"))) return ja;
        } catch (Exception ignored) {
        }
        return en;
    }

    private void showMessage(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(17);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        t.setPadding(pad, pad, pad, pad);
        t.setTextColor(isDark() ? Color.WHITE : Color.BLACK);
        t.setBackgroundColor(backgroundColor());
        content.removeAllViews();
        content.addView(t, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** The back key on Android 12 and earlier (later versions use the callback in setUpWindow). */
    @Override
    public void onBackPressed() {
        handleBack();
    }

    /** Closes what is open on the page (sheet, menu, panel, keyboard mode); otherwise leaves the app. */
    private void handleBack() {
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        if (backPending) return;
        backPending = true;
        // If the page does not answer (busy), behave like the system default.
        final Runnable fallback = new Runnable() {
            @Override
            public void run() {
                if (!backPending) return;
                backPending = false;
                moveTaskToBack(true);
            }
        };
        ui.postDelayed(fallback, 800);
        web.evaluateJavascript("(window.qalcBack && window.qalcBack()) ? 1 : 0", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!backPending) return;
                backPending = false;
                ui.removeCallbacks(fallback);
                // Like the system's default for the main screen: keep the app in memory, so the
                // current input is still there when it is opened again.
                if (!"1".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // a purchase may have been made or completed outside the app (a pending payment, a promo code)
        if (pro != null) pro.refresh();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.evaluateJavascript("window.qalcPause && window.qalcPause()", null);
            web.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        Engine.get(this).clearEventListener(events);
        if (pro != null) pro.end();
        WebView w = web;
        web = null;
        if (w != null) {
            ViewGroup parent = (ViewGroup) w.getParent();
            if (parent != null) parent.removeView(w);
            w.removeJavascriptInterface("QalcNative");
            w.stopLoading();
            w.destroy();
        }
        super.onDestroy();
    }

    private boolean isDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private int backgroundColor() {
        return isDark() ? Color.rgb(18, 20, 24) : Color.rgb(246, 247, 249);
    }

    /** Same colour as the top bar of the page. */
    private int statusBarColor() {
        return isDark() ? Color.rgb(28, 31, 38) : Color.rgb(255, 255, 255);
    }

    /** Same colour as the keypad area; dark icons on a light bar exist from Android 8.0. */
    private int navigationBarColor() {
        boolean lightNav = !isDark() && Build.VERSION.SDK_INT >= 26;
        return lightNav ? Color.rgb(246, 247, 249) : Color.rgb(18, 20, 24);
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarColors() {
        Window w = getWindow();
        boolean dark = isDark();
        boolean lightNav = !dark && Build.VERSION.SDK_INT >= 26;
        if (Build.VERSION.SDK_INT >= 35) {
            // the bars are see-through; the views behind them give the colour
            w.setNavigationBarContrastEnforced(false);
        } else {
            w.setStatusBarColor(statusBarColor());
            w.setNavigationBarColor(navigationBarColor());
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                int light = (dark ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
                        | (lightNav ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0);
                c.setSystemBarsAppearance(light, mask);
            }
        } else {
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (lightNav) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    /** Opens web links in the browser; other kinds of links are ignored. */
    private void openExternal(String url) {
        if (url == null) return;
        Uri u = Uri.parse(url);
        String scheme = u.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) {
        }
    }

    /** The app's version name (for example "1.1.0"), or "" if it cannot be read. */
    private String versionName() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName != null ? pi.versionName : "";
        } catch (Exception e) {
            return "";
        }
    }

    /** The system's file picker for saving a file has closed: write the file (on a background thread). */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_SAVE) return;
        final String text = pendingSave;
        pendingSave = null;
        final Uri uri = data != null ? data.getData() : null;
        if (resultCode != RESULT_OK || uri == null) {
            sendEvent("{\"event\":\"saved\",\"ok\":false,\"cancelled\":true}");
            return;
        }
        if (text == null) {
            // the app was closed while the file picker was open
            sendEvent("{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                try {
                    OutputStream out = getContentResolver().openOutputStream(uri, "wt");
                    if (out != null) {
                        try {
                            out.write(text.getBytes(Charset.forName("UTF-8")));
                            ok = true;
                        } finally {
                            out.close();
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "save", e);
                    ok = false;
                }
                sendEvent(ok ? "{\"event\":\"saved\",\"ok\":true}"
                        : "{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
            }
        }, "qalc-save").start();
    }

    /** Hands an event (one JSON object) to the page: engine events, QCalc Pro, saved files. */
    private void sendEvent(String json) {
        runScript("window.QalcBridge && QalcBridge.receiveEvent && QalcBridge.receiveEvent(" + JSONObject.quote(json) + ")");
    }

    /** Hands an engine response (one JSON line) to the page; the page parses it. */
    private void deliver(String json) {
        runScript("window.QalcBridge && QalcBridge.receiveText(" + JSONObject.quote(json) + ")");
    }

    private void runScript(final String script) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (!destroyed && web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    /** Methods callable from the page as window.QalcNative.* (run on a background thread). */
    final class JsApi {

        @JavascriptInterface
        public void send(String request) {
            Engine.get(MainActivity.this).submit(request, new Engine.Callback() {
                @Override
                public void done(String response) {
                    deliver(response);
                }
            });
        }

        @JavascriptInterface
        public void updateRates(final int id) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String r;
                    try {
                        r = RatesUpdater.update(Engine.get(MainActivity.this), id, versionName());
                    } catch (RuntimeException e) {
                        r = "{\"id\":" + id + ",\"ok\":false,\"error\":\"Could not update the exchange rates\"}";
                    }
                    deliver(r);
                }
            }, "qalc-rates").start();
        }

        @JavascriptInterface
        public void cancel() {
            Engine.get(MainActivity.this).cancel();
        }

        @JavascriptInterface
        public String loadState(String name) {
            return StateStore.load(MainActivity.this, name);
        }

        @JavascriptInterface
        public void saveState(String name, String data) {
            StateStore.save(MainActivity.this, name, data);
        }

        @JavascriptInterface
        public void copy(final String text) {
            if (text == null) return;
            ui.post(new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    try {
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("QCalc", text));
                    } catch (RuntimeException e) {
                        // the system passes the text in one transaction of at most about 1 MB
                        Toast.makeText(MainActivity.this, tr("Too long to copy", "長すぎてコピーできませんでした"), Toast.LENGTH_LONG).show();
                        return;
                    }
                    // Android 13 and later show their own confirmation
                    if (Build.VERSION.SDK_INT < 33) Toast.makeText(MainActivity.this, tr("Copied", "コピーしました"), Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String appInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("version", versionName());
                o.put("android", Build.VERSION.RELEASE);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("dark", isDark());
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    openExternal(url);
                }
            });
        }

        /** QCalc Pro: {billing, pro, legacy, price, state} (see Pro.info()). */
        @JavascriptInterface
        public String proInfo() {
            return pro != null ? pro.info() : "{\"billing\":\"none\"}";
        }

        @JavascriptInterface
        public void buyPro() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (pro != null && !destroyed) pro.buy(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void restorePro() {
            if (pro != null) pro.restore();
        }

        @JavascriptInterface
        public void refreshPro() {
            if (pro != null) pro.refresh();
        }

        /** Test builds only: see the app with or without Pro. */
        @JavascriptInterface
        public void setTestPro(boolean unlocked) {
            if (pro != null) pro.setTestUnlocked(unlocked);
        }

        /**
         * Saves a text file where the user chooses (the system's file picker); the result comes
         * as a "saved" event. Only CSV files with a plain name, as the page makes them.
         */
        @JavascriptInterface
        public void saveFile(final String name, String mime, final String text) {
            if (name == null || text == null || !FILE_NAME.matcher(name).matches() || !"text/csv".equals(mime)
                    || text.length() > MAX_SAVE) {
                sendEvent("{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
                return;
            }
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (destroyed) return;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("text/csv");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    pendingSave = text;
                    try {
                        startActivityForResult(i, REQUEST_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSave = null;
                        sendEvent("{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
                    }
                }
            });
        }
    }
}
