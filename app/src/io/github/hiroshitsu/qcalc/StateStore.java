package io.github.hiroshitsu.qcalc;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Small JSON documents of the page (history, settings, the expression being typed), written
 * to files right away. WebView's localStorage writes its data to disk only after a delay, so
 * the newest history could be lost if the app was closed from the recent-apps screen right
 * after a calculation.
 *
 * Writing happens on a background thread so that the page never waits for the disk; a newer
 * text for the same name replaces one that has not been written yet.
 */
final class StateStore {

    private static final Pattern NAME = Pattern.compile("[a-z0-9._-]{1,64}");
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String REMOVE = new String("\u0000remove");

    private static final ExecutorService writer = Executors.newSingleThreadExecutor();
    private static final Map<String, String> pending = new HashMap<String, String>();

    private StateStore() {
    }

    private static File file(Context ctx, String name) {
        File dir = new File(ctx.getFilesDir(), "state");
        if (!dir.isDirectory() && !dir.mkdirs()) return null;
        return new File(dir, name + ".json");
    }

    static boolean validName(String name) {
        return name != null && NAME.matcher(name).matches();
    }

    /** Returns the stored text, or null if there is none. */
    static String load(Context ctx, String name) {
        if (!validName(name)) return null;
        // lock order everywhere: StateStore.class, then pending
        synchronized (StateStore.class) {
            synchronized (pending) {
                String p = pending.get(name);
                if (p != null) return p == REMOVE ? null : p;
            }
            File f = file(ctx, name);
            if (f == null || !f.isFile() || f.length() > MAX_BYTES) return null;
            try {
                FileInputStream in = new FileInputStream(f);
                try {
                    ByteArrayOutputStream out = new ByteArrayOutputStream((int) f.length());
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    return new String(out.toByteArray(), UTF8);
                } finally {
                    in.close();
                }
            } catch (IOException e) {
                return null;
            }
        }
    }

    /** Stores the text (null removes it). */
    static void save(final Context ctx, final String name, String data) {
        if (!validName(name)) return;
        if (data != null && data.length() > MAX_BYTES / 2) return;
        boolean schedule;
        synchronized (pending) {
            schedule = !pending.containsKey(name);
            pending.put(name, data == null ? REMOVE : data);
        }
        if (!schedule) return; // the scheduled write will pick up the newer text
        writer.execute(new Runnable() {
            @Override
            public void run() {
                synchronized (StateStore.class) {
                    String text;
                    synchronized (pending) {
                        text = pending.remove(name);
                    }
                    if (text != null) write(ctx, name, text == REMOVE ? null : text);
                }
            }
        });
    }

    /** Called with the StateStore.class lock held. */
    private static void write(Context ctx, String name, String data) {
        File f = file(ctx, name);
        if (f == null) return;
        if (data == null) {
            f.delete();
            return;
        }
        File tmp = new File(f.getPath() + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                out.write(data.getBytes(UTF8));
                out.getFD().sync();
            } finally {
                out.close();
            }
            if (!tmp.renameTo(f)) tmp.delete();
        } catch (IOException e) {
            tmp.delete();
        }
    }
}
