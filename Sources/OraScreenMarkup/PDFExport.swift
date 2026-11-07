import AppKit
import CoreGraphics
import CoreText

enum PDFExportError: Error {
    case unreadablePicture
    case couldNotWrite
}

/// Writes one PDF holding the marked up picture and every numbered note as
/// selectable text.
enum PDFExport {
    private static let notesPage = CGRect(x: 0, y: 0, width: 612, height: 792)

    /// The page size for one page of the document.
    private static func pageInfo(_ box: CGRect) -> [CFString: Any] {
        var rect = box
        let data = Data(bytes: &rect, count: MemoryLayout<CGRect>.size)
        return [kCGPDFContextMediaBox: data]
    }

    static func write(png: Data, notes: String, to url: URL) throws {
        guard let bitmap = NSBitmapImageRep(data: png), let image = bitmap.cgImage else {
            throw PDFExportError.unreadablePicture
        }
        let page = CGRect(
            x: 0,
            y: 0,
            width: CGFloat(image.width),
            height: CGFloat(image.height)
        )
        var mediaBox = page
        guard let context = CGContext(url as CFURL, mediaBox: &mediaBox, nil) else {
            throw PDFExportError.couldNotWrite
        }

        context.beginPDFPage(pageInfo(page) as CFDictionary)
        context.draw(image, in: page)
        context.endPDFPage()

        let attributed = NSAttributedString(
            string: notes,
            attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NSColor.black,
            ]
        )
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let textRect = notesPage.insetBy(dx: 54, dy: 54)
        let path = CGPath(rect: textRect, transform: nil)
        var location = 0
        while location < attributed.length {
            context.beginPDFPage(pageInfo(notesPage) as CFDictionary)
            let frame = CTFramesetterCreateFrame(
                framesetter,
                CFRange(location: location, length: 0),
                path,
                nil
            )
            CTFrameDraw(frame, context)
            let visible = CTFrameGetVisibleStringRange(frame)
            context.endPDFPage()
            if visible.length <= 0 {
                break
            }
            location += visible.length
        }
        context.closePDF()
    }

    /// Moves the finished PDF to the set folder under a name nothing else
    /// uses, so an existing file is never replaced.
    static func place(_ temporary: URL) throws -> URL {
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Pictures", isDirectory: true)
            .appendingPathComponent("Ora Screen Markup", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let stamp = formatter.string(from: Date())
        var candidate = folder.appendingPathComponent("Ora Screen Markup \(stamp).pdf")
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent("Ora Screen Markup \(stamp) \(counter).pdf")
            counter += 1
        }
        try FileManager.default.moveItem(at: temporary, to: candidate)
        return candidate
    }
}
