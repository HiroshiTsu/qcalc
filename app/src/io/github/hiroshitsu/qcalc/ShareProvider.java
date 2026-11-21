package io.github.hiroshitsu.qcalc;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Gives the app that receives a shared image of a graph (1.12.0, D4) that image, to read only: a small
 * provider of the app's own, so that no library is needed (FileProvider is in AndroidX). It is not
 * exported; the receiving app may read one image because the intent grants it
 * (FLAG_GRANT_READ_URI_PERMISSION). Only the images in cache/shared/ with the names of ShareFiles are
 * served; nothing can be written or deleted through it.
 */
public final class ShareProvider extends ContentProvider {

    /** The address of an image: content://<package>.share/<name>. */
    static Uri uriFor(String packageName, String name) {
        return new Uri.Builder().scheme("content").authority(packageName + ".share").appendPath(name).build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    private File fileOf(Uri uri) {
        String name = uri.getLastPathSegment();
        if (!ShareFiles.isName(name) || getContext() == null) return null;
        File f = new File(new File(getContext().getCacheDir(), ShareFiles.DIR), name);
        return f.isFile() ? f : null;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode == null || !mode.startsWith("r") || mode.contains("w")) throw new SecurityException("read only");
        File f = fileOf(uri);
        if (f == null) throw new FileNotFoundException(String.valueOf(uri));
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return ShareFiles.isName(uri.getLastPathSegment()) ? ShareFiles.typeOfName(uri.getLastPathSegment()) : null;
    }

    /** The name and the size, which the receiving apps ask for (OpenableColumns). */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = fileOf(uri);
        if (f == null) return null;
        String[] cols = projection != null ? projection : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
