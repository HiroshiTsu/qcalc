package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.app.LocaleManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.Icon;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.LocaleList;
import android.os.Looper;
import android.os.StrictMode;
import android.os.SystemClock;
import android.telephony.TelephonyManager;
import android.util.Base64;
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

import java.io.File;
import java.io.FileOutputStream;
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
    /** Android's file picker for "Open a file" in the calculation notes (1.15.0, NotesImport). */
    private static final int REQUEST_OPEN = 2;
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
    /** Google Play's in-app review sheet (only in the build for Google Play, see Review.java). */
    private final Review review = new Review();
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
    /**
     * The place the widget, a shortcut or the tile asked for (QuickText; 1.12.0), until the page is
     * ready to be told (pageReady).
     */
    private String pendingOpen;
    /** Text or a file shared to QCalc, read (the "import" event of NotesImport), until the page is ready (1.15.0). */
    private String pendingImport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        createdAt = SystemClock.elapsedRealtime();
        if (getPackageName().endsWith(".debug")) strictMode();
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 24) {
            Log.i(TAG, "startup: onCreate " + (createdAt - android.os.Process.getStartElapsedRealtime()) + " ms after the process started");
        }
        appearance = savedAppearance();
        // opened from the widget, a shortcut of the icon or the tile; not when the system makes the
        // activity again or it is opened from the list of recent apps (the same intent once more)
        if (savedInstanceState == null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            pendingOpen = Quick.targetOf(getIntent());
            if (NotesImport.isShare(getIntent())) takeShare(getIntent());
        }
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

    /** The app was running and is opened again (launchMode singleTask): from the widget, a shortcut or the tile. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (NotesImport.isShare(intent)) {
            takeShare(intent);
            return;
        }
        String target = Quick.targetOf(intent);
        if (target == null) return;
        if (fullyDrawn && web != null) openPlace(target);
        else pendingOpen = target;
    }

    /** Text or a .txt or .csv file shared to QCalc (1.15.0): read on a background thread, then given to the page. */
    private void takeShare(final Intent intent) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                giveImport(NotesImport.fromShare(MainActivity.this, intent));
            }
        }, "qalc-import").start();
    }

    /** The "import" event to the page now, or when it is ready (any thread). */
    private void giveImport(final String json) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (fullyDrawn && web != null) sendEvent(json);
                else pendingImport = json;
            }
        });
    }

    /** Tells the page to show a new calculation, Tools or Convert (window.qalcOpen in app.js). */
    private void openPlace(String target) {
        String t = QuickText.target(target);
        if (t != null) runScript("window.qalcOpen && window.qalcOpen('" + t + "')");
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

    /** Opens web links in the browser, mailto: links in the mail app and the page of QCalc in the Play Store app; other kinds of links are ignored. */
    private void openExternal(String url) {
        // a web page in the browser, (1.12.0, "Send a bug report or an idea") a mail draft in the mail
        // app, or (feature/ratings, "Rate on Google Play") the page of QCalc in the Play Store app, and
        // the same page in the browser when no app opens it (a phone without the Play Store); nothing
        // else (Links)
        String kind = Links.kind(url);
        if (kind == null) return;
        Uri u = Uri.parse(url);
        try {
            Intent i = new Intent(Links.MAIL.equals(kind) ? Intent.ACTION_SENDTO : Intent.ACTION_VIEW, u);
            // the Play Store in a task of its own, so that Back comes back to QCalc
            if (Links.STORE.equals(kind)) i.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY | Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
            startActivity(i);
        } catch (Exception e) {
            String other = Links.fallback(url);
            if (other == null) return;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(other)));
            } catch (Exception ignored) {
            }
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
        if (requestCode == REQUEST_OPEN) {
            // "Open a file" in the calculation notes (1.15.0): the file read on a background thread
            final Uri picked = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (picked == null) {
                sendEvent("{\"event\":\"import\",\"from\":\"file\",\"cancelled\":true}");
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    sendEvent(NotesImport.read(MainActivity.this, picked, "file", null));
                }
            }, "qalc-import").start();
            return;
        }
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

    /** Android 13 and later: the system asks the user whether to add QCalc's tile to the quick settings. */
    private void requestTile() {
        android.app.StatusBarManager sb = getSystemService(android.app.StatusBarManager.class);
        if (sb == null) {
            sendEvent("{\"event\":\"quick\",\"what\":\"tile\",\"result\":1006}");
            return;
        }
        try {
            sb.requestAddTileService(new ComponentName(this, QuickTile.class), getString(R.string.tile_label),
                    Icon.createWithResource(this, R.drawable.ic_tile), getMainExecutor(),
                    new java.util.function.Consumer<Integer>() {
                        @Override
                        public void accept(Integer result) {
                            sendEvent("{\"event\":\"quick\",\"what\":\"tile\",\"result\":" + result + "}");
                        }
                    });
        } catch (RuntimeException e) {
            Log.w(TAG, "addTile", e);
            sendEvent("{\"event\":\"quick\",\"what\":\"tile\",\"result\":1000}");
        }
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
     * 1.12.1: the state of the network for AutoRates, read with the permission ACCESS_NETWORK_STATE. Each
     * method may throw; AutoRates takes that part as unknown.
     */
    static final class DeviceNet implements AutoRates.Net {
        private final Context context;

        DeviceNet(Context context) {
            this.context = context;
        }

        private ConnectivityManager cm() {
            return (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        }

        @Override
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }

        /** The capabilities of the active network; null when there is none or they cannot be read. */
        private NetworkCapabilities caps() {
            ConnectivityManager cm = cm();
            Network net = cm == null ? null : cm.getActiveNetwork();
            return net == null ? null : cm.getNetworkCapabilities(net);
        }

        @Override
        public Boolean notRoaming() {
            if (Build.VERSION.SDK_INT < 28) return null;
            NetworkCapabilities caps = caps();
            return caps == null ? null : caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING);
        }

        @Override
        public Boolean wifiOrEthernet() {
            NetworkCapabilities caps = caps();
            if (caps == null) return null;
            return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
        }

        @Override
        public boolean telephonyRoaming() {
            TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            return tm != null && tm.isNetworkRoaming();
        }

        @Override
        public boolean metered() {
            ConnectivityManager cm = cm();
            return cm != null && cm.isActiveNetworkMetered();
        }

        @Override
        public int restrictBackground() {
            ConnectivityManager cm = cm();
            return cm == null ? ConnectivityManager.RESTRICT_BACKGROUND_STATUS_DISABLED : cm.getRestrictBackgroundStatus();
        }
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

        /**
         * 1.12.1: whether the exchange rates may be updated by themselves now (at start): false while roaming
         * abroad or in Data Saver, true otherwise and whenever that cannot be known (AutoRates).
         */
        @JavascriptInterface
        public boolean autoRatesAllowed() {
            try {
                return AutoRates.allowed(new DeviceNet(MainActivity.this));
            } catch (RuntimeException e) {
                Log.e(TAG, "autoRatesAllowed", e);
                return true;
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
                    if (pendingOpen != null) {
                        openPlace(pendingOpen);
                        pendingOpen = null;
                    }
                    if (pendingImport != null) {
                        sendEvent(pendingImport);
                        pendingImport = null;
                    }
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
         * Google Play's in-app review sheet (feature/ratings): whether this build can ask for it (the build for
         * Google Play has the Play In-App Review Library; see Review.java).
         */
        @JavascriptInterface
        public boolean reviewAvailable() {
            try {
                return review.available();
            } catch (RuntimeException e) {
                Log.e(TAG, "reviewAvailable", e);
                return false;
            }
        }

        /**
         * Asks Google Play for the review sheet; the page has decided that the time is right (app.js). The end is
         * reported as {"event":"review","state":"done"|"unavailable"|"none"}: "done" says only that Google Play
         * went through the request, not that the sheet was shown. kind is what has just worked ("3d", a tool's
         * result, "test" for the button of the test builds); it is not used here. (The page passes it, and WebView
         * finds a method of this class by its name and its number of arguments: a call with one argument does not
         * reach a method without one, and fails with "Method not found".)
         */
        @JavascriptInterface
        public void requestReview(String kind) {
            onUi("requestReview", new Runnable() {
                @Override
                public void run() {
                    review.ask(MainActivity.this, new Review.Done() {
                        @Override
                        public void done(String state) {
                            sendEvent("{\"event\":\"review\",\"state\":" + JSONObject.quote(state) + "}");
                        }
                    });
                }
            });
        }

        /** When the app was first installed on this phone (ms since 1970; an update keeps it), or 0. */
        @JavascriptInterface
        public double installTime() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).firstInstallTime;
            } catch (Exception e) {
                return 0;
            }
        }

        /** The last line of the history as shown, for the widget (1.12.0); both "" when the history is empty. */
        @JavascriptInterface
        public void setWidget(String expr, String result) {
            try {
                Quick.setLast(MainActivity.this, expr, result);
            } catch (RuntimeException e) {
                Log.e(TAG, "setWidget", e);
            }
        }

        /** The texts of the widget and of the icon's shortcuts in the app's language (JSON, see Quick.setLabels). */
        @JavascriptInterface
        public void setQuickLabels(String json) {
            try {
                Quick.setLabels(MainActivity.this, json);
            } catch (RuntimeException e) {
                Log.e(TAG, "setQuickLabels", e);
            }
        }

        /** "Put the widget on the home screen": "asked", "unsupported" or "failed" (Quick.pinWidget). */
        @JavascriptInterface
        public String pinWidget() {
            try {
                return Quick.pinWidget(MainActivity.this);
            } catch (RuntimeException e) {
                Log.e(TAG, "pinWidget", e);
                return "failed";
            }
        }

        /** How many QCalc widgets are on the home screen. */
        @JavascriptInterface
        public int widgetCount() {
            try {
                return Widget.count(MainActivity.this);
            } catch (RuntimeException e) {
                Log.e(TAG, "widgetCount", e);
                return 0;
            }
        }

        /**
         * "Add the tile to the quick settings" (Android 13 and later): "asked", and the answer comes as
         * the event {"event":"quick","what":"tile","result":n} (StatusBarManager's codes: 2 added,
         * 1 already there, 0 not added, 1000 and more a failure); "unsupported" before Android 13.
         */
        @JavascriptInterface
        public String addTile() {
            try {
                if (Build.VERSION.SDK_INT < 33) return "unsupported";
                onUi("addTile", new Runnable() {
                    @Override
                    public void run() {
                        requestTile();
                    }
                });
                return "asked";
            } catch (RuntimeException e) {
                Log.e(TAG, "addTile", e);
                return "failed";
            }
        }

        /** Shares a text (a calculation memo, 1.12.0 D5) through the system's share sheet. */
        @JavascriptInterface
        public void shareText(final String text) {
            if (text == null || text.isEmpty() || text.length() > 100000) return;
            onUi("shareText", new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(send, null));
                    } catch (RuntimeException e) {
                        Log.w(TAG, "shareText", e);
                    }
                }
            });
        }

        /**
         * Shares an image of a graph (1.12.0, D4): data is the PNG or GIF in base64, mime its type, text
         * the words that go with it. The image is written to cache/shared/ on a thread (the images shared
         * before are removed), and the system's share sheet opens with it: the receiving app may read that
         * one image (ShareProvider, FLAG_GRANT_READ_URI_PERMISSION; no permission is added). The answer
         * comes as the event {"event":"shared","ok":…}.
         */
        @JavascriptInterface
        public void shareImage(final String data, final String mime, final String text) {
            if (data == null || ShareFiles.typeOf(mime) == null || data.length() > ShareFiles.MAX_BYTES / 3 * 4 + 8) {
                sendEvent("{\"event\":\"shared\",\"ok\":false,\"error\":\"Could not share the image\"}");
                return;
            }
            try {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                            if (bytes.length == 0 || bytes.length > ShareFiles.MAX_BYTES) throw new IllegalArgumentException("size");
                            File dir = new File(getCacheDir(), ShareFiles.DIR);
                            if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("dir");
                            File[] old = dir.listFiles();
                            if (old != null) for (File f : old) if (ShareFiles.isName(f.getName())) f.delete();
                            final String name = ShareFiles.nameFor(mime, System.currentTimeMillis());
                            FileOutputStream out = new FileOutputStream(new File(dir, name));
                            try {
                                out.write(bytes);
                            } finally {
                                out.close();
                            }
                            onUi("shareImage", new Runnable() {
                                @Override
                                public void run() {
                                    Uri uri = ShareProvider.uriFor(getPackageName(), name);
                                    Intent send = new Intent(Intent.ACTION_SEND);
                                    send.setType(mime);
                                    send.putExtra(Intent.EXTRA_STREAM, uri);
                                    if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                                    send.setClipData(ClipData.newRawUri("", uri));
                                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    try {
                                        startActivity(Intent.createChooser(send, null));
                                        sendEvent("{\"event\":\"shared\",\"ok\":true}");
                                    } catch (RuntimeException e) {
                                        // no app to share with (ActivityNotFoundException)
                                        sendEvent("{\"event\":\"shared\",\"ok\":false,\"error\":\"Could not share the image\"}");
                                    }
                                }
                            });
                        } catch (Exception e) {
                            Log.w(TAG, "shareImage", e);
                            sendEvent("{\"event\":\"shared\",\"ok\":false,\"error\":\"Could not share the image\"}");
                        }
                    }
                }).start();
            } catch (RuntimeException e) {
                Log.e(TAG, "shareImage", e);
                sendEvent("{\"event\":\"shared\",\"ok\":false,\"error\":\"Could not share the image\"}");
            }
        }

        /**
         * Saves a text file where the user chooses (the system's file picker); the result comes
         * as a "saved" event. Only CSV files (text/csv, .csv) and, from 1.12.0, ASCII STL files for 3D
         * printers (model/stl, .stl) and the text of a calculation memo (text/plain, .txt), with a plain
         * name, as the page makes them.
         */
        /**
         * "Open a file" in the calculation notes (1.15.0): Android's file picker for one text or CSV file; what is read
         * comes as an "import" event (NotesImport).
         */
        @JavascriptInterface
        public void openTextFile() {
            onUi("openTextFile", new Runnable() {
                @Override
                public void run() {
                    try {
                        startActivityForResult(NotesImport.pickerIntent(), REQUEST_OPEN);
                    } catch (RuntimeException e) {
                        // no file picker (ActivityNotFoundException), or the system refused
                        sendEvent(NotesImport.error("file", "read"));
                    }
                }
            });
        }

        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String text) {
            if (name == null || text == null || !FILE_NAME.matcher(name).matches()
                    || !(("text/csv".equals(mime) && name.endsWith(".csv")) || ("model/stl".equals(mime) && name.endsWith(".stl"))
                        || ("text/plain".equals(mime) && name.endsWith(".txt")))
                    || text.length() > MAX_SAVE) {
                sendEvent("{\"event\":\"saved\",\"ok\":false,\"error\":\"Could not save the file\"}");
                return;
            }
            onUi("saveFile", new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(mime);
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
