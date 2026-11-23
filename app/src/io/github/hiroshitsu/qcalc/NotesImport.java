package io.github.hiroshitsu.qcalc;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Calculation notes read in (1.15.0): a file chosen in Android's file picker ("Open a file" in the notes,
 * ACTION_OPEN_DOCUMENT), or text or a .txt or .csv file shared to QCalc from another app (ACTION_SEND).
 *
 * <p>This only reads. What is read goes to the page as an "import" event (window.QalcBridge.receiveEvent): shared
 * text as it is, a file as its bytes in Base64, which the page decodes (UTF-8 with or without a BOM, UTF-16 with a
 * BOM, otherwise Shift_JIS) and puts into a memo as lines of text. Nothing is sent anywhere. No permission is needed:
 * the file picker and the app that shares give access to that one file only ("content:" addresses; others are not
 * read). At most {@link #MAX_BYTES}: a larger file is not read, and the page says so.
 */
final class NotesImport {
    private static final String TAG = "QCalc";
    /** The most that is read: 1 MB (the page refuses more, and a memo holds at most 300 lines). */
    static final int MAX_BYTES = 1024 * 1024;
    /** The kinds of file the picker offers: text and CSV (a CSV is often "text/comma-separated-values" on Android). */
    private static final String[] MIME_TYPES = {
        "text/plain", "text/csv", "text/comma-separated-values", "text/x-csv", "application/csv", "text/tab-separated-values"
    };

    private NotesImport() {
    }

    /** Android's file picker for one text or CSV file. */
    static Intent pickerIntent() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, MIME_TYPES);
        return i;
    }

    /** Whether an intent is text or a file shared to QCalc (the intent filter of MainActivity in the manifest). */
    static boolean isShare(Intent intent) {
        return intent != null && Intent.ACTION_SEND.equals(intent.getAction());
    }

    /** The event for a share: the text, or the file read (call it on a background thread). */
    static String fromShare(Context c, Intent intent) {
        Uri stream = streamOf(intent);
        if (stream != null) return read(c, stream, "share", intent.getType());
        CharSequence text = null;
        try {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } catch (RuntimeException e) {
            Log.w(TAG, "share", e);
        }
        if (text == null) return error("share", "read");
        if (text.length() > MAX_BYTES) return error("share", "too-big");
        try {
            JSONObject o = base("share");
            o.put("text", text.toString());
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (subject != null && !subject.trim().isEmpty()) o.put("subject", clip(subject.trim(), 100));
            return o.toString();
        } catch (JSONException | RuntimeException e) {
            return error("share", "read");
        }
    }

    /** Reads one file (call it on a background thread): its name, its kind and its bytes, or why it was not read. */
    static String read(Context c, Uri uri, String from, String mimeHint) {
        if (uri == null || !"content".equals(uri.getScheme())) return error(from, "read");
        String name = null;
        long size = -1;
        try (Cursor cur = c.getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int n = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME), s = cur.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !cur.isNull(n)) name = cur.getString(n);
                if (s >= 0 && !cur.isNull(s)) size = cur.getLong(s);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "import: name", e);
        }
        if (name == null) name = uri.getLastPathSegment();
        if (size > MAX_BYTES) return tooBig(from, name, size);
        String mime = null;
        try {
            mime = c.getContentResolver().getType(uri);
        } catch (RuntimeException e) {
            // (the kind given by the app that shared it is used)
        }
        if (mime == null) mime = mimeHint;
        byte[] bytes;
        try (InputStream in = c.getContentResolver().openInputStream(uri)) {
            if (in == null) return error(from, "read");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int k;
            while ((k = in.read(buf)) > 0) {
                out.write(buf, 0, k);
                // (the size the provider gave may be missing or wrong: no more than MAX_BYTES is kept)
                if (out.size() > MAX_BYTES) return tooBig(from, name, -1);
            }
            bytes = out.toByteArray();
        } catch (Exception e) {
            Log.w(TAG, "import: read", e);
            return error(from, "read");
        }
        try {
            JSONObject o = base(from);
            if (name != null) o.put("name", clip(name, 200));
            if (mime != null) o.put("mime", clip(mime, 100));
            o.put("b64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            return o.toString();
        } catch (JSONException e) {
            return error(from, "read");
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri streamOf(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            Object o = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return o instanceof Uri ? (Uri) o : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static JSONObject base(String from) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("event", "import");
        o.put("from", from);
        return o;
    }

    static String error(String from, String what) {
        try {
            JSONObject o = base(from);
            o.put("error", what);
            return o.toString();
        } catch (JSONException e) {
            return "{\"event\":\"import\",\"error\":\"read\"}";
        }
    }

    private static String tooBig(String from, String name, long size) {
        try {
            JSONObject o = base(from);
            o.put("error", "too-big");
            if (name != null) o.put("name", clip(name, 200));
            if (size > 0) o.put("bytes", size);
            return o.toString();
        } catch (JSONException e) {
            return error(from, "too-big");
        }
    }

    private static String clip(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }
}
