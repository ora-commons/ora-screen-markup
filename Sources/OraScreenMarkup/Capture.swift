import AppKit
import CoreGraphics

enum CaptureError: Error {
    case permissionDenied
    case processFailed(status: Int32, message: String)
    case emptyResult
}

/// Screen capture helpers: permission, the window list, and the call to
/// macOS's own capture tool.
enum ScreenCapture {
    static let tool = "/usr/sbin/screencapture"

    static func hasPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    @discardableResult
    static func requestPermission() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    /// Ordinary on-screen windows, with explicit labels for the capture chooser.
    static func availableWindows() -> [(id: CGWindowID, title: String)] {
        guard let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return []
        }
        return windows.compactMap { window in
            guard let pid = window[kCGWindowOwnerPID as String] as? pid_t,
                  pid != ProcessInfo.processInfo.processIdentifier,
                  let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
                  let id = window[kCGWindowNumber as String] as? CGWindowID,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  !rect.isEmpty else { return nil }
            let owner = (window[kCGWindowOwnerName as String] as? String)
                ?? NSRunningApplication(processIdentifier: pid)?.localizedName
                ?? "Application \(pid)"
            let name = (window[kCGWindowName as String] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let title = name.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled window"
            return (id: id, title: "\(owner) — \(title)")
        }
    }

    /// Quartz display coordinates (origin at the top left of the main display)
    /// from an AppKit rectangle (origin at the bottom left of the main display).
    static func quartzRect(fromAppKit rect: NSRect) -> CGRect {
        guard let primary = NSScreen.screens.first else { return rect }
        let primaryHeight = primary.frame.height
        return CGRect(
            x: rect.origin.x,
            y: primaryHeight - (rect.origin.y + rect.height),
            width: rect.width,
            height: rect.height
        )
    }

    /// AppKit screen coordinates from Quartz display coordinates.
    static func appKitRect(fromQuartz rect: CGRect) -> NSRect {
        guard let primary = NSScreen.screens.first else { return rect }
        let primaryHeight = primary.frame.height
        return NSRect(
            x: rect.origin.x,
            y: primaryHeight - (rect.origin.y + rect.height),
            width: rect.width,
            height: rect.height
        )
    }

    /// The display that holds the given AppKit rectangle.
    static func screen(containing rect: NSRect?) -> NSScreen? {
        guard let rect else { return NSScreen.main ?? NSScreen.screens.first }
        let centre = NSPoint(x: rect.midX, y: rect.midY)
        for screen in NSScreen.screens where screen.frame.contains(centre) {
            return screen
        }
        return NSScreen.main ?? NSScreen.screens.first
    }

    /// Runs macOS's capture tool and returns the file it wrote.
    static func capture(arguments: [String], to url: URL) throws -> URL {
        try? FileManager.default.removeItem(at: url)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = arguments + [url.path]
        let pipe = Pipe()
        process.standardError = pipe
        process.standardOutput = pipe
        do {
            try process.run()
        } catch {
            throw CaptureError.processFailed(status: -1, message: error.localizedDescription)
        }
        let errorData = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(data: errorData, encoding: .utf8) ?? "unknown error"
            throw CaptureError.processFailed(status: process.terminationStatus, message: message)
        }
        guard
            FileManager.default.fileExists(atPath: url.path),
            let data = try? Data(contentsOf: url),
            !data.isEmpty
        else {
            throw CaptureError.emptyResult
        }
        return url
    }

    /// A folder for this operation's temporary files.
    static func temporaryDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("OraScreenMarkup", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
