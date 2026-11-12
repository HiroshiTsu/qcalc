package io.github.hiroshitsu.qcalc;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads the exchange-rate files from the same sources the official Qalculate! uses
 * (libqalculate reports the URLs and the file names), then tells the engine to reload them.
 */
final class RatesUpdater {

    private static final int MAX_BYTES = 1000000;
    private static final String FALLBACK_RATES_URL = "https://latest.currency-api.pages.dev/v1/currencies/eur.json";

    private RatesUpdater() {
    }

    /**
     * Synchronized: an automatic and a manual update must not write the same files at once.
     * appVersion (for example "1.1.0") is sent to the servers in the User-Agent header.
     */
    static synchronized String update(Engine engine, int id, String appVersion) {
        String userAgent = "QCalc/" + cleanVersion(appVersion) + " (Android; libqalculate 5.13.2)";
        JSONObject result = new JSONObject();
        try {
            result.put("id", id);
            JSONObject info = new JSONObject(engine.call("{\"id\":-2,\"cmd\":\"rates_info\"}"));
            JSONArray sources = info.optJSONArray("sources");
            if (sources == null) throw new IOException(info.optString("error", "rates_info failed"));
            int updated = 0;
            JSONArray failed = new JSONArray();
            for (int i = 0; i < sources.length(); i++) {
                JSONObject src = sources.getJSONObject(i);
                int index = src.getInt("index");
                String[] urls = index == 3 ? new String[]{src.getString("url"), FALLBACK_RATES_URL} : new String[]{src.getString("url")};
                boolean ok = false;
                for (String url : urls) {
                    try {
                        byte[] data = download(url, userAgent);
                        if (isValid(index, new String(data, "UTF-8"))) {
                            writeAtomically(new File(src.getString("file")), data);
                            ok = true;
                            break;
                        }
                    } catch (IOException ignored) {
                    }
                }
                if (ok) updated++;
                else failed.put(hostOf(src.getString("url")));
            }
            JSONObject reload = new JSONObject(engine.call("{\"id\":-3,\"cmd\":\"rates_reload\"}"));
            if (updated > 0 && !reload.optBoolean("loaded", false)) {
                throw new IOException("計算エンジンが新しいレートを読み込めませんでした");
            }
            result.put("ok", updated > 0);
            result.put("updated", updated);
            result.put("total", sources.length());
            result.put("failed", failed);
            result.put("time", reload.optDouble("time", 0));
            if (updated == 0) result.put("error", "為替レートをダウンロードできませんでした。通信状態を確認してください。");
        } catch (Exception e) {
            try {
                result.put("ok", false);
                result.put("error", "為替レートの更新に失敗しました（" + (e.getMessage() != null ? e.getMessage() : e.toString()) + "）");
            } catch (Exception ignored) {
            }
        }
        return result.toString();
    }

    /**
     * The same checks as libqalculate's own downloader, plus a check that the file is complete
     * (a cut-off download would otherwise replace good rates, and libqalculate would quietly
     * go back to its built-in rates).
     */
    private static boolean isValid(int index, String s) {
        switch (index) {
            case 1:
                return s.contains("<Cube") && s.contains("currency=") && s.trim().endsWith("</gesmes:Envelope>");
            case 2:
                return s.contains("\"amount\":") && s.contains("\"currency\":") && isJsonObject(s);
            case 3:
                return (s.contains(": {") || s.contains(":{"))
                        && (s.contains("\"eur\": 1,") || s.contains("\"eur\":1,") || s.contains("\"EUR\": 1,") || s.contains("\"EUR\":1,"))
                        && isJsonObject(s);
            default:
                return s.length() > 0;
        }
    }

    private static boolean isJsonObject(String s) {
        try {
            new JSONObject(s);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Only letters, digits, dots and hyphens of the version name; "0" if there is none. */
    private static String cleanVersion(String v) {
        StringBuilder b = new StringBuilder();
        if (v != null) {
            for (int i = 0; i < v.length() && b.length() < 32; i++) {
                char c = v.charAt(i);
                if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '.' || c == '-') b.append(c);
            }
        }
        return b.length() > 0 ? b.toString() : "0";
    }

    private static byte[] download(String address, String userAgent) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", userAgent);
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new IOException("too large");
            }
            in.close();
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static void writeAtomically(File target, byte[] data) throws IOException {
        File dir = target.getParentFile();
        if (dir != null && !dir.isDirectory()) dir.mkdirs();
        File tmp = new File(target.getPath() + ".tmp");
        FileOutputStream out = new FileOutputStream(tmp);
        try {
            out.write(data);
            out.getFD().sync();
        } finally {
            out.close();
        }
        if (!tmp.renameTo(target)) throw new IOException("rename failed");
    }

    private static String hostOf(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            return url;
        }
    }
}
