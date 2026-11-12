package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.File;

/**
 * QCalc Pro: a one-time purchase in Google Play (the one-time product PRODUCT_ID) that unlocks
 * features of the page (see "Pro" in app.js): a precision above 1000 digits, 3D graphs, the
 * color themes, exporting the history, and the Pro features of later versions.
 *
 * This class keeps the state and reports it to the page. The purchase itself is made by
 * PlayBilling (app/src-billing), which uses the Google Play Billing Library; it is part of the app
 * only when the app is built with the library (Gradle with qcalc.billing=true, see app/build.gradle).
 * It is loaded by its name, so that the app also builds and runs without it.
 *
 * "billing" as the page sees it:
 *   "debug"  a test build (package name ending in .debug): Pro is unlocked; the Pro panel can
 *            lock it, to see the app as without Pro
 *   "play"   PlayBilling is in the app: Pro can be bought
 *   "none"   no PlayBilling: Pro cannot be bought, so the page locks nothing
 *
 * Who used QCalc before Pro began keeps the Pro features ("legacy"): every start of a build
 * without billing marks the installation, and the first start of a build with billing also counts
 * an installation that already has a saved history or settings, or WebView data, from an
 * older version.
 */
final class Pro {

    static final String PRODUCT_ID = "qcalc_pro";
    /** Users of the versions before Pro keep the Pro features (see above). */
    private static final boolean LEGACY_USERS_KEEP_PRO = true;

    /** What PlayBilling does. Its methods may be called on any thread. */
    interface Store {
        /** Connects to Google Play and asks for the price and the purchases. */
        void start();

        /** Asks for the purchases (and the price, if it is not known yet) again. */
        void refresh();

        /** Shows Google Play's purchase screen. */
        void buy(Activity activity);

        /** Asks for the purchases and reports a message when there is none. */
        void restore();

        void end();
    }

    /** How PlayBilling reports to this class (on any thread). */
    interface Owner {
        /** The result of a query of the purchases or of a purchase: owned, or pending (paid later). */
        void owned(boolean owned, boolean pending);

        /** The price in the user's currency, as Google Play shows it ("¥300"). */
        void price(String formatted);

        /** A message for the user, in English (the page translates the known ones). */
        void message(String text);
    }

    /** Called with the JSON of an event for the page: {"event":"pro", …}. */
    interface Listener {
        void changed(String eventJson);
    }

    private final SharedPreferences prefs;
    private final Listener listener;
    private final String billing;
    private final Store store;
    private boolean owned, pending, legacy, testLocked;
    private String price;

    Pro(Context context, Listener listener) {
        Context app = context.getApplicationContext();
        this.listener = listener;
        prefs = app.getSharedPreferences("pro", Context.MODE_PRIVATE);
        boolean debug = app.getPackageName().endsWith(".debug");
        Store s = debug ? null : loadStore(app);
        store = s;
        billing = debug ? "debug" : s != null ? "play" : "none";
        if (store == null) {
            // a build in which Pro cannot be bought: whoever starts it used QCalc before Pro
            if (!prefs.getBoolean("pre_pro", false)) prefs.edit().putBoolean("pre_pro", true).apply();
        } else if (!prefs.getBoolean("era", false)) {
            // the first start of a build with billing (before the WebView or the engine write anything)
            boolean before = prefs.getBoolean("pre_pro", false) || usedBefore(app);
            prefs.edit().putBoolean("era", true).putBoolean("legacy", LEGACY_USERS_KEEP_PRO && before).apply();
        }
        owned = prefs.getBoolean("owned", false);
        legacy = store != null && prefs.getBoolean("legacy", false);
        testLocked = debug && prefs.getBoolean("test_locked", false);
        price = prefs.getString("price", null);
    }

    private Store loadStore(Context app) {
        try {
            Class<?> c = Class.forName("io.github.hiroshitsu.qcalc.PlayBilling");
            return (Store) c.getDeclaredConstructor(Context.class, Owner.class).newInstance(app, new Owner() {
                @Override
                public void owned(boolean isOwned, boolean isPending) {
                    setOwned(isOwned, isPending);
                }

                @Override
                public void price(String formatted) {
                    setPrice(formatted);
                }

                @Override
                public void message(String text) {
                    report(text);
                }
            });
        } catch (Throwable t) {
            // not built with the Google Play Billing Library (or it could not start)
            return null;
        }
    }

    /** Whether this installation has data of an older version (it used QCalc before). */
    private static boolean usedBefore(Context app) {
        File state = new File(app.getFilesDir(), "state");
        String[] names = state.list();
        if (names != null && names.length > 0) return true;
        File web = new File(app.getApplicationInfo().dataDir, "app_webview");
        return web.isDirectory();
    }

    void start() {
        if (store != null) store.start();
    }

    void refresh() {
        if (store != null) store.refresh();
    }

    void buy(Activity activity) {
        if (store != null) store.buy(activity);
    }

    void restore() {
        if (store != null) store.restore();
        else report(null);
    }

    void end() {
        if (store != null) store.end();
    }

    /** Test builds: see the app with or without Pro. */
    void setTestUnlocked(boolean unlocked) {
        if (!"debug".equals(billing)) return;
        synchronized (this) {
            testLocked = !unlocked;
        }
        prefs.edit().putBoolean("test_locked", !unlocked).apply();
        report(null);
    }

    synchronized boolean unlocked() {
        if ("debug".equals(billing)) return !testLocked;
        return store != null && (owned || legacy);
    }

    /** For QalcNative.proInfo(): {billing, pro, legacy, price, state}. */
    synchronized String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("billing", billing);
            o.put("pro", unlocked());
            o.put("legacy", legacy && !owned);
            if (price != null) o.put("price", price);
            if (pending && !owned) o.put("state", "pending");
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private void setOwned(boolean isOwned, boolean isPending) {
        synchronized (this) {
            owned = isOwned;
            pending = isPending;
        }
        prefs.edit().putBoolean("owned", isOwned).apply();
        report(null);
    }

    private void setPrice(String formatted) {
        if (formatted == null || formatted.isEmpty()) return;
        synchronized (this) {
            if (formatted.equals(price)) return;
            price = formatted;
        }
        prefs.edit().putString("price", formatted).apply();
        report(null);
    }

    private void report(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("event", "pro");
            if (message != null) o.put("message", message);
        } catch (Exception ignored) {
        }
        listener.changed(o.toString());
    }
}
