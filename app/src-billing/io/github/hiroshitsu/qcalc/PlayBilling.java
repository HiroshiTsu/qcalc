package io.github.hiroshitsu.qcalc;

import android.app.Activity;
import android.content.Context;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.AcknowledgePurchaseResponseListener;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.ProductDetailsResponseListener;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesResponseListener;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The purchase of QCalc Pro in Google Play (Google Play Billing Library 8): the one-time product
 * Pro.PRODUCT_ID. Only built when the app is built with the library (see Pro.java, app/build.gradle);
 * Pro loads this class by its name.
 *
 * A purchase is acknowledged after it is paid (Google Play refunds purchases that are not
 * acknowledged within three days). Purchases are asked for at the start and whenever the app
 * comes back to the screen, so that a purchase made outside the app (a promo code in the Play
 * Store, a pending payment that was completed) is found, and a refunded one is no longer counted.
 */
final class PlayBilling implements Pro.Store, PurchasesUpdatedListener {

    private final Pro.Owner owner;
    private final BillingClient client;
    private ProductDetails details;
    private boolean connecting, userAsked, reportNone;
    private final List<Runnable> waiting = new ArrayList<Runnable>();

    PlayBilling(Context context, Pro.Owner owner) {
        this.owner = owner;
        client = BillingClient.newBuilder(context.getApplicationContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
    }

    @Override
    public void start() {
        refresh();
    }

    @Override
    public void refresh() {
        whenReady(new Runnable() {
            @Override
            public void run() {
                if (details == null) queryDetails(null);
                queryPurchases();
            }
        }, false);
    }

    @Override
    public void restore() {
        synchronized (this) {
            reportNone = true;
        }
        whenReady(new Runnable() {
            @Override
            public void run() {
                queryPurchases();
            }
        }, true);
    }

    @Override
    public void buy(final Activity activity) {
        whenReady(new Runnable() {
            @Override
            public void run() {
                ProductDetails d;
                synchronized (PlayBilling.this) {
                    d = details;
                }
                if (d != null) launch(activity, d);
                else queryDetails(activity);
            }
        }, true);
    }

    @Override
    public void end() {
        try {
            client.endConnection();
        } catch (RuntimeException ignored) {
        }
    }

    /** Runs the task once the connection to Google Play is ready. */
    private void whenReady(Runnable task, boolean asked) {
        synchronized (this) {
            if (!client.isReady()) {
                if (asked) userAsked = true;
                waiting.add(task);
                if (connecting) return;
                connecting = true;
                task = null;
            }
        }
        if (task != null) {
            task.run();
            return;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                List<Runnable> tasks;
                boolean report;
                synchronized (PlayBilling.this) {
                    connecting = false;
                    tasks = new ArrayList<Runnable>(waiting);
                    waiting.clear();
                    report = userAsked;
                    userAsked = false;
                }
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (Runnable t : tasks) t.run();
                } else if (report) {
                    owner.message(problem(result));
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                synchronized (PlayBilling.this) {
                    connecting = false;
                }
            }
        });
    }

    /** The price, and with an activity the purchase screen after it. */
    private void queryDetails(final Activity buyWith) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(Pro.PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()))
                .build();
        client.queryProductDetailsAsync(params, new ProductDetailsResponseListener() {
            @Override
            public void onProductDetailsResponse(BillingResult result, QueryProductDetailsResult found) {
                ProductDetails d = null;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && found != null) {
                    for (ProductDetails p : found.getProductDetailsList()) {
                        if (Pro.PRODUCT_ID.equals(p.getProductId())) d = p;
                    }
                }
                if (d == null) {
                    if (buyWith != null) owner.message(result.getResponseCode() == BillingClient.BillingResponseCode.OK
                            ? "QCalc Pro cannot be bought right now" : problem(result));
                    return;
                }
                synchronized (PlayBilling.this) {
                    details = d;
                }
                ProductDetails.OneTimePurchaseOfferDetails offer = d.getOneTimePurchaseOfferDetails();
                if (offer != null) owner.price(offer.getFormattedPrice());
                if (buyWith != null) launch(buyWith, d);
            }
        });
    }

    private void launch(final Activity activity, final ProductDetails d) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (activity.isFinishing()) return;
                BillingFlowParams.ProductDetailsParams.Builder product =
                        BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d);
                // the offer the user can buy (Library 8: one-time products have purchase options)
                String token = offerToken(d);
                if (token != null) product.setOfferToken(token);
                BillingFlowParams params = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(Collections.singletonList(product.build()))
                        .build();
                BillingResult r = client.launchBillingFlow(activity, params);
                int code = r.getResponseCode();
                if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) queryPurchases();
                else if (code != BillingClient.BillingResponseCode.OK
                        && code != BillingClient.BillingResponseCode.USER_CANCELED) owner.message(problem(r));
            }
        });
    }

    /** Results of the purchase screen. */
    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            handle(purchases, false);
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            queryPurchases();
        } else if (code != BillingClient.BillingResponseCode.USER_CANCELED) {
            owner.message(problem(result));
        }
    }

    private void queryPurchases() {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                new PurchasesResponseListener() {
                    @Override
                    public void onQueryPurchasesResponse(BillingResult result, List<Purchase> purchases) {
                        boolean report;
                        synchronized (PlayBilling.this) {
                            report = reportNone;
                            reportNone = false;
                        }
                        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                            // keep what is known (no network, for example)
                            if (report) owner.message(problem(result));
                            return;
                        }
                        handle(purchases, report);
                    }
                });
    }

    /** The purchases of Google Play: owned, pending or none; acknowledges a new purchase. */
    private void handle(List<Purchase> purchases, boolean reportNone) {
        boolean owned = false, pending = false;
        if (purchases != null) {
            for (Purchase p : purchases) {
                if (!p.getProducts().contains(Pro.PRODUCT_ID)) continue;
                int state = p.getPurchaseState();
                if (state == Purchase.PurchaseState.PURCHASED) {
                    owned = true;
                    if (!p.isAcknowledged()) acknowledge(p);
                } else if (state == Purchase.PurchaseState.PENDING) {
                    pending = true;
                }
            }
        }
        owner.owned(owned, pending);
        if (!owned && pending) owner.message("The payment is pending. QCalc Pro will be unlocked when it is complete.");
        else if (!owned && reportNone) owner.message("No purchase of QCalc Pro was found");
    }

    private void acknowledge(Purchase p) {
        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(p.getPurchaseToken())
                .build();
        client.acknowledgePurchase(params, new AcknowledgePurchaseResponseListener() {
            @Override
            public void onAcknowledgePurchaseResponse(BillingResult result) {
                // if this fails, the next query of the purchases tries again
            }
        });
    }

    /** The offer token of the purchase option to buy: the backward-compatible one, else the first. */
    private static String offerToken(ProductDetails d) {
        ProductDetails.OneTimePurchaseOfferDetails offer = d.getOneTimePurchaseOfferDetails();
        if (offer != null && offer.getOfferToken() != null) return offer.getOfferToken();
        List<ProductDetails.OneTimePurchaseOfferDetails> all = d.getOneTimePurchaseOfferDetailsList();
        if (all != null) {
            for (ProductDetails.OneTimePurchaseOfferDetails o : all) {
                if (o.getOfferToken() != null) return o.getOfferToken();
            }
        }
        return null;
    }

    /** A message for a result that is not OK. */
    private static String problem(BillingResult r) {
        switch (r.getResponseCode()) {
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE:
            case BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED:
                return "Google Play is not available on this device";
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.SERVICE_DISCONNECTED:
            case BillingClient.BillingResponseCode.NETWORK_ERROR:
                return "Could not connect to Google Play. Try again later.";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE:
                return "QCalc Pro cannot be bought right now";
            default:
                return "The purchase could not be completed (" + r.getResponseCode() + ")";
        }
    }
}
