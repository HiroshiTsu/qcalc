package io.github.hiroshitsu.qcalc;

import java.util.Locale;

/**
 * Which outside links the page may open (1.12.0): a web page in the browser (http, https) and, from
 * "Send a bug report or an idea" in "About this app", a draft in the mail app (mailto:). Anything else
 * (intent:, file:, content:, javascript:, a link without a scheme) is not opened. Plain Java, so that it
 * can be tested without Android.
 */
final class Links {
    static final String VIEW = "view";
    static final String MAIL = "mail";

    private Links() {
    }

    /** "view" for http and https, "mail" for mailto, null for anything else. */
    static String kind(String url) {
        if (url == null) return null;
        int c = url.indexOf(':');
        if (c <= 0) return null;
        String scheme = url.substring(0, c).toLowerCase(Locale.ROOT);
        if (scheme.equals("http") || scheme.equals("https")) return url.startsWith("//", c + 1) ? VIEW : null;
        if (scheme.equals("mailto")) return url.length() > c + 1 ? MAIL : null;
        return null;
    }
}
