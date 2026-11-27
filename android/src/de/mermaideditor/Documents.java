package de.mermaideditor;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class Documents {
    static final String RECENT = "/Documents";
    private static final String TREES = "/folders/";
    private static final String[] COLUMNS = {
        Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE
    };

    static final class Failure extends IOException {
        final int status;
        final String code;

        Failure(int status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }
    }

    private static final class Entry {
        final String name;
        final String id;
        final String mime;

        Entry(Cursor row) {
            id = row.getString(0);
            name = row.getString(1);
            mime = row.getString(2);
        }

        boolean isFolder() { return Document.MIME_TYPE_DIR.equals(mime); }
    }

    private final ContentResolver resolver;
    private final SharedPreferences grants;

    Documents(Context context) {
        resolver = context.getContentResolver();
        grants = context.getSharedPreferences("documents", Context.MODE_PRIVATE);
    }

    String remember(Uri uri, int flags, boolean folder) throws IOException {
        if (!"content".equals(uri.getScheme())) throw new Failure(400, "invalidPath");
        Uri document = folder ? treeRoot(uri) : uri;
        String name;
        try (Cursor cursor = resolver.query(document, new String[] { Document.COLUMN_DISPLAY_NAME },
                null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new FileNotFoundException();
            name = cursor.getString(0);
        }
        if (name == null || name.isEmpty() || name.contains("/") || name.equals(".") || name.equals(".."))
            throw new Failure(400, "invalidPath");
        if (!folder && !isDocument(name)) throw new Failure(400, "chooseSupportedFile");
        resolver.takePersistableUriPermission(uri, flags);
        for (Map.Entry<String, ?> grant : grants.getAll().entrySet()) {
            if (uri.toString().equals(grant.getValue())) return grant.getKey();
        }

        String path = folder ? TREES + UUID.randomUUID() + "/" + name : RECENT + "/" + name;
        if (grants.contains(path)) path = RECENT + "/" + UUID.randomUUID() + "/" + name;
        grants.edit().putString(path, uri.toString()).apply();
        return path;
    }

    Uri resolve(String path) throws IOException {
        if (path == null || !path.startsWith("/")) throw new Failure(400, "invalidPath");
        if (path.startsWith(RECENT + "/")) {
            String uri = grants.getString(path, null);
            if (uri != null) return Uri.parse(uri);
        }
        if (!path.startsWith(TREES)) throw new Failure(403, "fileNotAllowed");

        String[] parts = path.split("/", -1);
        if (parts.length < 4) throw new Failure(400, "invalidPath");
        String root = TREES + parts[2] + "/" + parts[3];
        String source = grants.getString(root, null);
        if (source == null) throw new Failure(403, "folderNotAllowed");
        Uri tree = Uri.parse(source);
        List<String> names = new ArrayList<>();
        for (int i = 4; i < parts.length; i++) {
            String name = parts[i];
            if (name.isEmpty() || name.equals(".")) continue;
            if (name.equals("..")) {
                if (names.isEmpty()) throw new Failure(403, "fileNotAllowed");
                names.remove(names.size() - 1);
            } else {
                names.add(name);
            }
        }
        String id = DocumentsContract.getTreeDocumentId(tree);
        for (String name : names) {
            Entry found = null;
            for (Entry entry : children(tree, id)) {
                if (name.equals(entry.name)) {
                    found = entry;
                    break;
                }
            }
            if (found == null) throw new FileNotFoundException();
            id = found.id;
        }
        return DocumentsContract.buildDocumentUriUsingTree(tree, id);
    }

    JSONArray list(String dir) throws Exception {
        List<String> paths = new ArrayList<>();
        if (dir.equals(RECENT) || dir.startsWith(RECENT + "/")) {
            for (String path : grants.getAll().keySet()) {
                if (path.startsWith(RECENT + "/")) paths.add(path);
            }
        } else {
            Uri folder = resolve(dir);
            collect(folder, DocumentsContract.getDocumentId(folder), dir, paths, 0, new int[] { 0 });
        }
        String root = dir.startsWith(RECENT + "/") ? RECENT : dir;
        paths.sort(Comparator.comparing(path -> path.substring(root.length() + 1), String.CASE_INSENSITIVE_ORDER));
        JSONArray results = new JSONArray();
        for (String path : paths) {
            String rel = path.substring(root.length() + 1);
            if (root.equals(RECENT)) rel = rel.substring(rel.lastIndexOf('/') + 1);
            results.put(new JSONObject().put("path", path).put("rel", rel));
        }
        return results;
    }

    private void collect(Uri tree, String id, String path, List<String> paths, int depth, int[] visited) {
        if (depth == 12 || visited[0] >= 3000) return;
        for (Entry child : children(tree, id)) {
            if (++visited[0] > 3000) break;
            if (child.name == null || child.name.contains("/") || child.name.startsWith(".")) continue;
            String subpath = path + "/" + child.name;
            if (child.isFolder()) collect(tree, child.id, subpath, paths, depth + 1, visited);
            else if (isDocument(child.name)) paths.add(subpath);
        }
    }

    private List<Entry> children(Uri tree, String id) {
        List<Entry> entries = new ArrayList<>();
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
        try (Cursor cursor = resolver.query(uri, COLUMNS, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) entries.add(new Entry(cursor));
        }
        return entries;
    }

    JSONObject file(String path) throws Exception {
        if (!isDocument(path)) throw new Failure(400, "unsupportedFile");
        byte[] contents = read(resolve(path));
        String content = new String(contents, StandardCharsets.UTF_8).replace("\r\n", "\n").replace('\r', '\n');
        return new JSONObject().put("path", path).put("content", content).put("mtime", revision(contents));
    }

    long save(String path, String content, long baseRevision, boolean force) throws Exception {
        if (!isDocument(path)) throw new Failure(400, "unsupportedFile");
        Uri uri = resolve(path);
        byte[] contents = content.getBytes(StandardCharsets.UTF_8);
        if (!force && baseRevision != 0 && revision(read(uri)) != baseRevision)
            throw new Failure(409, "conflict");
        write(uri, contents);
        return revision(contents);
    }

    InputStream openImage(String path, String mime) throws IOException {
        if (mime == null || !mime.startsWith("image/")) throw new Failure(403, "imageNotAllowed");
        InputStream stream = resolver.openInputStream(resolve(path));
        if (stream == null) throw new FileNotFoundException();
        return stream;
    }

    private byte[] read(Uri uri) throws IOException {
        try (InputStream in = resolver.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new FileNotFoundException();
            byte[] buffer = new byte[8192];
            for (int count; (count = in.read(buffer)) != -1; ) out.write(buffer, 0, count);
            return out.toByteArray();
        }
    }

    void write(Uri uri, byte[] contents) throws IOException {
        try (OutputStream out = resolver.openOutputStream(uri, "wt")) {
            if (out == null) throw new FileNotFoundException();
            out.write(contents);
        }
    }

    private static long revision(byte[] contents) throws Exception {
        // The content fingerprint also detects changes on providers without reliable timestamps.
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(contents);
        long value = 0;
        for (int i = 0; i < 6; i++) value = (value << 8) | (digest[i] & 255);
        return value + 1;
    }

    static Uri treeRoot(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    static boolean isDocument(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".md") || lower.endsWith(".markdown") ||
            lower.endsWith(".mmd") || lower.endsWith(".mermaid");
    }

    static String mimeFor(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        if (mime != null) return mime;
        if (extension.equals("md") || extension.equals("markdown")) return "text/markdown";
        return "application/octet-stream";
    }
}
