import CoreImage
import Foundation
import ImageIO
import Observation
@preconcurrency import ScreenCaptureKit
import SpectrKit

/// Captures exactly what the user picks in the system sharing picker (one window or,
/// if they choose, one display) and keeps a low-rate preview for the menu.
///
/// Publishing to LiveKit attaches to `FrameSink` in Phase 3; capture never widens scope
/// on its own. If the picked window closes, sharing stops and says so.
@MainActor
@Observable
final class CaptureController: NSObject {
    enum Status: Equatable {
        case idle
        case choosing
        case starting
        case sharing
        case stopped(StopReason)
    }

    enum StopReason: Equatable {
        case userStopped
        case windowGone
        case permissionDenied
        case failed(String)
    }

    private(set) var status: Status = .idle {
        didSet { if status != oldValue { onStatusChange?(status) } }
    }
    /// Called after every status change.
    var onStatusChange: ((Status) -> Void)?
    /// Frames for the LiveKit publisher; nothing is sent until it sets a target.
    let frameSink = FrameSink()
    /// The picked source. Kept after the window closes so the UI can name what was lost.
    private(set) var source: ShareSource?
    private(set) var preview: CGImage?
    private(set) var health = StreamHealth()

    private var stream: SCStream?
    private var output: FrameOutput?
    private var watchTask: Task<Void, Never>?
    private var windowID: CGWindowID?
    /// What the user authorized. Agent screenshots use exactly this filter.
    private var filter: SCContentFilter?
    /// Increments per session so callbacks from an old stream are ignored.
    private var generation = 0

    var isSharing: Bool { status == .sharing || status == .starting }

    // MARK: User intents

    func chooseSource() {
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleWindow, .singleDisplay]
        if let ownBundle = Bundle.main.bundleIdentifier {
            configuration.excludedBundleIDs = [ownBundle]
        }
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        status = .choosing
        picker.present()
    }

    func stopSharing() {
        tearDown(reason: .userStopped)
    }

    // MARK: Stream lifecycle

    private func start(with filter: SCContentFilter) {
        tearDownStream()
        generation += 1
        let session = generation
        status = .starting
        windowID = filter.includedWindows.first?.windowID
        self.filter = filter
        source = describe(filter)

        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = max(2, Int(filter.contentRect.width * scale))
        configuration.height = max(2, Int(filter.contentRect.height * scale))
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = true
        configuration.queueDepth = 5

        let output = FrameOutput(sink: frameSink) { [weak self] event in
            Task { @MainActor in self?.receive(event, session: session) }
        }
        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        do {
            try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
        } catch {
            status = .stopped(.failed("Could not attach to the capture stream."))
            return
        }
        self.stream = stream
        self.output = output
        health.start(at: Date())

        Task {
            do {
                try await stream.startCapture()
                guard session == self.generation else { return }
                self.status = .sharing
                self.watchSource(session: session)
            } catch {
                guard session == self.generation else { return }
                self.tearDown(reason: Self.reason(for: error))
            }
        }
    }

    private func receive(_ event: FrameOutput.Event, session: Int) {
        guard session == generation else { return }
        switch event {
        case .frame(let changed, let image):
            health.recordSignal(contentChanged: changed, at: Date())
            if let image { preview = image }
        case .stopped(let error):
            tearDown(reason: Self.reason(for: error))
        }
    }

    /// Polls for the picked window disappearing; ScreenCaptureKit does not always
    /// stop the stream when a window closes.
    private func watchSource(session: Int) {
        watchTask?.cancel()
        guard let windowID else { return }
        watchTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard !Task.isCancelled, session == self.generation else { return }
                let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let content else { continue }
                if !content.windows.contains(where: { $0.windowID == windowID }) {
                    self.tearDown(reason: .windowGone)
                    return
                }
            }
        }
    }

    private func tearDown(reason: StopReason) {
        tearDownStream()
        SCContentSharingPicker.shared.remove(self)
        SCContentSharingPicker.shared.isActive = false
        preview = nil
        windowID = nil
        if reason != .windowGone { source = nil }
        status = .stopped(reason)
    }

    private func tearDownStream() {
        generation += 1
        watchTask?.cancel()
        watchTask = nil
        if let stream {
            Task { try? await stream.stopCapture() }
        }
        stream = nil
        output = nil
        filter = nil
    }

    private func describe(_ filter: SCContentFilter) -> ShareSource {
        if let window = filter.includedWindows.first {
            let app = window.owningApplication?.applicationName
            if let title = window.title, !title.isEmpty {
                return ShareSource(kind: .window, appName: app, title: title)
            }
            return ShareSource(kind: .window, appName: app, title: app.map { "\($0) window" } ?? "Untitled window")
        }
        return ShareSource(kind: .display, appName: nil, title: "Entire display")
    }

    /// Capture state for the UI at `now` (stream health is time-dependent).
    func shareState(at now: Date) -> ShareState {
        switch status {
        case .idle, .stopped(.userStopped): return .none
        case .choosing: return .choosing
        case .starting:
            return source.map { .starting($0) } ?? .none
        case .sharing:
            return source.map { .live($0, health.state(at: now)) } ?? .none
        case .stopped(.windowGone): return .ended(.windowClosed(source))
        case .stopped(.permissionDenied): return .ended(.denied)
        case .stopped(.failed(let message)): return .ended(.failed(message))
        }
    }

    // MARK: Agent screenshots

    /// A still image of exactly the shared window or display, sized for the backend's
    /// model limits, plus where that content sits on screen so action coordinates can
    /// be mapped back. Fails when nothing is being shared: the agent never sees more
    /// than the user authorized.
    func agentFrame() async throws(AgentFrameError) -> AgentFrame {
        guard status == .sharing, let filter else { throw .notSharing }
        let region: CGRect
        let ownerPID: pid_t?
        if let window = filter.includedWindows.first {
            // Re-read the window so a moved window maps correctly.
            let content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let live = content?.windows.first(where: { $0.windowID == window.windowID }) else {
                throw .windowNotVisible
            }
            region = live.frame
            ownerPID = live.owningApplication?.processID
        } else if let display = filter.includedDisplays.first {
            region = display.frame
            ownerPID = nil
        } else {
            throw .notSharing
        }
        let size = MacScreenshot.targetSize(for: region.size)
        let configuration = SCStreamConfiguration()
        configuration.width = size.width
        configuration.height = size.height
        configuration.showsCursor = false
        configuration.scalesToFit = true
        let image: CGImage
        do {
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            throw .captureFailed
        }
        guard let jpeg = Self.jpegData(image) else { throw .captureFailed }
        return AgentFrame(
            screenshot: MacScreenshot(
                mediaType: "image/jpeg", data: jpeg.base64EncodedString(), width: image.width, height: image.height),
            region: region,
            windowOwnerPID: ownerPID
        )
    }

    private static func jpegData(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    private static func reason(for error: (any Error)?) -> StopReason {
        guard let error = error as? SCStreamError else {
            return .failed("Capture stopped unexpectedly.")
        }
        switch error.code {
        case .userDeclined: return .permissionDenied
        case .userStopped: return .userStopped
        default: return .failed("Capture stopped (code \(error.code.rawValue)).")
        }
    }
}

extension CaptureController: SCContentSharingPickerObserver {
    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        Task { @MainActor in
            if self.status == .choosing { self.status = .idle }
        }
    }

    nonisolated func contentSharingPicker(
        _ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?
    ) {
        nonisolated(unsafe) let filter = filter
        Task { @MainActor in self.start(with: filter) }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        Task { @MainActor in self.tearDown(reason: .failed("The sharing picker could not start.")) }
    }
}

/// Receives frames on a background queue. Reports every frame's "changed or not"
/// status for health, and renders a preview image at most twice per second.
private final class FrameOutput: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    enum Event: @unchecked Sendable {
        case frame(changed: Bool, image: CGImage?)
        case stopped(any Error)
    }

    let queue = DispatchQueue(label: "spectr.capture.frames", qos: .userInteractive)
    private let emit: @Sendable (Event) -> Void
    private let sink: FrameSink
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var lastPreview = Date.distantPast

    init(sink: FrameSink, emit: @escaping @Sendable (Event) -> Void) {
        self.sink = sink
        self.emit = emit
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attachments.first?[.status] as? Int,
            let status = SCFrameStatus(rawValue: rawStatus)
        else { return }

        switch status {
        case .complete:
            if let buffer = sampleBuffer.imageBuffer { sink.deliver(buffer) }
            var image: CGImage?
            let now = Date()
            if now.timeIntervalSince(lastPreview) >= 0.5, let buffer = sampleBuffer.imageBuffer {
                lastPreview = now
                image = context.createCGImage(
                    CIImage(cvPixelBuffer: buffer), from: CIImage(cvPixelBuffer: buffer).extent)
            }
            emit(.frame(changed: true, image: image))
        case .idle:
            sink.idle()
            emit(.frame(changed: false, image: nil))
        default:
            return
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        emit(.stopped(error))
    }
}
