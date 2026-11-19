package io.github.hiroshitsu.qcalc;

import java.util.regex.Pattern;

/**
 * The images that the page shares (1.12.0, D4): their names and types, apart from Android so that
 * they can be tested on a computer. A shared image is a file in the app's cache (cache/shared/),
 * served to the app that receives it by ShareProvider; only names made here are served.
 */
final class ShareFiles {
    private ShareFiles() {
    }

    /** The folder in the cache. */
    static final String DIR = "shared";
    /** The largest image, in bytes (a GIF of the 3D graph is at most 2 MB; a PNG is smaller). */
    static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final Pattern NAME = Pattern.compile("qcalc-[0-9]{1,19}\\.(png|gif)");

    /** The type of a shared image ("image/png" or "image/gif"), or null for one that is not allowed. */
    static String typeOf(String mime) {
        return "image/png".equals(mime) || "image/gif".equals(mime) ? mime : null;
    }

    /** A new name for an image of the type (a time in milliseconds keeps the names apart). */
    static String nameFor(String mime, long now) {
        return "qcalc-" + Math.max(0, now) + ("image/gif".equals(mime) ? ".gif" : ".png");
    }

    /** Whether a name is one of these images (nothing else in the cache is served). */
    static boolean isName(String name) {
        return name != null && NAME.matcher(name).matches();
    }

    /** The type of the image of a name. */
    static String typeOfName(String name) {
        return name != null && name.endsWith(".gif") ? "image/gif" : "image/png";
    }
}
