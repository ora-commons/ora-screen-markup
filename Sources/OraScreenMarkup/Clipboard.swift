import AppKit
import CoreText

/// The pasteboard: one picture containing the markup and its numbered notes.
enum Clipboard {
    private enum RenderError: LocalizedError {
        case unreadablePicture
        case couldNotRender

        var errorDescription: String? {
            switch self {
            case .unreadablePicture: return "The finished picture could not be decoded."
            case .couldNotRender: return "The complete picture and notes could not be rendered."
            }
        }
    }

    static func write(png: Data, text: String) throws -> Bool {
        let result = try compositePNG(png: png, text: text)
        let item = NSPasteboardItem()
        guard item.setData(result, forType: .png) else { return false }

        // Text representations make some receivers choose notes instead of
        // the image. The notes are already visible in this single PNG.
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        return pasteboard.writeObjects([item])
    }

    /// Keeps the rendered picture at its original pixel size and adds white
    /// paper below it. Text determines the height, never a smaller font.
    static func compositePNG(png: Data, text: String) throws -> Data {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return png }
        guard let bitmap = NSBitmapImageRep(data: png), let image = bitmap.cgImage else {
            throw RenderError.unreadablePicture
        }

        let width = max(image.width, 720)
        let fontSize = max(20, CGFloat(width) / 60)
        let padding = ceil(fontSize * 1.2)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineSpacing = fontSize * 0.2
        let notes = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: fontSize),
            .foregroundColor: NSColor.black,
            .paragraphStyle: paragraph,
        ])
        let framesetter = CTFramesetterCreateWithAttributedString(notes)
        let textWidth = CGFloat(width) - padding * 2
        let measured = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter, CFRange(location: 0, length: 0), nil,
            CGSize(width: textWidth, height: .greatestFiniteMagnitude), nil
        )
        let textHeight = ceil(measured.height) + 1
        let legendHeight = textHeight + padding * 2
        let height = CGFloat(image.height) + legendHeight
        guard height.isFinite, height < CGFloat(Int.max),
              let context = CGContext(
                data: nil, width: width, height: Int(height), bitsPerComponent: 8,
                bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else { throw RenderError.couldNotRender }

        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: height))
        context.interpolationQuality = .none
        context.setBlendMode(.copy)
        context.draw(image, in: CGRect(
            x: CGFloat((width - image.width) / 2), y: legendHeight,
            width: CGFloat(image.width), height: CGFloat(image.height)
        ))
        context.setBlendMode(.normal)
        context.textMatrix = .identity
        let path = CGPath(rect: CGRect(
            x: padding, y: padding, width: textWidth, height: textHeight
        ), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
        guard CTFrameGetVisibleStringRange(frame).length == notes.length else {
            throw RenderError.couldNotRender
        }
        CTFrameDraw(frame, context)
        guard let result = context.makeImage(),
              let data = NSBitmapImageRep(cgImage: result).representation(using: .png, properties: [:]) else {
            throw RenderError.couldNotRender
        }
        return data
    }

    /// The picture on the pasteboard, read without ever writing to its source.
    static func pictureData() -> Data? {
        let pasteboard = NSPasteboard.general
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], let url = urls.first,
           let data = try? Data(contentsOf: url) {
            return data
        }
        guard let image = NSImage(pasteboard: pasteboard) else { return nil }
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }
}
