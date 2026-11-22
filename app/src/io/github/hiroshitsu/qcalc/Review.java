package io.github.hiroshitsu.qcalc;

import android.app.Activity;

/**
 * Google Play's in-app review sheet (feature/ratings). The sheet itself is asked for by PlayReview
 * (app/src-billing), which uses the Play In-App Review Library; it is part of the app only when the app is
 * built for Google Play (Gradle with qcalc.billing=true, see app/build.gradle), like PlayBilling. It is
 * loaded by its name, so that the app also builds and runs without it (build-apk.sh, build-aab.sh):
 * there {@link #available()} is false and nothing is ever asked for.
 *
 * When to ask is decided by the page (see "In-App Review" in app.js): installed 3 days ago or more,
 * opened 5 times or more, no error just before, right after a 3D view or a tool's result was used, and
 * 30 days or more since the last time. Google Play decides whether the sheet is shown at all (it may not
 * be, by its own limits); the app learns nothing: no stars, no text, not even whether it was shown.
 */
final class Review {

    /** What PlayReview does. */
    interface Asker {
        /** Asks Google Play for the review sheet over the activity; done is called once, on any thread. */
        void ask(Activity activity, Done done);
    }

    /** How PlayReview reports the end of the request: "done" (Google Play went through it, shown or not) or "unavailable". */
    interface Done {
        void done(String state);
    }

    private final Asker asker;

    Review() {
        Asker a = null;
        try {
            Class<?> c = Class.forName("io.github.hiroshitsu.qcalc.PlayReview");
            a = (Asker) c.getDeclaredConstructor().newInstance();
        } catch (Throwable t) {
            // not built with the Play In-App Review Library
            a = null;
        }
        asker = a;
    }

    /** Whether this build can ask for the sheet (the build for Google Play). */
    boolean available() {
        return asker != null;
    }

    /** Asks for the sheet; without the library, done("none") at once. Never throws. */
    void ask(Activity activity, Done done) {
        if (asker == null) {
            done.done("none");
            return;
        }
        try {
            asker.ask(activity, done);
        } catch (Throwable t) {
            done.done("unavailable");
        }
    }
}
