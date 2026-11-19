package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The quick ways into QCalc (1.12.0, see QuickText): the intents that open the app at a place, the
 * texts the page gives for the widget and the shortcuts (in the app's language), and the request to
 * put the widget on the home screen.
 *
 * The shortcuts of the icon are dynamic ones, set when the page has started: a static shortcut
 * (res/xml) always starts the app with FLAG_ACTIVITY_CLEAR_TASK, which would load the page again,
 * and its texts would follow the device's language instead of the app's.
 */
final class Quick {
    private static final String TAG = "QCalc";
    /** The extra of an intent that names the place to open (QuickText.CALC, TOOLS or CONVERT). */
    static final String EXTRA_OPEN = "io.github.hiroshitsu.qcalc.OPEN";
    private static final String PREFS = "qcalc.quick";

    private Quick() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** An intent that opens the app at the place (a new task, or the running one: singleTask). */
    static Intent openIntent(Context c, String target) {
        Intent i = new Intent(c, MainActivity.class);
        // a different action for each place, so that the system keeps the three PendingIntents apart
        i.setAction("io.github.hiroshitsu.qcalc.action.OPEN_" + target.toUpperCase(Locale.ROOT));
        i.putExtra(EXTRA_OPEN, target);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    static PendingIntent pending(Context c, String target) {
        return PendingIntent.getActivity(c, QuickText.code(target), openIntent(c, target),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The place an intent asks for, or null. */
    static String targetOf(Intent i) {
        if (i == null) return null;
        try {
            return QuickText.target(i.getStringExtra(EXTRA_OPEN));
        } catch (RuntimeException e) {
            // an intent from elsewhere whose extras cannot be read (BadParcelableException)
            return null;
        }
    }

    /**
     * The texts in the app's language, from the page: {"calc", "tools", "convert", "empty",
     * "newCalc", "convertLong"}. When they changed, the shortcuts and the widgets are made again.
     */
    static void setLabels(Context c, String json) {
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception e) {
            return;
        }
        SharedPreferences p = prefs(c);
        String[] keys = {"calc", "tools", "convert", "empty", "newCalc", "convertLong"};
        SharedPreferences.Editor e = p.edit();
        boolean changed = false;
        for (String k : keys) {
            String v = QuickText.cut(o.optString(k, ""), 40);
            if (v.isEmpty()) continue;
            if (!v.equals(p.getString("label." + k, ""))) {
                e.putString("label." + k, v);
                changed = true;
            }
        }
        boolean noShortcuts = !p.getBoolean("shortcuts", false);
        if (changed) e.apply();
        if (changed || noShortcuts) {
            if (shortcuts(c)) p.edit().putBoolean("shortcuts", true).apply();
        }
        if (changed) Widget.refresh(c);
    }

    /** The last line of the history (as shown), for the widget; "" and "" when the history is empty. */
    static void setLast(Context c, String expr, String result) {
        String x = QuickText.cut(expr, 80), r = QuickText.cut(result, 80);
        SharedPreferences p = prefs(c);
        if (x.equals(p.getString("expr", "")) && r.equals(p.getString("result", ""))) return;
        p.edit().putString("expr", x).putString("result", r).apply();
        Widget.refresh(c);
    }

    static String label(Context c, String key, String fallback) {
        return QuickText.label(prefs(c).getString("label." + key, ""), fallback);
    }

    /** The shortcuts of the icon (Android 7.1 and later): a new calculation, Tools, Convert. */
    private static boolean shortcuts(Context c) {
        if (Build.VERSION.SDK_INT < 25) return false;
        try {
            ShortcutManager sm = c.getSystemService(ShortcutManager.class);
            if (sm == null) return false;
            List<ShortcutInfo> list = new ArrayList<>();
            list.add(shortcut(c, QuickText.CALC, label(c, "newCalc", c.getString(R.string.sc_new)), null, R.drawable.ic_sc_calc, 0));
            list.add(shortcut(c, QuickText.TOOLS, label(c, "tools", c.getString(R.string.widget_tools)), null, R.drawable.ic_sc_tools, 1));
            list.add(shortcut(c, QuickText.CONVERT, label(c, "convert", c.getString(R.string.widget_convert)),
                    label(c, "convertLong", c.getString(R.string.sc_convert_long)), R.drawable.ic_sc_convert, 2));
            return sm.setDynamicShortcuts(list);
        } catch (RuntimeException e) {
            // too many changes in a short time (rate limiting), or a launcher without shortcuts
            Log.w(TAG, "shortcuts", e);
            return false;
        }
    }

    private static ShortcutInfo shortcut(Context c, String target, String label, String longLabel, int icon, int rank) {
        return new ShortcutInfo.Builder(c, target)
                .setShortLabel(label)
                .setLongLabel(longLabel != null ? longLabel : label)
                .setIcon(Icon.createWithResource(c, icon))
                .setIntent(openIntent(c, target))
                .setRank(rank)
                .build();
    }

    /**
     * Asks the launcher to put the widget on the home screen (Android 8 and later, when the launcher
     * can): "asked" (the system shows its own question), "unsupported" (the page explains how to
     * place it by hand) or "failed".
     */
    static String pinWidget(Activity a) {
        if (Build.VERSION.SDK_INT < 26) return "unsupported";
        try {
            AppWidgetManager m = a.getSystemService(AppWidgetManager.class);
            if (m == null || !m.isRequestPinAppWidgetSupported()) return "unsupported";
            return m.requestPinAppWidget(new ComponentName(a, Widget.class), null, null) ? "asked" : "failed";
        } catch (RuntimeException e) {
            Log.w(TAG, "pinWidget", e);
            return "failed";
        }
    }
}
