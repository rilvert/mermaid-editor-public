// Mermaid Editor – native macOS-App.
// Ein Fenster pro Dokument; die Oberfläche (public/) läuft in einer WKWebView,
// Dateizugriffe, Dialoge und Menüs übernimmt diese App.

import Cocoa
import WebKit
import UniformTypeIdentifiers

let docExtensions = ["md", "markdown", "mmd", "mermaid", "txt"]
let listExtensions: Set<String> = ["md", "markdown", "mmd", "mermaid"]
let imageTypes = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"]
let mimeTypes = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
                 "css": "text/css; charset=utf-8", "svg": "image/svg+xml", "png": "image/png", "json": "application/json", "map": "application/json"]
let debug = ProcessInfo.processInfo.environment["MME_DEBUG"] != nil

func mtimeOf(_ path: String) -> Double? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let date = attrs[.modificationDate] as? Date else { return nil }
    return (date.timeIntervalSince1970 * 1000).rounded()
}

func isAllowedDoc(_ path: String) -> Bool {
    docExtensions.contains((path as NSString).pathExtension.lowercased())
}

func jsonArg(_ value: Any) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])) ?? Data("null".utf8)
    return String(data: data, encoding: .utf8) ?? "null"
}

// MARK: - Statische Dateien über mme://app/…

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL

    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path == "/api/asset" {
            let p = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "path" }?.value ?? ""
            let ext = (p as NSString).pathExtension.lowercased()
            if let mime = imageTypes[ext], p.hasPrefix("/"), let data = FileManager.default.contents(atPath: p) {
                respond(task, url, data, mime, 200)
            } else {
                respond(task, url, Data(), "text/plain", 404)
            }
            return
        }
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), var data = try? Data(contentsOf: file) else {
            respond(task, url, Data(), "text/plain", 404)
            return
        }
        if path == "/index.html", let s = String(data: data, encoding: .utf8) {
            data = Data(s.replacingOccurrences(of: "__TOKEN__", with: "native").utf8)
        }
        respond(task, url, data, mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream", 200)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ data: Data, _ mime: String, _ status: Int) {
        let headers = ["Content-Type": mime, "Cache-Control": "no-cache", "Content-Length": String(data.count)]
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
}

// Verhindert, dass die WKWebView den Controller festhält
final class WeakHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: EditorWindow?
    init(_ t: EditorWindow) { target = t }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let t = target else { replyHandler(nil, "closed"); return }
        t.handle(message, replyHandler)
    }
}

// MARK: - Fenster

final class EditorWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    let window: NSWindow
    let webView: WKWebView
    var filePath: String?
    var dirty = false
    var closingAllowed = false
    var loaded = false
    private var watchPath: String?
    private var watchMtime: Double = 0
    private var timer: Timer?
    private weak var app: AppDelegate?

    init(app: AppDelegate, file: String?, newDoc: Bool) {
        self.app = app
        filePath = file
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(app.scheme, forURLScheme: "mme")
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__mmeInitialLocale = \(jsonArg(app.locale))", injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1400, height: 900), configuration: config)
        if #available(macOS 13.3, *) { webView.isInspectable = debug }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        super.init()
        config.userContentController.addScriptMessageHandler(WeakHandler(self), contentWorld: .page, name: "mme")

        window.title = file.map { ($0 as NSString).lastPathComponent } ?? "Mermaid Editor"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: 0x21 / 255, green: 0x25 / 255, blue: 0x2b / 255, alpha: 1)
                : NSColor(srgbRed: 0xf5 / 255, green: 0xf6 / 255, blue: 0xf8 / 255, alpha: 1)
        }
        window.minSize = NSSize(width: 600, height: 400)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        webView.navigationDelegate = self
        webView.uiDelegate = self

        var comps = URLComponents(string: "mme://app/index.html")!
        var items: [URLQueryItem] = []
        if let f = file { items.append(URLQueryItem(name: "file", value: f)) }
        if newDoc { items.append(URLQueryItem(name: "new", value: "1")) }
        if !items.isEmpty { comps.queryItems = items }
        webView.load(URLRequest(url: comps.url!))

        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.poll() }
    }

    func show(cascadeFrom other: NSWindow?) {
        if let other = other {
            window.setFrame(other.frame, display: false)
            window.setFrameTopLeftPoint(window.cascadeTopLeft(from: NSPoint(x: other.frame.minX, y: other.frame.maxY)))
        } else if !window.setFrameUsingName("MermaidEditorMain") {
            if let screen = NSScreen.main?.visibleFrame {
                window.setFrame(screen.insetBy(dx: screen.width * 0.06, dy: screen.height * 0.05), display: false)
            } else {
                window.center()
            }
        }
        window.makeKeyAndOrderFront(nil)
    }

    // ---------------------------------------------------------------- JS

    private func text(_ de: String, _ en: String) -> String { app?.text(de, en) ?? en }

    func updateLocale(_ locale: String) {
        if filePath == nil { window.title = text("Unbenannt", "Untitled") }
        webView.evaluateJavaScript("window.__mmeInitialLocale = \(jsonArg(locale)); window.__mmeCommand?.('locale', window.__mmeInitialLocale)", completionHandler: nil)
    }
    func command(_ name: String) {
        webView.evaluateJavaScript("window.__mmeCommand && window.__mmeCommand(\(jsonArg(name)))", completionHandler: nil)
    }

    func openFile(_ path: String) {
        filePath = path
        webView.evaluateJavaScript("window.__mmeCommand && window.__mmeCommand('openPath', \(jsonArg(path)))", completionHandler: nil)
    }

    /// Speichert offene Änderungen; fragt bei unbenannten Dokumenten nach.
    func flush(_ done: @escaping (Bool) -> Void) {
        guard loaded, dirty else { done(true); return }
        webView.callAsyncJavaScript("return await window.__mmeFlush(false)", arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self = self else { done(true); return }
            let r = (try? result.get()) as? [String: Any]
            if r?["ok"] as? Bool == true { done(true); return }
            if r?["untitled"] as? Bool != true { done(false); return }
            let alert = NSAlert()
            alert.messageText = self.text("Möchtest du die Änderungen sichern?", "Do you want to save your changes?")
            alert.informativeText = self.text("Das Dokument wurde noch nie gesichert.", "This document has never been saved.")
            alert.addButton(withTitle: self.text("Sichern …", "Save…"))
            alert.addButton(withTitle: self.text("Nicht sichern", "Don’t Save"))
            alert.addButton(withTitle: self.text("Abbrechen", "Cancel"))
            alert.beginSheetModal(for: self.window) { resp in
                switch resp {
                case .alertFirstButtonReturn:
                    self.webView.callAsyncJavaScript("return await window.__mmeFlush(true)", arguments: [:], in: nil, in: .page) { r2 in
                        let ok = ((try? r2.get()) as? [String: Any])?["ok"] as? Bool ?? false
                        done(ok)
                    }
                case .alertSecondButtonReturn:
                    self.webView.evaluateJavaScript("window.__mmeCommand && window.__mmeCommand('discard')", completionHandler: nil)
                    done(true)
                default:
                    done(false)
                }
            }
        }
    }

    private func notify(_ event: [String: Any]) {
        webView.evaluateJavaScript("window.__mmeNative && window.__mmeNative(\(jsonArg(event)))", completionHandler: nil)
    }

    private func poll() {
        guard let p = watchPath, let m = mtimeOf(p) else { return }
        if abs(m - watchMtime) > 1 {
            watchMtime = m
            notify(["type": "change", "path": p, "mtime": m])
        }
    }

    // ---------------------------------------------------------------- Brücke
    func handle(_ message: WKScriptMessage, _ reply: @escaping (Any?, String?) -> Void) {
        guard let msg = message.body as? [String: Any], let route = msg["route"] as? String else {
            reply(["error": "invalidRequest", "code": "invalidRequest", "status": 400], nil); return
        }
        let method = (msg["method"] as? String) ?? "GET"
        let body = (msg["body"] as? [String: Any]) ?? [:]
        let query = (msg["query"] as? [String: Any]) ?? [:]
        let fail = { (status: Int, code: String) in reply(["error": code, "code": code, "status": status], nil) }

        switch (route, method) {
        case ("state", _):
            reply(["home": NSHomeDirectory(), "native": true], nil)

        case ("files", _):
            guard let dir = query["dir"] as? String, dir.hasPrefix("/") else { return fail(400, "missingFolder") }
            DispatchQueue.global(qos: .userInitiated).async {
                let files = listFiles(dir)
                DispatchQueue.main.async { reply(["dir": dir, "files": files], nil) }
            }

        case ("file", "GET"):
            guard let p = query["path"] as? String, p.hasPrefix("/"), isAllowedDoc(p) else { return fail(403, "unsupportedFile") }
            if !FileManager.default.fileExists(atPath: p) {
                return reply(["path": p, "content": "", "mtime": 0, "isNew": true], nil)
            }
            guard let data = FileManager.default.contents(atPath: p) else { return fail(500, "unreadableFile") }
            let content = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            NSDocumentController.shared.noteNewRecentDocumentURL(URL(fileURLWithPath: p))
            reply(["path": p, "content": content, "mtime": mtimeOf(p) ?? 0], nil)

        case ("file", "PUT"):
            guard let p = body["path"] as? String, p.hasPrefix("/"), isAllowedDoc(p) else { return fail(403, "unsupportedFile") }
            let content = body["content"] as? String ?? ""
            let base = body["baseMtime"] as? Double ?? 0
            let force = body["force"] as? Bool ?? false
            if base > 0, !force, let m = mtimeOf(p), abs(m - base) > 1 {
                return reply(["error": "conflict", "status": 409, "mtime": m], nil)
            }
            do {
                let url = URL(fileURLWithPath: p)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data(content.utf8).write(to: url)
                let m = mtimeOf(p) ?? 0
                if p == watchPath { watchMtime = m }
                NSDocumentController.shared.noteNewRecentDocumentURL(url)
                reply(["path": p, "mtime": m], nil)
            } catch {
                fail(500, "writeFailed")
            }

        case ("stat", _):
            let p = query["path"] as? String ?? ""
            if let m = mtimeOf(p) { reply(["mtime": m], nil) } else { reply(["mtime": 0, "missing": true], nil) }

        case ("watch", _):
            watchPath = body["path"] as? String
            watchMtime = watchPath.flatMap(mtimeOf) ?? 0
            reply(["ok": true], nil)

        case ("locale", "POST"):
            if let locale = body["locale"] as? String { app?.setLocale(locale) }
            reply(["ok": true], nil)

        case ("status", _):
            let path = body["path"] as? String
            filePath = path
            dirty = body["dirty"] as? Bool ?? false
            window.isDocumentEdited = dirty
            window.title = path.map { ($0 as NSString).lastPathComponent } ?? text("Unbenannt", "Untitled")
            window.representedURL = path.flatMap { FileManager.default.fileExists(atPath: $0) ? URL(fileURLWithPath: $0) : nil }
            if let a = body["appearance"] as? String {
                window.appearance = NSAppearance(named: a == "dark" ? .darkAqua : .aqua)
            } else {
                window.appearance = nil
            }
            reply(["ok": true], nil)

        case ("dialog/open", _):
            let panel = NSOpenPanel()
            panel.message = text("Datei öffnen", "Open file")
            panel.prompt = text("Öffnen", "Open")
            panel.allowedContentTypes = docExtensions.compactMap { UTType(filenameExtension: $0) }
            panel.allowsMultipleSelection = false
            if let d = body["dir"] as? String { panel.directoryURL = URL(fileURLWithPath: d) }
            panel.beginSheetModal(for: window) { resp in
                reply(["path": resp == .OK ? (panel.url?.path as Any) : NSNull()], nil)
            }

        case ("dialog/save", _):
            let panel = NSSavePanel()
            panel.message = text("Speichern unter", "Save as")
            panel.prompt = text("Speichern", "Save")
            panel.nameFieldLabel = text("Dateiname", "File name")
            panel.allowedContentTypes = ["md", "mmd"].compactMap { UTType(filenameExtension: $0) }
            panel.allowsOtherFileTypes = true
            panel.isExtensionHidden = false
            panel.nameFieldStringValue = body["name"] as? String ?? text("Diagramm.md", "Diagram.md")
            if let d = body["dir"] as? String { panel.directoryURL = URL(fileURLWithPath: d) }
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, var p = panel.url?.path else { return reply(["path": NSNull()], nil) }
                if !isAllowedDoc(p) { p += ".md" }
                reply(["path": p], nil)
            }

        case ("dialog/folder", _):
            let panel = NSOpenPanel()
            panel.message = text("Ordner öffnen", "Open folder")
            panel.prompt = text("Öffnen", "Open")
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            if let d = body["dir"] as? String { panel.directoryURL = URL(fileURLWithPath: d) }
            panel.beginSheetModal(for: window) { resp in
                reply(["path": resp == .OK ? (panel.url?.path as Any) : NSNull()], nil)
            }

        case ("reveal", _):
            if let p = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
            reply(["ok": true], nil)

        case ("export/pdf", "POST"):
            let panel = NSSavePanel()
            panel.message = text("Als PDF exportieren", "Export as PDF")
            panel.prompt = text("Speichern", "Save")
            panel.allowedContentTypes = [.pdf]
            panel.nameFieldStringValue = body["name"] as? String ?? text("Unbenannt.pdf", "Untitled.pdf")
            panel.isExtensionHidden = false
            if let p = filePath { panel.directoryURL = URL(fileURLWithPath: p).deletingLastPathComponent() }
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { return reply(["saved": false], nil) }
                let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
                defer { try? FileManager.default.removeItem(at: temporary) }
                let margin: CGFloat = 15.0 * 72.0 / 25.4
                let printInfo = NSPrintInfo(dictionary: [
                    .jobDisposition: NSPrintInfo.JobDisposition.save,
                    .jobSavingURL: temporary,
                    .headerAndFooter: false
                ])
                printInfo.paperSize = NSSize(width: 210 * 72.0 / 25.4, height: 297 * 72.0 / 25.4)
                printInfo.leftMargin = margin
                printInfo.rightMargin = margin
                printInfo.topMargin = margin
                printInfo.bottomMargin = margin
                printInfo.isHorizontallyCentered = false
                printInfo.isVerticallyCentered = false
                let operation = self.webView.printOperation(with: printInfo)
                operation.showsPrintPanel = false
                operation.showsProgressPanel = false
                guard operation.run(), let data = try? Data(contentsOf: temporary), !data.isEmpty else {
                    return fail(500, "pdfGenerationFailed")
                }
                do {
                    try data.write(to: url, options: .atomic)
                    reply(["saved": true, "path": url.path], nil)
                } catch {
                    fail(500, "writeFailed")
                }
            }

        case ("export", _):
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return fail(400, "missingData") }
            let panel = NSSavePanel()
            panel.message = text("Speichern unter", "Save as")
            panel.prompt = text("Speichern", "Save")
            panel.nameFieldLabel = text("Dateiname", "File name")
            panel.nameFieldStringValue = body["name"] as? String ?? text("diagramm", "diagram")
            panel.isExtensionHidden = false
            if let p = filePath { panel.directoryURL = URL(fileURLWithPath: p).deletingLastPathComponent() }
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { return reply(["saved": false], nil) }
                do { try data.write(to: url); reply(["saved": true, "path": url.path], nil) }
                catch { fail(500, "writeFailed") }
            }

        case ("copyImage", _):
            guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return fail(400, "missingData") }
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setData(data, forType: .png)
            reply(["ok": true], nil)

        case ("newWindow", _):
            app?.openWindow(file: body["path"] as? String, newDoc: body["path"] == nil)
            reply(["ok": true], nil)

        default:
            fail(404, "unknownRequest")
        }
    }

    // ---------------------------------------------------------------- Navigation
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let locale = app?.locale { updateLocale(locale) }
        if let script = ProcessInfo.processInfo.environment["MME_SELFTEST"], !selftestRan {
            selftestRan = true
            runSelftest(script)
        }
    }

    // Nur für Tests: MME_SELFTEST=/pfad/test.js führt das Skript aus und speichert Ergebnis + Bild.
    private var selftestRan = false
    private func runSelftest(_ path: String) {
        let js = (try? String(contentsOfFile: path, encoding: .utf8)) ?? "return null"
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            self.webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                let out: String
                switch result {
                case .success(let v): out = jsonArg(v ?? NSNull())
                case .failure(let e): out = "FEHLER: \(e)"
                }
                try? out.write(toFile: path + ".out.json", atomically: true, encoding: .utf8)
                self.webView.takeSnapshot(with: WKSnapshotConfiguration()) { img, _ in
                    if let tiff = img?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                       let png = rep.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: path + ".png"))
                    }
                    if ProcessInfo.processInfo.environment["MME_SELFTEST_QUIT"] != nil {
                        self.dirty = false
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "mme" || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme != "mme" { NSWorkspace.shared.open(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: text("Abbrechen", "Cancel"))
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    // ---------------------------------------------------------------- Fenster
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closingAllowed || !dirty { return true }
        flush { [weak self] ok in
            guard let self = self, ok else { return }
            self.closingAllowed = true
            self.window.close()
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        window.saveFrame(usingName: "MermaidEditorMain")
        timer?.invalidate()
        timer = nil
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        app?.windowClosed(self)
    }

    func windowDidMove(_ notification: Notification) { window.saveFrame(usingName: "MermaidEditorMain") }
    func windowDidEndLiveResize(_ notification: Notification) { window.saveFrame(usingName: "MermaidEditorMain") }
}

func listFiles(_ dir: String, maxDepth: Int = 4, maxFiles: Int = 800) -> [[String: String]] {
    var out: [[String: String]] = []
    let fm = FileManager.default
    func walk(_ d: String, _ depth: Int) {
        guard out.count < maxFiles, let names = try? fm.contentsOfDirectory(atPath: d) else { return }
        for name in names.sorted(by: { $0.localizedStandardCompare($1) == .orderedAscending }) {
            if name.hasPrefix(".") || name == "node_modules" { continue }
            let full = (d as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            fm.fileExists(atPath: full, isDirectory: &isDir)
            if isDir.boolValue {
                if depth < maxDepth && !name.hasSuffix(".app") { walk(full, depth + 1) }
            } else if listExtensions.contains((name as NSString).pathExtension.lowercased()) {
                let rel = String(full.dropFirst(dir.count + 1))
                out.append(["path": full, "rel": rel])
                if out.count >= maxFiles { return }
            }
        }
    }
    walk(dir, 0)
    return out
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    var windows: [EditorWindow] = []
    var scheme: SchemeHandler!
    private var launched = false
    private var pendingOpen: [String] = []
    private(set) var locale = UserDefaults.standard.string(forKey: "EditorLocale") == "de" ? "de" : "en"

    func text(_ de: String, _ en: String) -> String { locale == "en" ? en : de }

    func setLocale(_ value: String) {
        guard value == "de" || value == "en", value != locale else { return }
        locale = value
        UserDefaults.standard.set(value, forKey: "EditorLocale")
        buildMenu()
        windows.forEach { $0.updateLocale(value) }
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        let root = Bundle.main.resourceURL!.appendingPathComponent("public")
        scheme = SchemeHandler(root: root)
        buildMenu()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        launched = true
        // Pfade aus der Kommandozeile (z. B. beim direkten Aufruf der Binary)
        for arg in CommandLine.arguments.dropFirst() where !arg.hasPrefix("-") {
            let p = URL(fileURLWithPath: arg).standardizedFileURL.path
            if isAllowedDoc(p) { pendingOpen.append(p) }
        }
        if pendingOpen.isEmpty {
            openWindow(file: nil, newDoc: false)
        } else {
            pendingOpen.forEach { open(path: $0) }
        }
        pendingOpen = []
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        let paths = urls.filter { $0.isFileURL }.map { $0.path }
        if !launched { pendingOpen.append(contentsOf: paths); return }
        paths.forEach { open(path: $0) }
    }

    func open(path: String) {
        if let w = windows.first(where: { $0.filePath == path }) {
            w.window.makeKeyAndOrderFront(nil)
            return
        }
        if let w = current, w.filePath == nil, !w.dirty {
            w.openFile(path)
            w.window.makeKeyAndOrderFront(nil)
            return
        }
        openWindow(file: path, newDoc: false)
    }

    @discardableResult
    func openWindow(file: String?, newDoc: Bool) -> EditorWindow {
        let w = EditorWindow(app: self, file: file, newDoc: newDoc)
        let previous = current?.window
        windows.append(w)
        w.show(cascadeFrom: previous)
        return w
    }

    func windowClosed(_ w: EditorWindow) {
        windows.removeAll { $0 === w }
    }

    var current: EditorWindow? {
        let key = NSApp.keyWindow ?? NSApp.mainWindow
        return windows.first { $0.window === key } ?? windows.last
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let open = windows.filter { $0.dirty }
        if open.isEmpty { return .terminateNow }
        func next(_ i: Int) {
            if i >= open.count { NSApp.reply(toApplicationShouldTerminate: true); return }
            open[i].window.makeKeyAndOrderFront(nil)
            open[i].flush { ok in ok ? next(i + 1) : NSApp.reply(toApplicationShouldTerminate: false) }
        }
        next(0)
        return .terminateLater
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // ---------------------------------------------------------------- Menü
    @objc func showAbout(_ sender: Any?) {
        let description = text("Mermaid-Editor mit Synchronisierung zwischen Code und Diagramm",
                               "Mermaid editor with synchronization between code and diagram")
        NSApp.orderFrontStandardAboutPanel(options: [.credits: NSAttributedString(string: description)])
    }
    @objc func newDocument(_ sender: Any?) { openWindow(file: nil, newDoc: true) }
    @objc func openDocument(_ sender: Any?) {
        if let w = current { w.command("open") } else {
            let panel = NSOpenPanel()
            panel.message = text("Datei öffnen", "Open file")
            panel.prompt = text("Öffnen", "Open")
            panel.allowedContentTypes = docExtensions.compactMap { UTType(filenameExtension: $0) }
            if panel.runModal() == .OK, let u = panel.url { open(path: u.path) }
        }
    }
    @objc func openFolder(_ sender: Any?) { current?.command("folder") }
    @objc func saveDocument(_ sender: Any?) { current?.command("save") }
    @objc func saveDocumentAs(_ sender: Any?) { current?.command("saveas") }
    @objc func exportPDF(_ sender: Any?) { current?.command("pdf") }
    @objc func revealInFinder(_ sender: Any?) { current?.command("reveal") }
    @objc func viewCode(_ sender: Any?) { current?.command("view:code") }
    @objc func viewSplit(_ sender: Any?) { current?.command("view:split") }
    @objc func viewPreview(_ sender: Any?) { current?.command("view:preview") }
    @objc func toggleFiles(_ sender: Any?) { current?.command("sidebar") }
    @objc func zoomInPreview(_ sender: Any?) { current?.command("zoomIn") }
    @objc func zoomOutPreview(_ sender: Any?) { current?.command("zoomOut") }
    @objc func zoomResetPreview(_ sender: Any?) { current?.command("zoomReset") }
    @objc func findInCode(_ sender: Any?) { current?.command("find") }
    @objc func selectLanguage(_ item: NSMenuItem) {
        if let value = item.representedObject as? String { setLocale(value) }
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(selectLanguage(_:)) || item.action == #selector(showAbout(_:)) { return true }
        if item.action == #selector(newDocument(_:)) || item.action == #selector(openDocument(_:)) { return true }
        if item.action == #selector(revealInFinder(_:)) { return current?.filePath != nil }
        return current != nil
    }

    private func buildMenu() {
        let main = NSMenu()
        func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = mods
            if let t = target { item.target = t }
            menu.addItem(item)
        }
        func sub(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let m = NSMenu(title: title)
            item.submenu = m
            main.addItem(item)
            return m
        }

        let appMenu = sub("Mermaid Editor")
        add(appMenu, text("Über Mermaid Editor", "About Mermaid Editor"), #selector(showAbout(_:)), target: self)
        appMenu.addItem(.separator())
        let services = NSMenuItem(title: text("Dienste", "Services"), action: nil, keyEquivalent: "")
        services.submenu = NSMenu()
        NSApp.servicesMenu = services.submenu
        appMenu.addItem(services)
        appMenu.addItem(.separator())
        add(appMenu, text("Mermaid Editor ausblenden", "Hide Mermaid Editor"), #selector(NSApplication.hide(_:)), "h")
        add(appMenu, text("Andere ausblenden", "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        add(appMenu, text("Alle einblenden", "Show All"), #selector(NSApplication.unhideAllApplications(_:)))
        appMenu.addItem(.separator())
        add(appMenu, text("Mermaid Editor beenden", "Quit Mermaid Editor"), #selector(NSApplication.terminate(_:)), "q")

        let file = sub(text("Ablage", "File"))
        add(file, text("Neu", "New"), #selector(newDocument(_:)), "n", target: self)
        add(file, text("Öffnen …", "Open…"), #selector(openDocument(_:)), "o", target: self)
        let recentItem = NSMenuItem(title: text("Zuletzt benutzt", "Open Recent"), action: nil, keyEquivalent: "")
        let recent = NSMenu(title: text("Zuletzt benutzt", "Open Recent"))
        recent.addItem(NSMenuItem(title: text("Einträge löschen", "Clear Menu"), action: #selector(NSDocumentController.clearRecentDocuments(_:)), keyEquivalent: ""))
        recentItem.submenu = recent
        file.addItem(recentItem)
        add(file, text("Ordner öffnen …", "Open Folder…"), #selector(openFolder(_:)), "o", [.command, .shift], target: self)
        file.addItem(.separator())
        add(file, text("Schliessen", "Close"), #selector(NSWindow.performClose(_:)), "w")
        add(file, text("Sichern", "Save"), #selector(saveDocument(_:)), "s", target: self)
        add(file, text("Sichern unter …", "Save As…"), #selector(saveDocumentAs(_:)), "s", [.command, .shift], target: self)
        add(file, text("Als PDF exportieren …", "Export as PDF…"), #selector(exportPDF(_:)), target: self)
        file.addItem(.separator())
        add(file, text("Im Finder zeigen", "Show in Finder"), #selector(revealInFinder(_:)), "r", [.command, .shift], target: self)

        let edit = sub(text("Bearbeiten", "Edit"))
        add(edit, text("Widerrufen", "Undo"), Selector(("undo:")), "z")
        add(edit, text("Wiederholen", "Redo"), Selector(("redo:")), "z", [.command, .shift])
        edit.addItem(.separator())
        add(edit, text("Ausschneiden", "Cut"), #selector(NSText.cut(_:)), "x")
        add(edit, text("Kopieren", "Copy"), #selector(NSText.copy(_:)), "c")
        add(edit, text("Einsetzen", "Paste"), #selector(NSText.paste(_:)), "v")
        add(edit, text("Alles auswählen", "Select All"), #selector(NSText.selectAll(_:)), "a")
        edit.addItem(.separator())
        add(edit, text("Suchen …", "Find…"), #selector(findInCode(_:)), "f", target: self)

        let view = sub(text("Darstellung", "View"))
        add(view, text("Nur Code", "Code Only"), #selector(viewCode(_:)), "1", target: self)
        add(view, text("Code und Diagramm", "Code and Diagram"), #selector(viewSplit(_:)), "2", target: self)
        add(view, text("Nur Diagramm", "Diagram Only"), #selector(viewPreview(_:)), "3", target: self)
        view.addItem(.separator())
        add(view, text("Dateien ein-/ausblenden", "Toggle Files"), #selector(toggleFiles(_:)), "s", [.command, .control], target: self)
        view.addItem(.separator())
        add(view, text("Diagramme vergrössern", "Zoom In"), #selector(zoomInPreview(_:)), "+", target: self)
        add(view, text("Diagramme verkleinern", "Zoom Out"), #selector(zoomOutPreview(_:)), "-", target: self)
        add(view, text("Originalgrösse", "Actual Size"), #selector(zoomResetPreview(_:)), "0", target: self)
        view.addItem(.separator())
        add(view, text("Vollbild", "Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        view.addItem(.separator())
        let language = NSMenuItem(title: text("Sprache", "Language"), action: nil, keyEquivalent: "")
        let languages = NSMenu(title: language.title)
        for (value, title) in [("de", text("Deutsch", "German")), ("en", text("Englisch", "English"))] {
            let item = NSMenuItem(title: title, action: #selector(selectLanguage(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = value
            item.state = value == locale ? .on : .off
            languages.addItem(item)
        }
        language.submenu = languages
        view.addItem(language)

        let win = sub(text("Fenster", "Window"))
        add(win, text("Im Dock ablegen", "Minimize"), #selector(NSWindow.performMiniaturize(_:)), "m")
        add(win, text("Zoomen", "Zoom"), #selector(NSWindow.performZoom(_:)))
        win.addItem(.separator())
        add(win, text("Alle nach vorne bringen", "Bring All to Front"), #selector(NSApplication.arrangeInFront(_:)))
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
