package io.github.hiroshitsu.qcalc;

import java.util.List;
import java.util.Locale;

/**
 * The language of the app (1.11.0). It is chosen here, once when the page starts, and the page
 * (QalcNative.startLang) and the texts of the Java code (MainActivity.tr) both use it. In a
 * browser, where there is no Java, the page chooses with the same rules (pickLang in app.js).
 *
 * In this order:
 * <ol>
 * <li>the language set for QCalc in the system settings (Android 13 and later: Settings → Apps →
 * QCalc → Language, listed from res/xml/locales_config.xml), which is then kept as qalc.lang too;</li>
 * <li>the language chosen in the app ("Language" in the menu or the settings), saved by the page
 * as qalc.lang (the JSON text "ja", "de" …);</li>
 * <li>the first language in the device's list of languages that the app has: English, Japanese,
 * Spanish, German, French, Korean, or Chinese in Traditional characters (Hant, or of Taiwan, Hong
 * Kong or Macau). Simplified Chinese (Hans, or of China or Singapore) and the languages the app
 * does not have are passed over;</li>
 * <li>English.</li>
 * </ol>
 * On Android 13 and later the language chosen in the app is set for QCalc in the system settings
 * as well, so the two always agree; qalc.langsys keeps the language last set there. When that
 * setting is later put back to the system default, the app follows the device again.
 *
 * 1.12.0: "Same as device" in the app's list of languages (automatic()) removes the user's own
 * language on every version of Android; until 1.11.0 only Android 13 and later had a way back.
 *
 * Until 1.10.1 only the first language of the device was looked at, and Japanese started the app
 * in English. So that the users of those versions do not see another language after the update,
 * the first start of 1.11.0 keeps the language they saw as qalc.lang when they already had history
 * or settings and no qalc.lang. qalc.langinit marks that this was done, so it is done only once.
 *
 * Only plain Java here (no Android classes), so that the rules can be tested on a PC.
 */
final class Lang {

    /** The languages of the app, in the order of the texts given to MainActivity.tr(). */
    static final String[] CODES = {"en", "ja", "es", "de", "fr", "ko", "zh-TW"};

    private Lang() {
    }

    static boolean valid(String code) {
        for (String c : CODES) {
            if (c.equals(code)) return true;
        }
        return false;
    }

    /** The app's language for one language of the device, or null if the app does not have it. */
    static String match(Locale l) {
        if (l == null) return null;
        String lang = l.getLanguage();
        if ("zh".equals(lang)) {
            String script = l.getScript(), country = l.getCountry();
            if ("Hant".equals(script)) return "zh-TW";
            if (!script.isEmpty()) return null; // Hans
            return "TW".equals(country) || "HK".equals(country) || "MO".equals(country) ? "zh-TW" : null;
        }
        for (int i = 0; i < 6; i++) {
            if (CODES[i].equals(lang)) return CODES[i];
        }
        return null;
    }

    /** The first language of the list that the app has, or null. */
    static String first(List<Locale> list) {
        if (list == null) return null;
        for (Locale l : list) {
            String m = match(l);
            if (m != null) return m;
        }
        return null;
    }

    /**
     * The language that versions up to 1.10.1 started in without a choice: only the first language
     * of the device was looked at, and Japanese (like a language the app does not have) gave English.
     */
    static String legacy(List<Locale> device) {
        String m = device == null || device.isEmpty() ? null : match(device.get(0));
        return m == null || "ja".equals(m) ? "en" : m;
    }

    /** The language in a text saved by the page (the JSON text "ja"), or null. */
    static String saved(String json) {
        if (json == null) return null;
        String s = json.trim();
        if (s.length() < 2 || s.charAt(0) != '"' || s.charAt(s.length() - 1) != '"') return null;
        s = s.substring(1, s.length() - 1);
        return valid(s) ? s : null;
    }

    /** A language as the page saves it (the JSON text). */
    static String json(String code) {
        return "\"" + code + "\"";
    }

    /** What choose() decided. */
    static final class Choice {
        /** The language of the app. */
        String lang;
        /** qalc.lang after this start, or null for none. */
        String saved;
        /** qalc.langsys after this start, or null for none. */
        String sys;
        /** The language to set for QCalc in the system settings now, or null. */
        String system;
        /** The language set for QCalc in the system settings is to be put back to the system default. */
        boolean clearSystem;
    }

    /**
     * "Same as device" chosen in the app (1.12.0): no language of the user's own (qalc.lang and
     * qalc.langsys go), and on Android 13 and later the language set for QCalc in the system settings
     * goes back to the system default, so that choose() finds nothing set and follows the device.
     * qalc.langinit stays, so the language of an earlier user is not kept again.
     *
     * @param perAppSupported Android 13 or later
     * @param device the device's languages, the first first
     */
    static Choice automatic(boolean perAppSupported, List<Locale> device) {
        Choice c = new Choice();
        c.saved = null;
        c.sys = null;
        c.clearSystem = perAppSupported;
        String dev = first(device);
        c.lang = dev != null ? dev : "en";
        return c;
    }

    /**
     * Chooses the language of the app.
     *
     * @param perAppSupported Android 13 or later (a language can be set for QCalc in the system settings)
     * @param perApp the language set for QCalc in the system settings (one of CODES), or null for none
     * @param saved  qalc.lang, or null
     * @param sys    qalc.langsys, or null
     * @param init   qalc.langinit is there (the first start of 1.11.0 is over)
     * @param had    the page already has history or settings
     * @param device the device's languages, the first first
     */
    static Choice choose(boolean perAppSupported, String perApp, String saved, String sys, boolean init,
                         boolean had, List<Locale> device) {
        Choice c = new Choice();
        c.saved = saved;
        c.sys = sys;
        if (!init && saved == null && had) c.saved = legacy(device);
        if (perAppSupported) {
            if (perApp != null) {
                // set in the system settings (or by the app itself, and then it is the same)
                c.saved = perApp;
                c.sys = perApp;
            } else if (sys != null) {
                // it was set there, and has been put back to the system default since
                c.saved = null;
                c.sys = null;
            } else if (c.saved != null) {
                // a choice made in the app (or kept above) is shown in the system settings too
                c.system = c.saved;
                c.sys = c.saved;
            }
        }
        String dev = first(device);
        c.lang = c.saved != null ? c.saved : dev != null ? dev : "en";
        return c;
    }
}
