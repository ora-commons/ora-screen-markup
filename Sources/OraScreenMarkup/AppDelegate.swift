import AppKit
import Carbon.HIToolbox
import WebKit
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler {
    private var window: NSWindow?
    private var webView: WKWebView?
    private let overlay = RegionOverlay()
    private var capturing = false
    private var replacing = false
    private var saving = false
    private var terminationPending = false
    // The one-shot return mode a caller (Vibe Coder) starts with
    // `--return-folder <folder>`: capture, mark up, send back, close.
    private let returnFolder: URL?
    // The plain destination name a caller adds with `--return-to <name>`
    // (Ora passes "Ora"); nil keeps the Send button and its message on
    // Vibe Coder.
    private let returnTo: String?
    private var returned = false

    override init() {
        let arguments = CommandLine.arguments
        var folder: URL?
        if let flag = arguments.firstIndex(of: "--return-folder"),
           flag + 1 < arguments.count {
            folder = URL(fileURLWithPath: arguments[flag + 1], isDirectory: true)
        }
        returnFolder = folder
        var name: String?
        if let flag = arguments.firstIndex(of: "--return-to"),
           flag + 1 < arguments.count {
            name = Self.plainLabel(arguments[flag + 1])
        }
        returnTo = name
        super.init()
    }

    /// `--return-to` is plain label text: control and format characters drop
    /// out, whitespace collapses to single spaces, and an empty result counts
    /// as no name at all.
    private static func plainLabel(_ raw: String) -> String? {
        var scalars = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars {
            let category = scalar.properties.generalCategory
            if category != .control && category != .format {
                scalars.append(scalar)
            }
        }
        let collapsed = String(scalars).split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return collapsed.isEmpty ? nil : collapsed
    }

    // MARK: - Application

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        // Return mode runs as another instance beside any standalone copy:
        // its exclusive global capture shortcuts would collide with that
        // copy's and only warn mid-capture, so it leaves them to standalone.
        if returnFolder == nil {
            registerHotKeys()
        }
        showWindow()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Return mode is one-shot: the result leaves through Send, and every
        // other exit writes `cancelled`. No unsaved-drawing guard stands in
        // the way of closing the window the caller opened.
        if returnFolder != nil { return .terminateNow }
        guard !terminationPending else { return .terminateCancel }
        guard !capturing && !saving else { return .terminateCancel }
        terminationPending = true
        showWindow()
        callBridge("canQuit") { [weak self] result in
            self?.terminationPending = false
            if case .success(let value) = result, let allowed = value as? Bool {
                sender.reply(toApplicationShouldTerminate: allowed)
            } else {
                sender.reply(toApplicationShouldTerminate: false)
            }
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        HotKeyCenter.shared.unregisterAll()
        if let folder = returnFolder, !returned {
            // Closing without sending tells the caller nobody is coming back.
            try? Data("cancelled\n".utf8).write(to: folder.appendingPathComponent("cancelled"), options: .atomic)
        }
    }

    // MARK: - Menu

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About Ora Screen Markup",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Hide Ora Screen Markup",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthers = appMenu.addItem(
            withTitle: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(
            withTitle: "Show All",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit Ora Screen Markup",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(
            withTitle: "Capture Region  ⌃⇧R",
            action: #selector(captureRegion),
            keyEquivalent: ""
        )
        fileMenu.addItem(
            withTitle: "Capture Window  ⌃⇧W",
            action: #selector(captureWindow),
            keyEquivalent: ""
        )
        fileMenu.addItem(
            withTitle: "Capture Screen  ⌃⇧S",
            action: #selector(captureScreen),
            keyEquivalent: ""
        )
        fileMenu.addItem(.separator())
        fileMenu.addItem(
            withTitle: "Insert Image…",
            action: #selector(insertImageFile),
            keyEquivalent: ""
        )
        fileMenu.addItem(
            withTitle: "Paste Picture",
            action: #selector(pastePicture),
            keyEquivalent: ""
        )
        fileMenu.addItem(
            withTitle: "Copy Result",
            action: #selector(copyMarkedUp),
            keyEquivalent: ""
        )
        fileMenu.addItem(
            withTitle: "Export PDF",
            action: #selector(exportPDF),
            keyEquivalent: "e"
        )
        fileMenu.addItem(withTitle: "Save Editable…", action: #selector(saveEditable), keyEquivalent: "s")
        let saveAs = fileMenu.addItem(withTitle: "Save Editable As…", action: #selector(saveEditable), keyEquivalent: "s")
        saveAs.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Open Editable…", action: #selector(openEditable), keyEquivalent: "o")
        fileMenu.addItem(.separator())
        fileMenu.addItem(
            withTitle: "Close",
            action: #selector(closeWindow),
            keyEquivalent: "w"
        )
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: #selector(undoEditingOrCanvas), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: #selector(redoEditingOrCanvas), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(copySelectionOrResult), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }

    private func registerHotKeys() {
        let center = HotKeyCenter.shared
        let region = center.register(
            keyCode: UInt32(kVK_ANSI_R),
            modifiers: UInt32(controlKey | shiftKey)
        ) { [weak self] in
            self?.captureRegion()
        }
        let window = center.register(
            keyCode: UInt32(kVK_ANSI_W),
            modifiers: UInt32(controlKey | shiftKey)
        ) { [weak self] in
            self?.captureWindow()
        }
        let screen = center.register(
            keyCode: UInt32(kVK_ANSI_S),
            modifiers: UInt32(controlKey | shiftKey)
        ) { [weak self] in
            self?.captureScreen()
        }
        let unavailable = [
            (region, "Control-Shift-R (Region)"),
            (window, "Control-Shift-W (Window)"),
            (screen, "Control-Shift-S (Screen)")
        ].filter { !$0.0 }.map { $0.1 }
        if !unavailable.isEmpty {
            report(
                "These global capture shortcuts are already taken by another application: "
                    + unavailable.joined(separator: ", ") + ". "
                    + "Use the capture buttons or File menu instead."
            )
        }
    }

    // MARK: - Window

    private func showWindow() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1320, height: 880),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        // Keep desktop style controls available beside the reserved left area.
        window.contentMinSize = NSSize(width: 900, height: 720)
        window.isReleasedWhenClosed = false
        window.title = "Ora Screen Markup"
        window.appearance = NSAppearance(named: .darkAqua)
        window.titlebarAppearsTransparent = true
        // Use the same bundled palette as the editor, including its title bar.
        if let palette = Bundle.main.url(forResource: "dark", withExtension: "css"),
           let css = try? String(contentsOf: palette, encoding: .utf8),
           let line = css.components(separatedBy: .newlines).first(where: {
               $0.trimmingCharacters(in: .whitespaces).hasPrefix("--background-primary:")
           }),
           let hex = line.split(separator: "#").last?.prefix(6),
           let rgb = UInt32(hex, radix: 16) {
            window.backgroundColor = NSColor(
                srgbRed: CGFloat((rgb >> 16) & 0xff) / 255,
                green: CGFloat((rgb >> 8) & 0xff) / 255,
                blue: CGFloat(rgb & 0xff) / 255,
                alpha: 1
            )
        }
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "ora")
        if returnFolder != nil {
            // Document start, so the page sees the flags before its own
            // scripts run and can show the Send button under the caller's
            // name. JSON encoding keeps the name a plain string literal.
            var flags = "window.oraReturnFolder = true;"
            if let name = returnTo, let encoded = try? JSONEncoder().encode(name),
               let literal = String(data: encoded, encoding: .utf8) {
                flags += " window.oraReturnTo = \(literal);"
            }
            configuration.userContentController.addUserScript(
                WKUserScript(source: flags, injectionTime: .atDocumentStart,
                             forMainFrameOnly: true))
        }
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.underPageBackgroundColor = window.backgroundColor
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView

        window.delegate = self
        self.window = window
        self.webView = webView

        if let resources = Bundle.main.resourceURL {
            webView.loadFileURL(
                resources.appendingPathComponent("index.html"),
                allowingReadAccessTo: resources
            )
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func closeWindow() {
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        // Return mode's one shot ends on a real close of its window, never on
        // the order-out a capture overlay uses; Send has written by then, so
        // `returned` keeps the cancel marker away.
        if returnFolder != nil {
            NSApp.terminate(self)
        }
    }

    // MARK: - Editor bridge

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "captureRegion":
            startRegionCapture(append: (body["append"] as? Bool) ?? false)
        case "captureWindow":
            startWindowCapture(append: (body["append"] as? Bool) ?? false)
        case "captureScreen":
            startScreenCapture(append: (body["append"] as? Bool) ?? false)
        case "replacementBusy":
            replacing = body["busy"] as? Bool ?? false
        case "save":
            guard let id = body["id"] as? String,
                  let contents = body["contents"] as? String else { return }
            writeEditable(contents: contents, id: id)
        case "open":
            openEditable()
        case "insertImage":
            insertImageFile()
        case "copy", "export", "send":
            guard let id = body["id"] as? String else { return }
            guard let png = body["png"] as? String,
                  let text = body["text"] as? String,
                  let data = Data(base64Encoded: png) else {
                hostResult(id: id, error: "The finished picture could not be decoded.")
                return
            }
            if type == "copy" {
                do {
                    if try Clipboard.write(png: data, text: text) {
                        hostResult(id: id, message: "Copied the picture and numbered notes as one image.")
                    } else {
                        hostResult(id: id, error: "The clipboard could not accept the image. Try Copy result again.")
                    }
                } catch {
                    hostResult(id: id, error: "The result could not be copied: \(error.localizedDescription)")
                }
            } else if type == "send" {
                guard let folder = returnFolder else {
                    hostResult(id: id, error: "The tool was not started with a return folder.")
                    return
                }
                do {
                    try data.write(to: folder.appendingPathComponent("picture.png"), options: .atomic)
                    try Data(text.utf8).write(to: folder.appendingPathComponent("notes.txt"), options: .atomic)
                    returned = true
                    hostResult(id: id, message: "Sent to \(returnTo ?? "Vibe Coder").")
                    window?.close()
                } catch {
                    // Nothing was delivered; keep the picture within reach and
                    // leave the host's next capture as the way back in.
                    hostResult(
                        id: id,
                        error: "The result could not be sent: \(error.localizedDescription). "
                            + "Use Copy result to keep the picture, then press Capture again.")
                }
            } else {
                do {
                    let placed = try writePDF(png: data, notes: text)
                    hostResult(id: id, message: "PDF exported to \(placed.path).")
                } catch {
                    hostResult(id: id, error: "The PDF could not be written: \(error.localizedDescription)")
                }
            }
        default:
            break
        }
    }

    private func callBridge(
        _ name: String, argument: Any? = nil,
        completion: ((Result<Any, Error>) -> Void)? = nil
    ) {
        guard let webView else {
            completion?(.failure(CocoaError(.coderInvalidValue)))
            return
        }
        let body: String
        let arguments: [String: Any]
        if let argument {
            body = "return window.oraBridge.\(name)(argument)"
            arguments = ["argument": argument]
        } else {
            body = "return window.oraBridge.\(name)()"
            arguments = [:]
        }
        webView.callAsyncJavaScript(
            body,
            arguments: arguments,
            in: nil,
            in: .page
        ) { [weak self] result in
            if case .failure(let error) = result {
                self?.report("The editor could not answer: \(error.localizedDescription)")
            }
            completion?(result)
        }
    }

    private func hostResult(id: String, message: String? = nil, error: String? = nil, cancelled: Bool = false) {
        var result: [String: Any] = ["id": id, "cancelled": cancelled]
        if let message { result["message"] = message }
        if let error { result["error"] = error }
        callBridge("hostResult", argument: result)
    }

    // MARK: - Menu actions

    @objc private func copyMarkedUp() {
        callBridge("copy")
    }

    private func editingAction(_ selector: Selector, canvasAction: String) {
        callBridge("isTextEditing") { [weak self] result in
            if case .success(let value) = result, value as? Bool == true {
                NSApp.sendAction(selector, to: nil, from: self)
            } else {
                self?.callBridge(canvasAction)
            }
        }
    }

    @objc private func copySelectionOrResult() {
        // ORA-347 — selected objects copy natively (a copied picture stays
        // an editable picture); only the empty canvas copies the whole
        // flattened result.
        callBridge("isTextEditing") { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, value as? Bool == true {
                NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: self)
                return
            }
            self.callBridge("hasSelection") { [weak self] result in
                guard let self else { return }
                if case .success(let value) = result, value as? Bool == true {
                    NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: self)
                } else {
                    self.callBridge("copy")
                }
            }
        }
    }

    @objc private func undoEditingOrCanvas() {
        editingAction(Selector(("undo:")), canvasAction: "undo")
    }

    @objc private func redoEditingOrCanvas() {
        editingAction(Selector(("redo:")), canvasAction: "redo")
    }

    @objc private func saveEditable() {
        callBridge("saveEditable")
    }

    @objc private func openEditable() {
        guard !capturing && !replacing && !saving else { return }
        capturing = true
        let panel = NSOpenPanel()
        panel.title = "Open Editable Drawing"
        panel.allowedContentTypes = [UTType(filenameExtension: "excalidraw") ?? .data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else { self.endCapture(); return }
            do {
                let contents = try String(contentsOf: url, encoding: .utf8)
                self.callBridge("openEditable", argument: contents) { _ in self.endCapture() }
            } catch {
                self.endCapture()
                self.report("That editable file could not be opened: \(error.localizedDescription)")
            }
        }
    }

    private func writeEditable(contents: String, id: String) {
        guard !saving else { hostResult(id: id, error: "Finish the current save first."); return }
        saving = true
        let panel = NSSavePanel()
        panel.title = "Save Editable Drawing"
        panel.nameFieldStringValue = "Screen Markup"
        panel.allowedContentTypes = [UTType(filenameExtension: "excalidraw") ?? .data]
        panel.canCreateDirectories = true
        panel.begin { [weak self] response in
            guard let self else { return }
            defer { self.saving = false }
            guard response == .OK, let url = panel.url else {
                self.hostResult(id: id, cancelled: true)
                return
            }
            do {
                try Data(contents.utf8).write(to: url, options: .atomic)
                self.hostResult(id: id, message: "Editable drawing saved to \(url.path).")
            } catch {
                self.hostResult(id: id, error: "The editable drawing could not be saved: \(error.localizedDescription)")
            }
        }
    }

    @objc private func pastePicture() {
        guard !capturing && !replacing && !saving else { return }
        guard let data = Clipboard.pictureData() else {
            report("There is no picture on the clipboard to bring in.")
            return
        }
        capturing = true
        // ORA-347 — a pasted picture adds to the drawing instead of
        // replacing it.
        importPicture(data: data, append: true) { [weak self] in self?.endCapture() }
    }

    /// ORA-347 — Insert image: an image-file chooser routed through the
    /// existing append helper, so the chosen picture adds to the drawing
    /// without resetting the scene, numbering, notes or saved baseline. A
    /// cancelled or unreadable file leaves the drawing as it was.
    @objc private func insertImageFile() {
        guard !capturing && !replacing && !saving else { return }
        capturing = true
        let panel = NSOpenPanel()
        panel.title = "Insert Image"
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else { self.endCapture(); return }
            do {
                let data = try Data(contentsOf: url)
                self.importPicture(data: data, append: true) { self.endCapture() }
            } catch {
                self.endCapture()
                self.report("That picture could not be read: \(error.localizedDescription)")
            }
        }
    }

    @objc private func exportPDF() {
        callBridge("exportPdf")
    }

    // MARK: - Capture

    // Explicit Add commands always keep the drawing. Other captures use
    // the remembered Discard setting. The resolved intent travels with the
    // whole invocation, retaining the scene, numbers and notes when adding.
    @objc private func captureRegion() {
        startRegionCapture(append: false)
    }

    private func startRegionCapture(append: Bool) {
        beginCapture(append: append) { [weak self] append in
            guard let self else { return }
            self.hideMarkupWindow()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self.overlay.present(
                    onConfirm: { rect in
                        self.captureRegionNow(rect, append: append)
                    },
                    onCancel: {
                        self.endCapture()
                        self.showWindow()
                    }
                )
            }
        }
    }

    private func captureRegionNow(_ rect: NSRect, append: Bool) {
        let quartz = ScreenCapture.quartzRect(fromAppKit: rect).integral
        let argument = "\(Int(quartz.origin.x)),\(Int(quartz.origin.y)),"
            + "\(Int(quartz.width)),\(Int(quartz.height))"
        runCapture(arguments: ["-x", "-R\(argument)"], append: append)
    }

    @objc private func captureWindow() {
        startWindowCapture(append: false)
    }

    private func startWindowCapture(append: Bool) {
        beginCapture(append: append) { [weak self] append in self?.chooseCaptureWindow(append: append) }
    }

    private func chooseCaptureWindow(append: Bool) {
        let windows = ScreenCapture.availableWindows()
        guard !windows.isEmpty else {
            endCapture()
            report("There are no other on-screen application windows to capture.")
            return
        }
        let chooser = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 420, height: 26), pullsDown: false)
        chooser.autoenablesItems = false
        for window in windows {
            chooser.menu?.addItem(NSMenuItem(title: window.title, action: nil, keyEquivalent: ""))
        }
        chooser.selectItem(at: 0)
        let alert = NSAlert()
        alert.messageText = "Capture a Window"
        alert.informativeText = "Choose the application and window you want to capture."
        alert.accessoryView = chooser
        alert.addButton(withTitle: "Capture")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn,
              windows.indices.contains(chooser.indexOfSelectedItem) else {
            endCapture()
            return
        }
        let id = windows[chooser.indexOfSelectedItem].id
        hideMarkupWindow()
        runCapture(arguments: ["-x", "-l\(id)"], append: append)
    }

    @objc private func captureScreen() {
        startScreenCapture(append: false)
    }

    private func startScreenCapture(append: Bool) {
        beginCapture(append: append) { [weak self] append in
            guard let self else { return }
            self.hideMarkupWindow()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self.runCapture(arguments: ["-x", "-m"], append: append)
            }
        }
    }

    private func beginCapture(append: Bool = false, _ capture: @escaping (Bool) -> Void) {
        guard !capturing && !replacing && !saving else { return }
        capturing = true
        // The editor resolves the remembered Discard setting for toolbar,
        // menu and shortcut captures alike. Missing intent never replaces.
        callBridge("prepareCapture", argument: append) { [weak self] result in
            guard let self else { return }
            guard case .success(let value) = result,
                  let intent = value as? [String: Any],
                  let adding = intent["append"] as? Bool else {
                self.endCapture()
                return
            }
            if !ScreenCapture.hasPermission() {
                _ = ScreenCapture.requestPermission()
                if !ScreenCapture.hasPermission() {
                    self.endCapture()
                    self.showScreenRecordingHelp()
                    return
                }
            }
            capture(adding)
        }
    }

    private func endCapture() {
        capturing = false
        callBridge("captureEnded")
    }

    private func showScreenRecordingHelp() {
        let alert = NSAlert()
        alert.messageText = "macOS has not allowed this copy to record the screen."
        alert.informativeText =
            "Enable Ora Screen Markup in Screen Recording in System Settings. "
            + "If its switch is already on, remove that entry and add "
            + "/Applications/Ora Screen Markup.app again. Enable it, then quit "
            + "and reopen the app."
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn,
           let settings = URL(
               string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
           ) {
            NSWorkspace.shared.open(settings)
        }
    }

    private func hideMarkupWindow() {
        window?.orderOut(nil)
    }

    private func runCapture(arguments: [String], append: Bool = false) {
        let url = ScreenCapture.temporaryDirectory()
            .appendingPathComponent("capture-\(UUID().uuidString).png")
        // Give the window system time to take the overlay and the markup
        // window off the screen before the picture is taken.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self else { return }
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                let file = try ScreenCapture.capture(arguments: arguments, to: url)
                let data = try Data(contentsOf: file)
                self.showWindow()
                // Use the intent resolved before the picker: unchecked
                // Discard and explicit Add commands retain the current scene.
                self.importPicture(data: data, append: append) { self.endCapture() }
            } catch {
                self.endCapture()
                self.showWindow()
                if case CaptureError.permissionDenied = error {
                    self.showScreenRecordingHelp()
                } else {
                    self.report("The capture did not finish: \(error.localizedDescription)")
                }
            }
        }
    }

    /// The editor takes PNG and JPEG pictures. Anything else the host can
    /// read (TIFF, GIF, HEIC, …) is normalized to PNG before the bridge.
    private func normalizedPicture(_ data: Data) -> Data? {
        let bytes = [UInt8](data.prefix(4))
        if bytes.count >= 4, bytes[0] == 0x89, bytes[1] == 0x50 { return data }
        if bytes.count >= 2, bytes[0] == 0xFF, bytes[1] == 0xD8 { return data }
        if let rep = NSBitmapImageRep(data: data) {
            return rep.representation(using: .png, properties: [:])
        }
        guard let image = NSImage(data: data),
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }

    private func importPicture(data: Data, append: Bool = false, completion: @escaping () -> Void) {
        guard let data = normalizedPicture(data) else {
            report("That picture could not be read. Copy or drop a picture in PNG or JPEG, then try again.")
            completion()
            return
        }
        let isJPEG = data.count > 2 && data[data.startIndex] == 0xFF && data[data.startIndex + 1] == 0xD8
        let mime = isJPEG ? "image/jpeg" : "image/png"
        let dataURL = "data:\(mime);base64,\(data.base64EncodedString())"
        callBridge(append ? "appendCapture" : "importCapture", argument: dataURL) { _ in completion() }
    }

    // MARK: - Export

    private func writePDF(png: Data, notes: String) throws -> URL {
        let temporary = ScreenCapture.temporaryDirectory()
            .appendingPathComponent("export-\(UUID().uuidString).pdf")
        do {
            try PDFExport.write(png: png, notes: notes, to: temporary)
            let placed = try PDFExport.place(temporary)
            NSWorkspace.shared.activateFileViewerSelecting([placed])
            return placed
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    // MARK: - Messages

    private func report(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            let alert = NSAlert()
            alert.messageText = "Ora Screen Markup"
            alert.informativeText = message
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")
            if let window = self?.window, window.isVisible {
                alert.beginSheetModal(for: window, completionHandler: nil)
            } else {
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            }
        }
    }
}
