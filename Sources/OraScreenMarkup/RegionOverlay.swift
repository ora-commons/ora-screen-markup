import AppKit

final class OverlayWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Two corners establish the rectangle; dragging, handles and moving remain
/// available. Return and the mouse button share the same nonempty check.
final class SelectionView: NSView {
    var onConfirm: ((CGRect) -> Void)?
    var onCancel: (() -> Void)?

    private(set) var selection = CGRect.zero
    private var dragOrigin = CGPoint.zero
    private var dragSelection = CGRect.zero
    private var dragHandle = -1
    private var drawingNew = false
    private var awaitingSecondCorner = false
    private var dragged = false
    private var tracking: NSTrackingArea?
    private let handleSize: CGFloat = 8
    private let minimumSize: CGFloat = 24
    private let approve = NSButton(title: "OK ↵", target: nil, action: nil)
    private let hint = NSTextField(labelWithString: "Click two corners or drag • Adjust with handles • Return or OK captures • Escape cancels")

    override var acceptsFirstResponder: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        approve.target = self
        approve.action = #selector(confirmSelection)
        approve.keyEquivalent = "\r"
        approve.keyEquivalentModifierMask = []
        approve.bezelStyle = .rounded
        approve.isHidden = true
        approve.setAccessibilityLabel("OK, capture selected region")
        addSubview(approve)
        hint.textColor = .white
        hint.backgroundColor = NSColor.black.withAlphaComponent(0.8)
        hint.drawsBackground = true
        hint.alignment = .center
        hint.font = .systemFont(ofSize: 13, weight: .medium)
        addSubview(hint)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self)
        tracking = area
        addTrackingArea(area)
    }

    override func layout() {
        super.layout()
        hint.frame = NSRect(x: 12, y: bounds.height - 38, width: max(0, bounds.width - 24), height: 26)
        placeApproval()
    }

    private var nonempty: Bool { !selection.isNull && selection.width > 0 && selection.height > 0 }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(rect: bounds)
        if nonempty { path.appendRect(selection) }
        path.windingRule = .evenOdd
        NSColor.black.withAlphaComponent(0.35).setFill()
        path.fill()
        guard nonempty else { return }
        let blue = NSColor(calibratedRed: 0.22, green: 0.48, blue: 0.96, alpha: 1)
        let border = NSBezierPath(rect: selection)
        border.lineWidth = 2
        blue.setStroke()
        border.stroke()
        if !awaitingSecondCorner {
            for point in handlePoints() {
                let handle = NSBezierPath(rect: NSRect(x: point.x - handleSize / 2, y: point.y - handleSize / 2, width: handleSize, height: handleSize))
                NSColor.white.setFill()
                handle.fill()
                blue.setStroke()
                handle.lineWidth = 1.5
                handle.stroke()
            }
        }
    }

    private func changed() {
        placeApproval()
        needsDisplay = true
    }

    private func placeApproval() {
        approve.isHidden = !nonempty || awaitingSecondCorner
        guard !approve.isHidden else { return }
        let size = CGSize(width: 60, height: 28)
        let gap: CGFloat = 6
        let positions = [
            CGPoint(x: selection.maxX + gap, y: selection.maxY - size.height),
            CGPoint(x: selection.minX - size.width - gap, y: selection.maxY - size.height),
            CGPoint(x: selection.maxX - size.width, y: selection.minY - size.height - gap),
            CGPoint(x: selection.maxX - size.width, y: selection.maxY + gap),
        ]
        if let origin = positions.first(where: { bounds.contains(CGRect(origin: $0, size: size)) }) {
            approve.frame = CGRect(origin: origin, size: size)
        } else {
            // A rectangle filling the display leaves no exterior screen
            // pixels; keep the approval reachable on its outer border.
            approve.frame = CGRect(x: max(0, bounds.maxX - size.width - gap), y: max(0, bounds.minY + gap), width: size.width, height: size.height)
        }
    }

    private func handlePoints() -> [CGPoint] {
        let rect = selection
        return [
            CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.midX, y: rect.minY),
            CGPoint(x: rect.maxX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.midY),
            CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.midX, y: rect.maxY),
            CGPoint(x: rect.minX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.midY),
        ]
    }

    private func cornerRect(to point: CGPoint) -> CGRect {
        CGRect(x: min(dragOrigin.x, point.x), y: min(dragOrigin.y, point.y), width: abs(point.x - dragOrigin.x), height: abs(point.y - dragOrigin.y)).intersection(bounds)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if awaitingSecondCorner {
            selection = cornerRect(to: point)
            awaitingSecondCorner = false
            drawingNew = false
            dragOrigin = point
            dragSelection = selection
            dragHandle = -1
            changed()
            return
        }
        dragOrigin = point
        dragSelection = selection
        dragHandle = -1
        dragged = false
        drawingNew = false
        if nonempty {
            for (index, handle) in handlePoints().enumerated() where hypot(handle.x - point.x, handle.y - point.y) <= handleSize {
                dragHandle = index
                break
            }
        }
        if dragHandle < 0 && (!nonempty || !selection.contains(point)) {
            drawingNew = true
            awaitingSecondCorner = true
            selection = CGRect(origin: point, size: .zero)
            changed()
        }
    }

    override func mouseMoved(with event: NSEvent) {
        if awaitingSecondCorner {
            selection = cornerRect(to: convert(event.locationInWindow, from: nil))
            changed()
        }
    }

    override func mouseDragged(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        let delta = CGPoint(x: point.x - dragOrigin.x, y: point.y - dragOrigin.y)
        dragged = true
        if drawingNew {
            selection = cornerRect(to: point)
        } else if dragHandle < 0 {
            var moved = dragSelection.offsetBy(dx: delta.x, dy: delta.y)
            moved.origin.x = min(max(moved.origin.x, 0), bounds.width - moved.width)
            moved.origin.y = min(max(moved.origin.y, 0), bounds.height - moved.height)
            selection = moved
        } else {
            var rect = dragSelection
            let minWidth = min(minimumSize, dragSelection.width)
            let minHeight = min(minimumSize, dragSelection.height)
            if [0, 6, 7].contains(dragHandle) {
                rect.origin.x = min(dragSelection.maxX - minWidth, dragSelection.origin.x + delta.x)
                rect.size.width = dragSelection.maxX - rect.origin.x
            }
            if [2, 3, 4].contains(dragHandle) { rect.size.width = max(minWidth, dragSelection.width + delta.x) }
            if [0, 1, 2].contains(dragHandle) {
                rect.origin.y = min(dragSelection.maxY - minHeight, dragSelection.origin.y + delta.y)
                rect.size.height = dragSelection.maxY - rect.origin.y
            }
            if [4, 5, 6].contains(dragHandle) { rect.size.height = max(minHeight, dragSelection.height + delta.y) }
            selection = rect.intersection(bounds)
        }
        changed()
    }

    override func mouseUp(with event: NSEvent) {
        if drawingNew && dragged { awaitingSecondCorner = false }
        drawingNew = false
        changed()
    }

    @objc private func confirmSelection() {
        guard nonempty else { return }
        onConfirm?(selection)
    }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 36, 76: confirmSelection()
        case 53: onCancel?()
        default: super.keyDown(with: event)
        }
    }
}

final class RegionOverlay {
    private var window: OverlayWindow?

    func present(onConfirm: @escaping (CGRect) -> Void, onCancel: @escaping () -> Void) {
        dismiss()
        let pointer = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? NSScreen.main ?? NSScreen.screens.first
        guard let screen else { onCancel(); return }
        let frame = screen.frame
        let overlay = OverlayWindow(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        overlay.isReleasedWhenClosed = false
        overlay.level = .screenSaver
        overlay.backgroundColor = .clear
        overlay.isOpaque = false
        overlay.hasShadow = false
        overlay.hidesOnDeactivate = false
        overlay.ignoresMouseEvents = false
        overlay.acceptsMouseMovedEvents = true
        let selection = SelectionView(frame: NSRect(origin: .zero, size: frame.size))
        selection.autoresizingMask = [.width, .height]
        selection.onConfirm = { [weak self] rect in
            let global = rect.offsetBy(dx: frame.origin.x, dy: frame.origin.y)
            self?.dismiss()
            onConfirm(global)
        }
        selection.onCancel = { [weak self] in self?.dismiss(); onCancel() }
        overlay.contentView = selection
        window = overlay
        overlay.makeKeyAndOrderFront(nil)
        overlay.makeFirstResponder(selection)
    }

    func dismiss() {
        window?.orderOut(nil)
        window = nil
    }
}
