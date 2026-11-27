package de.mermaideditor;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

public final class ClipboardImageProvider extends ContentProvider {
    static final String NAME = "diagram.png";
    static final Uri BASE_URI = Uri.parse("content://de.mermaideditor.clipboard/");

    static File directory(Context context) { return new File(context.getCacheDir(), "clipboard"); }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return file(uri) != null ? "image/png" : null; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File image = file(uri);
        if (image == null || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(image, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File image = file(uri);
        if (image == null || !image.isFile()) return null;
        String[] columns = projection != null ? projection : new String[] {
            OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE
        };
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(NAME);
            else if (OpenableColumns.SIZE.equals(column)) row.add(image.length());
            else row.add(null);
        }
        return cursor;
    }

    private File file(Uri uri) {
        if (uri.getPathSegments().size() != 1) return null;
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[0-9a-f-]{36}\\.png")) return null;
        return new File(directory(getContext()), name);
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
