package io.github.hiroshitsu.qcalc;

/**
 * The quick ways into QCalc from outside the app (1.12.0): the widget on the home screen (Widget),
 * the tile of the quick settings (QuickTile) and the shortcuts shown when the app's icon is touched
 * and held (Quick.shortcuts). Each one opens the app at one of three places, which the page is told
 * (window.qalcOpen): a new calculation, Tools, or the conversion of units and currencies.
 *
 * Plain Java without Android, for the tests.
 */
final class QuickText {
    static final String CALC = "calc";
    static final String TOOLS = "tools";
    static final String CONVERT = "convert";

    private QuickText() {
    }

    /** One of the three places, or null for anything else (an intent may carry anything). */
    static String target(String s) {
        return CALC.equals(s) || TOOLS.equals(s) || CONVERT.equals(s) ? s : null;
    }

    /** The number of a place, for the request codes of the PendingIntents (1, 2, 3; 0 for none). */
    static int code(String target) {
        return CALC.equals(target) ? 1 : TOOLS.equals(target) ? 2 : CONVERT.equals(target) ? 3 : 0;
    }

    /**
     * s on one line in at most max characters (counted as code points, so that an emoji or a rare
     * kanji is never cut in half), ended with "…" when it was longer; "" for null.
     */
    static String cut(String s, int max) {
        if (s == null || max < 1) return "";
        String t = s.replaceAll("\\s+", " ").trim();
        int n = t.codePointCount(0, t.length());
        if (n <= max) return t;
        int end = t.offsetByCodePoints(0, max - 1);
        return t.substring(0, end).trim() + "…";
    }

    /** A label from the page in at most 40 characters, or the fallback when the page gave none. */
    static String label(String s, String fallback) {
        String t = cut(s, 40);
        return t.isEmpty() ? fallback : t;
    }
}
