package io.github.hiroshitsu.qcalc;

import android.app.Activity;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Google Play's in-app review sheet, with the Play In-App Review Library (com.google.android.play:review).
 * Only in the build for Google Play (qcalc.billing=true); Review.java loads it by its name. Google Play
 * decides whether the sheet is shown; a request that fails is not an error for the user (the page shows
 * nothing either way).
 */
final class PlayReview implements Review.Asker {

    @Override
    public void ask(final Activity activity, final Review.Done done) {
        final ReviewManager manager = ReviewManagerFactory.create(activity);
        manager.requestReviewFlow().addOnCompleteListener(new OnCompleteListener<ReviewInfo>() {
            @Override
            public void onComplete(Task<ReviewInfo> request) {
                if (!request.isSuccessful() || activity.isFinishing()) {
                    done.done("unavailable");
                    return;
                }
                try {
                    manager.launchReviewFlow(activity, request.getResult()).addOnCompleteListener(new OnCompleteListener<Void>() {
                        @Override
                        public void onComplete(Task<Void> flow) {
                            // the flow has ended; whether the sheet was shown is not told (the API's rule)
                            done.done("done");
                        }
                    });
                } catch (RuntimeException e) {
                    done.done("unavailable");
                }
            }
        });
    }
}
