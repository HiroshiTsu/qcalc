package io.github.hiroshitsu.qcalc;

/**
 * QCalc 1.12.1: whether the page may update the exchange rates by itself when the app starts
 * (QalcNative.autoRatesAllowed, asked by autoUpdateRates in app.js). Not while the device is roaming abroad,
 * and not in Data Saver; yes in every other case, and when the state cannot be read or reading it fails (as
 * until 1.12.0). "Update now", which the person presses, does not ask. The state of the device comes through
 * {@link Net} (MainActivity.DeviceNet: ConnectivityManager and TelephonyManager, with the permission
 * ACCESS_NETWORK_STATE), so that the rule is plain Java and can be tested without Android.
 */
final class AutoRates {
    /** ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED (API 24): Data Saver is on for this app. */
    static final int DATA_SAVER_ON = 3;

    /** What the rule reads of the device. A method may throw: that part is then taken as unknown. */
    interface Net {
        /** Build.VERSION.SDK_INT. */
        int sdk();

        /**
         * API 28 and later: whether the active network has NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING; null
         * when there is no active network or its capabilities cannot be read.
         */
        Boolean notRoaming();

        /**
         * API 24 to 27: whether the active network is Wi-Fi or Ethernet (NetworkCapabilities.TRANSPORT_WIFI or
         * TRANSPORT_ETHERNET); null when there is no active network or its capabilities cannot be read.
         */
        Boolean wifiOrEthernet();

        /** API 24 to 27: TelephonyManager.isNetworkRoaming() (the mobile network, even while on Wi-Fi). */
        boolean telephonyRoaming();

        /** ConnectivityManager.isActiveNetworkMetered(). */
        boolean metered();

        /** ConnectivityManager.getRestrictBackgroundStatus(). */
        int restrictBackground();
    }

    private AutoRates() {
    }

    static boolean allowed(Net n) {
        if (n == null) return true;
        return !roaming(n) && !dataSaver(n);
    }

    /**
     * API 28 and later: the active network without NET_CAPABILITY_NOT_ROAMING. API 24 to 27: not on Wi-Fi or
     * Ethernet (abroad on the Wi-Fi of a hotel the phone is not roaming, though its mobile network is), and
     * TelephonyManager.isNetworkRoaming(); when the kind of network cannot be read, TelephonyManager alone.
     */
    static boolean roaming(Net n) {
        try {
            if (n.sdk() >= 28) {
                Boolean notRoaming = n.notRoaming();
                return notRoaming != null && !notRoaming;
            }
            if (Boolean.TRUE.equals(wifiOrEthernet(n))) return false;
            return n.telephonyRoaming();
        } catch (RuntimeException e) {
            return false; // not known: the rates are updated as before
        }
    }

    private static Boolean wifiOrEthernet(Net n) {
        try {
            return n.wifiOrEthernet();
        } catch (RuntimeException e) {
            return null; // not known
        }
    }

    static boolean dataSaver(Net n) {
        try {
            return n.metered() && n.restrictBackground() == DATA_SAVER_ON;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
