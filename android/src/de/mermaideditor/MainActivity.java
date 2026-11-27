package de.mermaideditor;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.os.PersistableBundle;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String WEB = ORIGIN + "/web/";
    private static final int PICK_DOCUMENT = 1;
    private static final int GRANT_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private Documents documents;
    private SharedPreferences settings;
    private WebView editor;

    private static final class Picker {
        final int id;
        final String route;
        final JSONObject body;

        Picker(int id, String route, JSONObject body) {
            this.id = id;
            this.route = route;
            this.body = body;
        }
    }

    private Picker picker;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        documents = new Documents(this);
        settings = getSharedPreferences("settings", MODE_PRIVATE);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0)
            WebView.setWebContentsDebuggingEnabled(true);
        editor = newWebView(true);
        setContentView(editor);
        editor.addJavascriptInterface(new Bridge(), "MmeAndroid");
        editor.loadUrl(WEB + "index.html");
    }

    @Override protected void onPause() {
        call("window.__mmeAndroidPause?.()");
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        call("window.__mmeAndroidResume?.()");
    }

    @Override protected void onDestroy() {
        io.shutdown();
        if (editor != null) {
            editor.removeJavascriptInterface("MmeAndroid");
            if (editor.getParent() instanceof android.view.ViewGroup)
                ((android.view.ViewGroup) editor.getParent()).removeView(editor);
            editor.destroy();
            editor = null;
        }
        super.onDestroy();
    }

    private WebView newWebView(boolean interactive) {
        WebView view = new WebView(this) {
            @Override public InputConnection onCreateInputConnection(EditorInfo attributes) {
                InputConnection connection = super.onCreateInputConnection(attributes);
                attributes.imeOptions |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
                return connection;
            }
        };
        view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        view.getSettings().setJavaScriptEnabled(interactive);
        view.getSettings().setDomStorageEnabled(interactive);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.getSettings().setBlockNetworkLoads(true);
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                return resource(request.getUrl());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if (interactive && request.isForMainFrame() && request.hasGesture() && !HOST.equals(url.getHost()) &&
                    ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        return view;
    }

    private WebResourceResponse resource(Uri url) {
        if (!HOST.equals(url.getHost()) || !"https".equals(url.getScheme())) return missing();
        String path = url.getPath();
        if (path == null) return missing();
        try {
            if ("/api/asset".equals(path)) {
                String name = url.getQueryParameter("path");
                if (name == null) return missing();
                String mime = Documents.mimeFor(name);
                return response(mime, documents.openImage(name, mime));
            }
            if (!path.equals("/web/index.html") && !path.equals("/web/style.css") && !path.equals("/web/icon.svg") &&
                !path.matches("/web/dist/(main|chunks/[a-zA-Z0-9_-]+)\\.js")) return missing();
            String mime = path.endsWith(".js") ? "text/javascript" :
                path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : "image/svg+xml";
            return response(mime, getAssets().open(path.substring(1)));
        } catch (IOException | RuntimeException error) {
            return missing();
        }
    }

    private static WebResourceResponse response(String mime, InputStream stream) {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; font-src 'self' data:; base-uri 'none'; form-action 'none'");
        return new WebResourceResponse(mime, mime.startsWith("text/") ? "UTF-8" : null, 200, "OK", headers, stream);
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
    }

    final class Bridge {
        @JavascriptInterface public String locale() {
            return settings.getString("locale", Locale.getDefault().getLanguage());
        }

        @JavascriptInterface public void send(int id, String message) {
            io.execute(() -> {
                String route = "";
                String method = "";
                try {
                    JSONObject request = new JSONObject(message);
                    route = request.getString("route");
                    method = request.optString("method");
                    JSONObject query = request.optJSONObject("query");
                    JSONObject body = request.optJSONObject("body");
                    JSONObject result = new JSONObject();
                    switch (route) {
                        case "state":
                            break;
                        case "files":
                            result.put("files", documents.list(query.getString("dir")));
                            break;
                        case "file":
                            if ("PUT".equals(method)) {
                                result.put("mtime", documents.save(body.getString("path"), body.getString("content"),
                                    body.optLong("baseMtime"), body.optBoolean("force")));
                            } else {
                                result = documents.file(query.getString("path"));
                            }
                            break;
                        case "dialog/open":
                        case "dialog/save":
                        case "dialog/folder":
                        case "export":
                            String pickerRoute = route;
                            runOnUiThread(() -> openPicker(new Picker(id, pickerRoute, body)));
                            return;
                        case "export/pdf":
                            runOnUiThread(() -> print(id, body.optString("name"), body.optString("markup")));
                            return;
                        case "copyImage":
                            copyImage(id, body.getString("data"));
                            return;
                        case "locale":
                            settings.edit().putString("locale", body.getString("locale")).apply();
                            break;
                        case "watch":
                        case "status":
                            break;
                        default:
                            throw new Documents.Failure(400, "unknownRequest");
                    }
                    reply(id, result);
                } catch (Exception error) {
                    boolean writing = route.equals("export") || route.equals("copyImage") ||
                        (route.equals("file") && method.equals("PUT"));
                    fail(id, error, writing ? "writeFailed" : "unreadableFile");
                }
            });
        }
    }

    private void openPicker(Picker request) {
        if (editor == null) return;
        if (picker != null) {
            reply(request.id, new JSONObject());
            return;
        }
        Intent intent;
        switch (request.route) {
            case "dialog/open":
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                break;
            case "dialog/folder":
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                break;
            default:
                String name = request.body.optString("name");
                intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(Documents.mimeFor(name))
                    .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, name);
        }
        intent.addFlags(GRANT_FLAGS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        String dir = request.body.optString("dir");
        io.execute(() -> {
            if (!dir.isEmpty()) {
                try { intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, documents.resolve(dir)); }
                catch (IOException | RuntimeException ignored) { }
            }
            runOnUiThread(() -> {
                if (editor == null) return;
                try { startActivityForResult(intent, PICK_DOCUMENT); }
                catch (ActivityNotFoundException error) {
                    picker = null;
                    fail(request.id, error, "requestFailed");
                }
            });
        });
        picker = request;
    }

    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PICK_DOCUMENT || picker == null) return;
        Picker request = picker;
        picker = null;
        Uri uri = data == null ? null : data.getData();
        if (result != RESULT_OK || uri == null) {
            reply(request.id, new JSONObject());
            return;
        }
        io.execute(() -> {
            boolean exporting = request.route.equals("export");
            try {
                JSONObject response = new JSONObject();
                if (exporting) {
                    documents.write(uri, Base64.decode(request.body.getString("data"), Base64.DEFAULT));
                    response.put("saved", true).put("path", request.body.getString("name"));
                } else {
                    String path = documents.remember(uri, data.getFlags() & GRANT_FLAGS, request.route.equals("dialog/folder"));
                    response.put("path", path);
                }
                reply(request.id, response);
            } catch (Exception error) {
                fail(request.id, error, exporting ? "writeFailed" : "unreadableFile");
            }
        });
    }

    private void copyImage(int id, String data) throws IOException {
        byte[] image = Base64.decode(data, Base64.DEFAULT);
        File directory = ClipboardImageProvider.directory(this);
        if (!directory.isDirectory() && !directory.mkdir()) throw new IOException("Cannot create clipboard cache");
        File[] oldImages = directory.listFiles();
        File target = new File(directory, UUID.randomUUID() + ".png");
        AtomicFile file = new AtomicFile(target);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(image);
            file.finishWrite(stream);
        } catch (IOException error) {
            file.failWrite(stream);
            throw error;
        }
        runOnUiThread(() -> {
            try {
                Uri uri = Uri.withAppendedPath(ClipboardImageProvider.BASE_URI, target.getName());
                ClipData clip = ClipData.newUri(getContentResolver(), "Mermaid Editor", uri);
                PersistableBundle flags = new PersistableBundle();
                flags.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
                clip.getDescription().setExtras(flags);
                getSystemService(ClipboardManager.class).setPrimaryClip(clip);
                if (oldImages != null) for (File old : oldImages) old.delete();
                new File(getCacheDir(), ClipboardImageProvider.NAME).delete();
                reply(id, new JSONObject());
            } catch (RuntimeException error) {
                target.delete();
                fail(id, error, "writeFailed");
            }
        });
    }

    private void print(int id, String name, String markup) {
        if (editor == null) return;
        WebView page = newWebView(false);
        page.setWebViewClient(new WebViewClient() {
            private boolean printing;

            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                return resource(request.getUrl());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (printing || !url.equals(WEB + "print.html")) return;
                printing = true;
                if (editor == null) {
                    page.destroy();
                    return;
                }
                try {
                    PrintDocumentAdapter adapter = page.createPrintDocumentAdapter(name);
                    getSystemService(PrintManager.class).print(name, new PrintDocumentAdapter() {
                        @Override public void onStart() { adapter.onStart(); }

                        @Override public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs,
                                CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                            adapter.onLayout(oldAttrs, newAttrs, signal, callback, extras);
                        }

                        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                CancellationSignal signal, WriteResultCallback callback) {
                            adapter.onWrite(pages, destination, signal, callback);
                        }

                        @Override public void onFinish() {
                            adapter.onFinish();
                            page.destroy();
                        }
                    }, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build());
                    reply(id, new JSONObject());
                } catch (RuntimeException error) {
                    page.destroy();
                    fail(id, error, "pdfGenerationFailed");
                }
            }
        });
        page.loadDataWithBaseURL(WEB + "print.html", "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<link rel=\"stylesheet\" href=\"style.css\"></head><body class=\"pdf-printing\">" +
            "<div id=\"pdf-document\">" + markup + "</div></body></html>", "text/html", "UTF-8", WEB + "print.html");
    }

    private void fail(int id, Exception error, String fallback) {
        int status = 500;
        String code = fallback;
        if (error instanceof Documents.Failure) {
            status = ((Documents.Failure) error).status;
            code = ((Documents.Failure) error).code;
        } else if (error instanceof SecurityException) {
            status = 403;
            code = "permissionDenied";
        } else if (error instanceof FileNotFoundException) {
            status = 404;
            code = "notFound";
        }
        JSONObject result = new JSONObject();
        try { result.put("status", status).put("code", code).put("error", code); }
        catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        reply(id, result);
    }

    private void reply(int id, JSONObject result) {
        call("window.__mmeAndroidReply?.(" + id + "," + JSONObject.quote(result.toString()) + ")");
    }

    private void call(String script) {
        runOnUiThread(() -> {
            if (editor != null) editor.evaluateJavascript(script, null);
        });
    }
}
