package io.github.hiroshitsu.qcalc;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.Currency;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Runs the calculation engine (libqalculate, packaged as lib/arm64-v8a/libqalcengine.so)
 * as a child process and talks to it with one JSON object per line.
 *
 * Every request has a deadline: if the engine does not answer in time (a calculation that
 * cannot be interrupted, or a hang), the process is killed and started again on the next
 * request. The engine reports each new "ans" value as an event line; the value is kept in
 * SharedPreferences and given back to a new engine process, so "ans" survives restarts.
 */
final class Engine {

    interface Callback {
        void done(String response);
    }

    /** Receives event lines from the engine (for example the text of a new "ans"). */
    interface EventListener {
        void onEvent(String json);
    }

    private static final String EOF = "\u0000EOF";
    private static final String ANS_EVENT = "{\"event\":\"ans\"";
    /**
     * Time on top of a request's own timeout. The engine answers by itself 3 s after the time
     * limit (and then exits); this is only a backstop for an engine that does not answer at all.
     */
    private static final long GRACE_MS = 10000;
    private static final long DEFAULT_TIMEOUT_MS = 30000;
    /**
     * Longest "ans" value that is kept. An approximate result with 200000 digits (the highest
     * precision) is saved as "interval(lower, upper)", about 400000 characters.
     */
    private static final int MAX_SAVED_ANSWER = 500000;

    private static Engine instance;

    static synchronized Engine get(Context context) {
        if (instance == null) instance = new Engine(context.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Process proc;
    private BufferedWriter toEngine;
    private LinkedBlockingQueue<String> lines;
    private volatile Process currentProcess;
    private volatile String lastAnswer;
    private volatile boolean cancelled;
    private volatile EventListener listener;

    private Engine(Context context) {
        ctx = context;
        prefs = ctx.getSharedPreferences("engine", Context.MODE_PRIVATE);
        lastAnswer = prefs.getString("ans", null);
    }

    File userDir() {
        File dir = new File(ctx.getFilesDir(), "qalculate");
        if (!dir.isDirectory()) dir.mkdirs();
        return dir;
    }

    void setEventListener(EventListener l) {
        listener = l;
    }

    void clearEventListener(EventListener l) {
        if (listener == l) listener = null;
    }

    /** Starts the engine in the background so that the first calculation is fast. */
    void warmUp() {
        worker.execute(new Runnable() {
            @Override
            public void run() {
                synchronized (Engine.this) {
                    try {
                        ensureRunning();
                    } catch (IOException ignored) {
                    }
                }
            }
        });
    }

    void submit(final String request, final Callback callback) {
        worker.execute(new Runnable() {
            @Override
            public void run() {
                String response;
                try {
                    response = call(request);
                } catch (RuntimeException e) {
                    response = error(null, "Communication with the calculation engine failed (" + e + ")", "engine");
                }
                callback.done(response);
            }
        });
    }

    /**
     * Stops the calculation in progress: the engine process is killed (the request then
     * returns "cancelled") and it is started again on the next request.
     * Not synchronized on purpose: call() holds the lock while it waits.
     */
    void cancel() {
        Process p = currentProcess;
        if (p != null) {
            cancelled = true;
            p.destroy();
        }
    }

    /** Sends one request and waits for its response line. Safe to call from any background thread. */
    synchronized String call(String request) {
        if (request == null || request.indexOf('\n') >= 0 || request.indexOf('\r') >= 0) {
            return error(null, "The request is not valid", "bad_request");
        }
        Object id;
        long budget = DEFAULT_TIMEOUT_MS;
        try {
            JSONObject r = new JSONObject(request);
            id = r.opt("id");
            long requestTimeout = r.optLong("timeout", 0);
            JSONArray exprs = r.optJSONArray("exprs");
            int n = exprs != null ? Math.max(1, exprs.length()) : 1;
            if (requestTimeout > 0) budget = requestTimeout * n + GRACE_MS;
        } catch (Exception e) {
            return error(null, "The request is not valid", "bad_request");
        }

        String lastError = "";
        cancelled = false;
        for (int attempt = 0; attempt < 2; attempt++) {
            boolean sent = false;
            try {
                ensureRunning();
                write(request);
                sent = true;
                String line = await(id, budget);
                if (line != null && !EOF.equals(line)) {
                    // the engine exits after this reply (time limit, out of memory): start a new one next time
                    if (line.contains("\"restart\":true")) stop();
                    return line;
                }
                stop();
                if (cancelled) return error(id, "The calculation was stopped", "cancelled");
                if (line == null) return error(id, "The calculation took too long and was stopped", "timeout");
                // The engine ended while working on this request. It is not sent again:
                // the same request would most likely end the new engine too.
                return error(id, "The calculation engine stopped unexpectedly. Try a simpler expression.", "crash");
            } catch (IOException e) {
                stop();
                if (cancelled) return error(id, "The calculation was stopped", "cancelled");
                lastError = e.getMessage() != null ? e.getMessage() : e.toString();
                if (sent) return error(id, "Communication with the calculation engine failed (" + lastError + ")", "engine");
                // writing failed: the engine had already exited; start it again and send once more
            }
        }
        return error(id, "Could not start the calculation engine (" + lastError + ")", "engine");
    }

    private void write(String request) throws IOException {
        toEngine.write(request);
        toEngine.write('\n');
        toEngine.flush();
    }

    /**
     * Waits for the complete response line with the same id (stray, stale or cut-off lines are
     * skipped). Returns null on timeout and EOF if the engine exited.
     */
    private String await(Object id, long timeoutMs) {
        String prefix = "{\"id\":" + jsonId(id) + ",";
        long deadline = System.currentTimeMillis() + timeoutMs;
        try {
            while (true) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) return null;
                String line = lines.poll(left, TimeUnit.MILLISECONDS);
                if (line == null || EOF.equals(line)) return line;
                if (line.startsWith(prefix) && line.endsWith("}")) return line;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    private static String jsonId(Object id) {
        if (id == null || id == JSONObject.NULL) return "null";
        if (id instanceof String) return JSONObject.quote((String) id);
        return String.valueOf(id);
    }

    private static String error(Object id, String message, String code) {
        try {
            JSONObject err = new JSONObject();
            err.put("id", id == null ? JSONObject.NULL : id);
            err.put("ok", false);
            err.put("error", message);
            err.put("code", code);
            return err.toString();
        } catch (Exception e) {
            return "{\"id\":null,\"ok\":false,\"error\":\"engine error\"}";
        }
    }

    /** An "ans" event from the engine: remember the value for the next engine process. */
    private void onAnswerEvent(String line) {
        try {
            String value = new JSONObject(line).optString("value", "");
            if (value.length() == 0 || value.length() > MAX_SAVED_ANSWER) value = null;
            lastAnswer = value;
            prefs.edit().putString("ans", value).apply();
        } catch (Exception ignored) {
        }
    }

    private void ensureRunning() throws IOException {
        if (proc != null && isAlive(proc)) return;
        stop();
        File exe = new File(ctx.getApplicationInfo().nativeLibraryDir, "libqalcengine.so");
        ProcessBuilder pb = new ProcessBuilder(exe.getAbsolutePath());
        Map<String, String> env = pb.environment();
        env.put("HOME", ctx.getFilesDir().getAbsolutePath());
        env.put("QALCULATE_USER_DIR", userDir().getAbsolutePath());
        env.put("TZ", posixTimeZone());
        env.put("LANG", "C.UTF-8");
        String currency = localCurrency();
        if (currency != null) env.put("QALC_CURRENCY", currency);
        pb.directory(ctx.getFilesDir());
        final Process p = pb.start();
        proc = p;
        currentProcess = p;
        toEngine = new BufferedWriter(new OutputStreamWriter(p.getOutputStream(), "UTF-8"));
        final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<String>();
        lines = queue;
        final BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream(), "UTF-8"));
        Thread readerThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.startsWith(ANS_EVENT)) {
                            onAnswerEvent(line);
                            EventListener l = listener;
                            if (l != null) l.onEvent(line);
                        } else {
                            queue.add(line);
                        }
                    }
                } catch (IOException ignored) {
                }
                queue.add(EOF);
            }
        }, "qalc-stdout");
        readerThread.setDaemon(true);
        readerThread.start();
        final InputStream err = p.getErrorStream();
        Thread drain = new Thread(new Runnable() {
            @Override
            public void run() {
                byte[] buf = new byte[4096];
                try {
                    while (err.read(buf) >= 0) {
                        // discard diagnostics
                    }
                } catch (IOException ignored) {
                }
            }
        }, "qalc-stderr");
        drain.setDaemon(true);
        drain.start();
        // give "ans" back to the new process
        String ans = lastAnswer;
        if (ans != null && ans.length() > 0) {
            try {
                JSONObject r = new JSONObject();
                r.put("id", -1); // ids below 1 are never used by the page
                r.put("cmd", "set_ans");
                r.put("expr", ans);
                write(r.toString());
                await(-1, 20000); // the engine allows set_ans 15 s (a long value is slow to read)
            } catch (Exception ignored) {
            }
        }
    }

    private void stop() {
        if (proc != null) {
            proc.destroy();
            proc = null;
        }
        if (toEngine != null) {
            try {
                toEngine.close();
            } catch (IOException ignored) {
            }
            toEngine = null;
        }
        currentProcess = null;
    }

    private static boolean isAlive(Process p) {
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    /** The currency of the phone's region (JPY in Japan), or null. */
    private static String localCurrency() {
        try {
            Currency c = Currency.getInstance(Locale.getDefault());
            return c != null ? c.getCurrencyCode() : null;
        } catch (RuntimeException e) {
            return null; // a language without a region
        }
    }

    /** The engine is a static Linux binary; give it the current UTC offset as a POSIX TZ string. */
    private static String posixTimeZone() {
        int minutes = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
        int a = Math.abs(minutes);
        return String.format(Locale.US, "LOC%s%d:%02d", minutes >= 0 ? "-" : "+", a / 60, a % 60);
    }
}
