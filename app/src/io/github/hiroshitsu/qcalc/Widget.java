package io.github.hiroshitsu.qcalc;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.widget.RemoteViews;

/**
 * The widget on the home screen (1.12.0): the last line of the history, and buttons that open a new
 * calculation, Tools and Convert. Made with RemoteViews (res/layout/widget.xml); its colours follow
 * the device's light or dark setting (res/values-night/colors.xml). The page gives the texts
 * (Quick.setLast, Quick.setLabels), so they are in the app's language and use its number format.
 */
public class Widget extends AppWidgetProvider {
    private static final String TAG = "QCalc";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        update(c, m, ids);
    }

    /** The widgets on the home screen now (0 when there are none, or when it cannot be known). */
    static int count(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            int[] ids = m != null ? m.getAppWidgetIds(new ComponentName(c, Widget.class)) : null;
            return ids != null ? ids.length : 0;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** Draws every widget again (after the history or the language changed). */
    static void refresh(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            if (m == null) return;
            int[] ids = m.getAppWidgetIds(new ComponentName(c, Widget.class));
            if (ids != null && ids.length > 0) update(c, m, ids);
        } catch (RuntimeException e) {
            Log.w(TAG, "widget", e);
        }
    }

    private static void update(Context c, AppWidgetManager m, int[] ids) {
        SharedPreferences p = Quick.prefs(c);
        String expr = p.getString("expr", ""), result = p.getString("result", "");
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        if (result.isEmpty()) {
            v.setTextViewText(R.id.w_expr, "");
            v.setTextViewText(R.id.w_result, Quick.label(c, "empty", c.getString(R.string.widget_empty)));
        } else {
            v.setTextViewText(R.id.w_expr, expr);
            v.setTextViewText(R.id.w_result, result);
        }
        v.setTextViewText(R.id.w_calc, Quick.label(c, "calc", c.getString(R.string.widget_calc)));
        v.setTextViewText(R.id.w_tools, Quick.label(c, "tools", c.getString(R.string.widget_tools)));
        v.setTextViewText(R.id.w_convert, Quick.label(c, "convert", c.getString(R.string.widget_convert)));
        v.setOnClickPendingIntent(R.id.w_last, Quick.pending(c, QuickText.CALC));
        v.setOnClickPendingIntent(R.id.w_calc, Quick.pending(c, QuickText.CALC));
        v.setOnClickPendingIntent(R.id.w_tools, Quick.pending(c, QuickText.TOOLS));
        v.setOnClickPendingIntent(R.id.w_convert, Quick.pending(c, QuickText.CONVERT));
        m.updateAppWidget(ids, v);
    }
}
