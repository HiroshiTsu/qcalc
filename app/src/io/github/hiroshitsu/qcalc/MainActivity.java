package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.app.LocaleManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.LocaleList;
import android.os.Looper;
import android.os.StrictMode;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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
    /** The page's setting "Light or dark": "system" (the phone's setting), "light" or "dark". */
    private volatile String appearance = "system";
    /** The view behind the page; its colour shows behind the navigation bar. */
    private FrameLayout root;
    /** The language of the app (see Lang), once the page has asked for it (QalcNative.startLang). */
    private volatile String appLang;
    /** The languages of the app's configuration when they were last looked at (onConfigurationChanged). */
    private String configLocales;
    /** When onCreate began (SystemClock.elapsedRealtime), for the times of the start in the log. */
    private long createdAt;
    /** The page has reported that it is ready (reportFullyDrawn is called once). */
    private boolean fullyDrawn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        createdAt = SystemClock.elapsedRealtime();
        if (getPackageName().endsWith(".debug")) strictMode();
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 24) {
            Log.i(TAG, "startup: onCreate " + (createdAt - android.os.Process.getStartElapsedRealtime()) + " ms after the process started");
        }
        appearance = savedAppearance();
        configLocales = getResources().getConfiguration().getLocales().toLanguageTags();
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
                    + "Play ストアで更新するか、設定アプリで有効にしてから、もう一度開いてください。",
                    "QCalc necesita Android System WebView, que no está disponible. "
                    + "Actualízalo en Play Store o actívalo en la app Ajustes, y vuelve a abrir QCalc.",
                    "QCalc braucht Android System WebView, das nicht verfügbar ist. "
                    + "Aktualisiere es im Play Store oder aktiviere es in der App Einstellungen und öffne QCalc dann erneut.",
                    "QCalc a besoin d’Android System WebView, qui n’est pas disponible. "
                    + "Mettez-le à jour dans le Play Store ou activez-le dans l’app Paramètres, puis rouvrez QCalc.",
                    "화면 표시에 필요한 ‘Android System WebView’를 쓸 수 없습니다. "
                    + "Play 스토어에서 업데이트하거나 설정 앱에서 사용 설정한 뒤 QCalc를 다시 여세요.",
                    "QCalc 需要 Android System WebView，但目前無法使用。"
                    + "請在 Play 商店更新它，或在「設定」App 中啟用，然後再次開啟 QCalc。"));
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
                        "画面の表示が繰り返し停止しました。アプリを閉じて、もう一度開いてください。",
                        "La pantalla se detuvo una y otra vez. Cierra la app y vuelve a abrirla.",
                        "Die Anzeige ist immer wieder abgestürzt. Schließe die App und öffne sie erneut.",
                        "L’écran s’est arrêté à plusieurs reprises. Fermez l’app et rouvrez-la.",
                        "화면 표시가 계속 멈췄습니다. 앱을 닫고 다시 여세요.",
                        "畫面一再停止。請關閉 App 後再重新開啟。"));
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
     * Test builds only (the package name ends in .debug, as with build-apk.sh and Gradle's debug
     * build; 1.12.0): StrictMode writes to the log what the main thread reads from or writes to the
     * disk or the network, and leaked objects, without stopping anything (adb logcat -s StrictMode).
     */
    private static void strictMode() {
        StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build());
        StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().detectLeakedSqlLiteObjects()
                .detectLeakedClosableObjects().detectActivityLeaks().penaltyLog().build());
    }

    /**
     * The window: a root view, an area for the page, the system bar colours and the back key.
     * Apps targeting Android 15 or later are always drawn edge to edge on Android 15 and later,
     * so there the page is moved clear of the status bar, the navigation bar, display cutouts
     * and the keyboard. Older versions keep the system's own layout.
     */
    private void setUpWindow() {
        root = new FrameLayout(this);
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
     * The text in the language of the app (1.11.0: the language that Lang chooses, as the page has
     * it; before the page has asked, the same choice is made without keeping anything). The texts
     * are given in the order of Lang.CODES.
     */
    private String tr(String en, String ja, String es, String de, String fr, String ko, String zh) {
        String[] texts = {en, ja, es, de, fr, ko, zh};
        String lang = appLang;
        if (lang == null) lang = chooseLang(false, false).lang;
        for (int i = 0; i < Lang.CODES.length; i++) {
            if (Lang.CODES[i].equals(lang)) return texts[i];
        }
        return en;
    }

    /**
     * Chooses the language of the app (see Lang) from what is saved, the language set for QCalc in
     * the system settings and the device's languages. With keep, what the choice changed is saved
     * (qalc.lang, qalc.langsys, qalc.langinit), the system setting is made to agree, and the
     * language becomes the app's (appLang).
     *
     * @param pageHad the page has history or settings of its own (in localStorage)
     */
    private synchronized Lang.Choice chooseLang(boolean pageHad, boolean keep) {
        boolean perAppSupported = Build.VERSION.SDK_INT >= 33;
        String saved = Lang.saved(StateStore.load(this, "qalc.lang"));
        String sys = Lang.saved(StateStore.load(this, "qalc.langsys"));
        boolean init = StateStore.has(this, "qalc.langinit");
        boolean had = pageHad || StateStore.has(this, "qalc.history") || StateStore.has(this, "qalc.settings");
        Lang.Choice c = Lang.choose(perAppSupported, perAppSupported ? appLocale() : null, saved, sys, init, had,
                deviceLocales());
        if (!keep) return c;
        // the record of the system setting is changed only when the system took the language
        if (c.system != null && !setAppLocale(c.system)) c.sys = sys;
        if (!same(c.saved, saved)) StateStore.save(this, "qalc.lang", c.saved != null ? Lang.json(c.saved) : null);
        if (!same(c.sys, sys)) StateStore.save(this, "qalc.langsys", c.sys != null ? Lang.json(c.sys) : null);
        if (!init) StateStore.save(this, "qalc.langinit", "1");
        appLang = c.lang;
        return c;
    }

    private static boolean same(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    private static List<Locale> list(LocaleList l) {
        List<Locale> out = new ArrayList<Locale>();
        if (l != null) {
            for (int i = 0; i < l.size(); i++) out.add(l.get(i));
        }
        return out;
    }

    /**
     * The device's languages, the first first. On Android 13 and later they come from LocaleManager,
     * because the app's own configuration then has the language set for QCalc instead.
     */
    private List<Locale> deviceLocales() {
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                LocaleManager m = getSystemService(LocaleManager.class);
                if (m != null) return list(m.getSystemLocales());
            } catch (RuntimeException e) {
                Log.w(TAG, "system locales", e);
            }
        }
        return list(Resources.getSystem().getConfiguration().getLocales());
    }

    /** The language set for QCalc in the system settings (Android 13 and later), or null for none. */
    private String appLocale() {
        if (Build.VERSION.SDK_INT < 33) return null;
        try {
            LocaleManager m = getSystemService(LocaleManager.class);
            return m != null ? Lang.first(list(m.getApplicationLocales())) : null;
        } catch (RuntimeException e) {
            Log.w(TAG, "app locales", e);
            return null;
        }
    }

    /** Sets the language for QCalc in the system settings (Android 13 and later); false if it could not be set. */
    private boolean setAppLocale(String code) {
        if (Build.VERSION.SDK_INT < 33) return false;
        try {
            LocaleManager m = getSystemService(LocaleManager.class);
            if (m == null) return false;
            if (!code.equals(Lang.first(list(m.getApplicationLocales())))) {
                m.setApplicationLocales(LocaleList.forLanguageTags(code));
            }
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "set app locales", e);
            return false;
        }
    }

    /** Puts the language set for QCalc in the system settings back to the system default (Android 13 and later). */
    private void clearAppLocale() {
        if (Build.VERSION.SDK_INT < 33) return;
        try {
            LocaleManager m = getSystemService(LocaleManager.class);
            if (m != null && !m.getApplicationLocales().isEmpty()) m.setApplicationLocales(LocaleList.getEmptyLocaleList());
        } catch (RuntimeException e) {
            Log.w(TAG, "clear app locales", e);
        }
    }

    /**
     * The configuration changed without the activity being made again (configChanges in the
     * manifest; 1.11.0 adds locale and layoutDirection). When the languages changed (in the system
     * settings, for the device or for QCalc) and the app's language with them, the page is told,
     * and loads itself again in the new language, keeping the history and what is being typed.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        String tags = newConfig.getLocales().toLanguageTags();
        if (tags.equals(configLocales)) return;
        configLocales = tags;
        String before, now;
        synchronized (this) {
            before = appLang;
            if (before == null || web == null) return;
            now = chooseLang(false, true).lang;
        }
        if (!now.equals(before)) {
            runScript("window.qalcLanguage && window.qalcLanguage(" + JSONObject.quote(now) + ")");
        }
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

    /** Whether the app is shown dark: the page's setting "Light or dark", or else the phone's setting. */
    private boolean isDark() {
        String a = appearance;
        if ("dark".equals(a)) return true;
        if ("light".equals(a)) return false;
        return isSystemDark();
    }

    /** The phone's own setting (dark theme). */
    private boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The setting "Light or dark" as the page saved it with its other settings (qalc.settings). */
    private String savedAppearance() {
        // a small file read on the main thread on purpose: the colours of the window must be right
        // before its first frame (StrictMode of the test builds is told so)
        StrictMode.ThreadPolicy policy = StrictMode.allowThreadDiskReads();
        try {
            String s = StateStore.load(this, "qalc.settings");
            if (s != null) {
                String a = new JSONObject(s).optString("appearance", "system");
                if ("dark".equals(a) || "light".equals(a)) return a;
            }
        } catch (Exception ignored) {
        } finally {
            StrictMode.setThreadPolicy(policy);
        }
        return "system";
    }

    /** Colours everything outside the page again (after the setting "Light or dark" changed). */
    private void applyColors() {
        if (root != null) root.setBackgroundColor(navigationBarColor());
        if (statusScrim != null) statusScrim.setBackgroundColor(statusBarColor());
        if (content != null) content.setBackgroundColor(backgroundColor());
        if (web != null) web.setBackgroundColor(backgroundColor());
        applySystemBarColors();
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

    /**
     * Runs r on the UI thread. An exception there is written to the log instead of closing the app
     * (1.12.0: everything the page asks for goes through here or is caught in JsApi).
     */
    private void onUi(final String what, final Runnable r) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!destroyed) r.run();
                } catch (RuntimeException e) {
                    Log.e(TAG, what, e);
                }
            }
        });
    }

    /**
     * Methods callable from the page as window.QalcNative.* (run on a background thread of the
     * WebView). 1.12.0: each one catches what it throws, so that a wrong value from the page or a
     * failure of the system never closes the app; the page gets an empty or "failed" answer.
     */
    final class JsApi {

        @JavascriptInterface
        public void send(String request) {
            try {
                Engine.get(MainActivity.this).submit(request, new Engine.Callback() {
                    @Override
                    public void done(String response) {
                        deliver(response);
                    }
                });
            } catch (RuntimeException e) {
                Log.e(TAG, "send", e);
            }
        }

        @JavascriptInterface
        public void updateRates(final int id) {
            try {
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
            } catch (RuntimeException e) {
                Log.e(TAG, "updateRates", e);
                deliver("{\"id\":" + id + ",\"ok\":false,\"error\":\"Could not update the exchange rates\"}");
            }
        }

        @JavascriptInterface
        public void cancel() {
            try {
                Engine.get(MainActivity.this).cancel();
            } catch (RuntimeException e) {
                Log.e(TAG, "cancel", e);
            }
        }

        /**
         * The language of the app (see Lang), asked once by the page when it starts (1.11.0).
         *
         * @param had the page has history or settings in its localStorage
         */
        @JavascriptInterface
        public String startLang(boolean had) {
            try {
                return chooseLang(had, true).lang;
            } catch (RuntimeException e) {
                Log.e(TAG, "startLang", e);
                return "en";
            }
        }

        /**
         * The device's first language with its region ("de-DE", "es-MX"), for the number format of
         * the page (setting "Number format": automatic, 1.12.0). It is the region of the device, not
         * the language chosen for QCalc.
         */
        @JavascriptInterface
        public String deviceLocale() {
            try {
                List<Locale> l = deviceLocales();
                return l.isEmpty() ? "" : l.get(0).toLanguageTag();
            } catch (RuntimeException e) {
                Log.e(TAG, "deviceLocale", e);
                return "";
            }
        }

        /**
         * The user chose a language in the app ("Language", 1.11.0). It is kept as qalc.lang (the
         * page saves it too) and, on Android 13 and later, set for QCalc in the system settings.
         */
        /**
         * "Same as device" chosen in the app (1.12.0; see Lang.automatic): qalc.lang and qalc.langsys
         * are removed and, on Android 13 and later, the language set for QCalc in the system settings
         * goes back to the system default. Returns the language the app then has (the page loads
         * itself again in it).
         */
        @JavascriptInterface
        public String setLangAuto() {
            try {
                synchronized (MainActivity.this) {
                    Lang.Choice c = Lang.automatic(Build.VERSION.SDK_INT >= 33, deviceLocales());
                    // first, so that the change of the configuration that follows finds nothing new
                    appLang = c.lang;
                    StateStore.save(MainActivity.this, "qalc.lang", null);
                    StateStore.save(MainActivity.this, "qalc.langsys", null);
                    if (c.clearSystem) clearAppLocale();
                    return c.lang;
                }
            } catch (RuntimeException e) {
                Log.e(TAG, "setLangAuto", e);
                return "en";
            }
        }

        /** The language "Same as device" gives now: the first of the device's languages that the app has, else English (1.12.0). */
        @JavascriptInterface
        public String deviceLang() {
            try {
                String f = Lang.first(deviceLocales());
                return f != null ? f : "en";
            } catch (RuntimeException e) {
                Log.e(TAG, "deviceLang", e);
                return "en";
            }
        }

        @JavascriptInterface
        public void setLang(String code) {
            if (!Lang.valid(code)) return;
            try {
                synchronized (MainActivity.this) {
                    // first, so that the change of the configuration that follows finds nothing new
                    appLang = code;
                    StateStore.save(MainActivity.this, "qalc.lang", Lang.json(code));
                    if (setAppLocale(code)) StateStore.save(MainActivity.this, "qalc.langsys", Lang.json(code));
                }
            } catch (RuntimeException e) {
                Log.e(TAG, "setLang", e);
            }
        }

        @JavascriptInterface
        public String loadState(String name) {
            try {
                return StateStore.load(MainActivity.this, name);
            } catch (RuntimeException e) {
                Log.e(TAG, "loadState", e);
                return null;
            }
        }

        @JavascriptInterface
        public void saveState(String name, String data) {
            try {
                StateStore.save(MainActivity.this, name, data);
            } catch (RuntimeException e) {
                Log.e(TAG, "saveState", e);
            }
        }

        @JavascriptInterface
        public void copy(final String text) {
            if (text == null) return;
            onUi("copy", new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    try {
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("QCalc", text));
                    } catch (RuntimeException e) {
                        // the system passes the text in one transaction of at most about 1 MB
                        Toast.makeText(MainActivity.this, tr("Too long to copy", "長すぎてコピーできませんでした", "Es demasiado largo para copiarlo",
                                "Zu lang zum Kopieren", "Trop long pour être copié", "너무 길어서 복사하지 못했습니다", "太長了，無法複製"), Toast.LENGTH_LONG).show();
                        return;
                    }
                    // Android 13 and later show their own confirmation
                    if (Build.VERSION.SDK_INT < 33) Toast.makeText(MainActivity.this, tr("Copied", "コピーしました", "Copiado", "Kopiert", "Copié", "복사했습니다", "已複製"), Toast.LENGTH_SHORT).show();
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
                o.put("dark", isSystemDark()); // the phone's setting; the page applies its own setting
                o.put("fontScale", (double) getResources().getConfiguration().fontScale); // the phone's font size (1.12.0)
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            onUi("openUrl", new Runnable() {
                @Override
                public void run() {
                    openExternal(url);
                }
            });
        }

        /** The page's setting "Light or dark" changed: the system bars follow it. */
        @JavascriptInterface
        public void setAppearance(String mode) {
            appearance = "dark".equals(mode) || "light".equals(mode) ? mode : "system";
            onUi("setAppearance", new Runnable() {
                @Override
                public void run() {
                    applyColors();
                }
            });
        }

        /**
         * The page shows its keypad and the newest history (1.12.0): reported to the system as the
         * end of the start ("Fully drawn" in `adb logcat`, and in `am start -W` from Android 10).
         */
        @JavascriptInterface
        public void pageReady() {
            onUi("pageReady", new Runnable() {
                @Override
                public void run() {
                    if (fullyDrawn) return;
                    fullyDrawn = true;
                    Log.i(TAG, "startup: page ready " + (SystemClock.elapsedRealtime() - createdAt) + " ms after onCreate");
                    reportFullyDrawn();
                }
            });
        }

        /** QCalc Pro: {billing, pro, legacy, price, state} (see Pro.info()). */
        @JavascriptInterface
        public String proInfo() {
            try {
                return pro != null ? pro.info() : "{\"billing\":\"none\"}";
            } catch (RuntimeException e) {
                Log.e(TAG, "proInfo", e);
                return "{\"billing\":\"none\"}";
            }
        }

        @JavascriptInterface
        public void buyPro() {
            onUi("buyPro", new Runnable() {
                @Override
                public void run() {
                    if (pro != null) pro.buy(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void restorePro() {
            try {
                if (pro != null) pro.restore();
            } catch (RuntimeException e) {
                Log.e(TAG, "restorePro", e);
            }
        }

        @JavascriptInterface
        public void refreshPro() {
            try {
                if (pro != null) pro.refresh();
            } catch (RuntimeException e) {
                Log.e(TAG, "refreshPro", e);
            }
        }

        /** Test builds only: see the app with or without Pro. */
        @JavascriptInterface
        public void setTestPro(boolean unlocked) {
            try {
                if (pro != null) pro.setTestUnlocked(unlocked);
            } catch (RuntimeException e) {
                Log.e(TAG, "setTestPro", e);
            }
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
            onUi("saveFile", new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("text/csv");
                    i.putExtra(Intent.EXTRA_TITLE, name);
                    pendingSave = text;
                    try {
                        startActivityForResult(i, REQUEST_SAVE);
                    } catch (RuntimeException e) {
                        // no file picker (ActivityNotFoundException), or the system refused
                        pendingSave = null;
                        sendEvent("{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
                    }
                }
            });
        }
    }
}
