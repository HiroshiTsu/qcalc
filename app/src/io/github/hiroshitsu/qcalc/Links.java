package io.github.hiroshitsu.qcalc;

import java.util.Locale;

/**
 * Which outside links the page may open (1.12.0): a web page in the browser (http, https) and, from
 * "Send a bug report or an idea" in "About this app", a draft in the mail app (mailto:). From "Rate on
 * Google Play" (feature/ratings), the page of QCalc in the Play Store app: that one market: address only,
 * with the same page on the web when no app can open it. Anything else (intent:, file:, content:,
 * javascript:, any other market: link, a link without a scheme) is not opened. Plain Java, so that it
 * can be tested without Android.
 */
final class Links {
    static final String VIEW = "view";
    static final String MAIL = "mail";
    static final String STORE = "store";
    /** The page of QCalc in the Play Store app, and the same page on the web (the package of the release). */
    static final String STORE_APP = "market://details?id=io.github.hiroshitsu.qcalc";
    static final String STORE_WEB = "https://play.google.com/store/apps/details?id=io.github.hiroshitsu.qcalc";

    private Links() {
    }

    /** "view" for http and https, "mail" for mailto, "store" for the page of QCalc in the Play Store app, null for anything else. */
    static String kind(String url) {
        if (url == null) return null;
        if (url.equals(STORE_APP)) return STORE;
        int c = url.indexOf(':');
        if (c <= 0) return null;
        String scheme = url.substring(0, c).toLowerCase(Locale.ROOT);
        if (scheme.equals("http") || scheme.equals("https")) return url.startsWith("//", c + 1) ? VIEW : null;
        if (scheme.equals("mailto")) return url.length() > c + 1 ? MAIL : null;
        return null;
    }

    /** What to open when no app can open a link: the page of QCalc on the web for its page in the Play Store app; null otherwise. */
    static String fallback(String url) {
        return STORE_APP.equals(url) ? STORE_WEB : null;
    }
}
