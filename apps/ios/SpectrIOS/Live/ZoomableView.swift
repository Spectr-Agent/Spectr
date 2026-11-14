import SwiftUI

/// Pinch to zoom (it stays), drag to pan while zoomed, double-tap to zoom into a spot or
/// back out. Panning is clamped so the picture never slides off screen.
struct ZoomableView<Content: View>: View {
    static var maxScale: CGFloat { 5 }
    static var doubleTapScale: CGFloat { 2.5 }

    @Binding var scale: CGFloat
    var onSingleTap: () -> Void = {}
    @ViewBuilder var content: Content

    @State private var offset: CGSize = .zero
    @State private var pinchStart: CGFloat?
    @State private var dragStart: CGSize?

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            content
                .frame(width: size.width, height: size.height)
                .scaleEffect(scale)
                .offset(offset)
                .frame(width: size.width, height: size.height)
                .clipped()
                .contentShape(.rect)
                .gesture(magnify(in: size).simultaneously(with: pan(in: size)))
                .onTapGesture(count: 2) { location in
                    withAnimation(.snappy) { toggleZoom(at: location, in: size) }
                }
                .onTapGesture(count: 1, perform: onSingleTap)
                .onChange(of: scale) { _, new in
                    guard pinchStart == nil else { return }
                    withAnimation(.snappy) {
                        offset = new <= 1.01 ? .zero : clamped(offset, scale: new, in: size)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Your Mac's screen")
                .accessibilityHint("Double-tap to zoom in or out.")
                .accessibilityAction(named: "Zoom in") { withAnimation { scale = min(Self.maxScale, scale * 1.5) } }
                .accessibilityAction(named: "Zoom out") { withAnimation { scale = max(1, scale / 1.5) } }
        }
    }

    private func magnify(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = pinchStart ?? scale
                pinchStart = start
                // Allow a little rubber-band below 1x while pinching.
                scale = min(Self.maxScale, max(0.8, start * value.magnification))
                offset = clamped(offset, scale: scale, in: size)
            }
            .onEnded { _ in
                pinchStart = nil
                withAnimation(.snappy) {
                    scale = min(Self.maxScale, max(1, scale))
                    offset = clamped(offset, scale: scale, in: size)
                }
            }
    }

    private func pan(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: scale > 1 ? 4 : 10_000)
            .onChanged { value in
                let start = dragStart ?? offset
                dragStart = start
                offset = clamped(
                    CGSize(
                        width: start.width + value.translation.width, height: start.height + value.translation.height),
                    scale: scale, in: size)
            }
            .onEnded { _ in dragStart = nil }
    }

    private func toggleZoom(at point: CGPoint, in size: CGSize) {
        if scale > 1.05 {
            scale = 1
            offset = .zero
        } else {
            scale = Self.doubleTapScale
            // Keep the tapped spot under the finger.
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let target = CGSize(
                width: (center.x - point.x) * (scale - 1),
                height: (center.y - point.y) * (scale - 1))
            offset = clamped(target, scale: scale, in: size)
        }
    }

    private func clamped(_ proposed: CGSize, scale: CGFloat, in size: CGSize) -> CGSize {
        let maxX = max(0, (size.width * scale - size.width) / 2)
        let maxY = max(0, (size.height * scale - size.height) / 2)
        return CGSize(
            width: min(maxX, max(-maxX, proposed.width)),
            height: min(maxY, max(-maxY, proposed.height)))
    }
}
