import Foundation
import LiveKit
import Observation
import SpectrKit

/// Publishes the shared window or display into this Mac's LiveKit room
/// (`spectr-mac-<deviceId>`), where the iPhone app watches it and the call agent relays
/// it onto FaceTime. Uses a short-lived grant from `GET /api/mac/livekit`; the Mac never
/// holds a LiveKit secret.
@MainActor
@Observable
final class ScreenPublisher {
    enum State: Equatable, Sendable {
        case idle
        case connecting
        case live
        case failed(String)
    }

    private(set) var state: State = .idle

    private let sink: FrameSink
    private var room: Room?
    private var task: Task<Void, Never>?
    /// Increments per session so a late connect from an old session is discarded.
    private var generation = 0

    init(sink: FrameSink) {
        self.sink = sink
    }

    /// Connects and publishes. Safe to call repeatedly; an active session is kept.
    func start(grant: @escaping @Sendable () async throws(MacAgentError) -> MacLiveKitGrant) {
        guard task == nil, state != .live else { return }
        generation += 1
        let session = generation
        let fetchGrant = grant
        state = .connecting
        task = Task {
            do {
                let grant = try await grant()
                // Dynacast stops sending video while nobody is watching, so an always-on
                // share costs almost no upload until the iPhone opens it.
                let room = Room(roomOptions: RoomOptions(dynacast: true))
                try await room.connect(url: grant.url, token: grant.token)
                let track = await LocalVideoTrack.createBufferTrack(name: "spectr-screen", source: .screenShareVideo)
                guard session == self.generation, let capturer = track.capturer as? BufferCapturer else {
                    await room.disconnect()
                    return
                }
                // Frames must flow before publishing: LiveKit waits for the first frame
                // to learn the track's size, and would otherwise wait forever.
                self.sink.setTarget { buffer in capturer.capture(buffer) }
                do {
                    try await room.localParticipant.publish(videoTrack: track, options: Self.publishOptions)
                } catch {
                    if session == self.generation { self.sink.setTarget(nil) }
                    await room.disconnect()
                    throw error
                }
                guard session == self.generation else {
                    await room.disconnect()
                    return
                }
                self.room = room
                self.state = .live
                self.watch(room, session: session, grant: fetchGrant)
            } catch let error as MacAgentError {
                guard session == self.generation else { return }
                self.state = .failed(Self.message(for: error))
            } catch {
                guard session == self.generation else { return }
                self.state = .failed("Couldn't start streaming this Mac's screen.")
            }
            self.task = nil
        }
    }

    /// LiveKit resumes brief drops itself; after a full disconnect (a long network
    /// outage, sleep) this starts a fresh session with a new grant.
    private func watch(
        _ room: Room, session: Int,
        grant: @escaping @Sendable () async throws(MacAgentError) -> MacLiveKitGrant
    ) {
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self, session == self.generation else { return }
                if room.connectionState == .disconnected {
                    self.stop()
                    self.start(grant: grant)
                    return
                }
            }
        }
    }

    /// Stops publishing and leaves the room. The held frame is dropped.
    func stop() {
        generation += 1
        task?.cancel()
        task = nil
        sink.setTarget(nil)
        if let room {
            Task { await room.disconnect() }
        }
        room = nil
        state = .idle
    }

    /// A screen is mostly text and barely moves: spend the bandwidth on sharpness. A high
    /// bitrate at no more than 15 fps, and under congestion drop frames, never resolution.
    static let publishOptions = VideoPublishOptions(
        encoding: VideoEncoding(maxBitrate: 5_000_000, maxFps: 15),
        screenShareEncoding: VideoEncoding(maxBitrate: 5_000_000, maxFps: 15),
        simulcast: false,
        degradationPreference: .maintainResolution
    )

    private static func message(for error: MacAgentError) -> String {
        switch error {
        case .unauthorized: "This Mac's device token was rejected, so its screen can't be streamed."
        case .offline: "Can't reach the Spectr server to start streaming."
        case .unavailable(let detail), .invalidRequest(let detail): "Streaming isn't available: \(detail)"
        case .staleStep, .notFound: "Streaming isn't available right now."
        }
    }
}
