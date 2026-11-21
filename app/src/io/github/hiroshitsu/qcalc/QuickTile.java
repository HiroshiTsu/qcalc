package io.github.hiroshitsu.qcalc;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

/**
 * The tile of the quick settings (Android 7 and later, 1.12.0): a tap opens QCalc for a new
 * calculation, after the screen is unlocked when it is locked. From Android 14 the tile hands the
 * system a PendingIntent (starting an activity with an Intent is no longer allowed there).
 */
public class QuickTile extends TileService {
    private static final String TAG = "QCalc";

    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        // it opens the app; it is not something that is on or off
        t.setState(Tile.STATE_INACTIVE);
        t.updateTile();
    }

    @Override
    public void onClick() {
        if (isLocked()) {
            unlockAndRun(new Runnable() {
                @Override
                public void run() {
                    open();
                }
            });
        } else {
            open();
        }
    }

    @SuppressWarnings("deprecation")
    private void open() {
        try {
            if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(Quick.pending(this, QuickText.CALC));
            else startActivityAndCollapse(Quick.openIntent(this, QuickText.CALC));
        } catch (RuntimeException e) {
            Log.w(TAG, "tile", e);
        }
    }
}
