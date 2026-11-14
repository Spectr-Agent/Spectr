import Foundation
import LiveKit
import Observation

/// The live connection to the owner's Mac room (`spectr-mac-<deviceId>`).
///
/// Watching subscribes to the Mac's screen. Calling reconnects with a microphone grant
/// and the server dispatches Spectr's voice agent into the same room, so the owner talks
/// to Spectr and watches the Mac in one place. Ending the call drops back to watching;
/// the agent leaves when the caller's identity leaves.
@MainActor
@Observable
final class LiveSession {
    enum Phase: Equatable {
        case idle
        case connecting
        /// Connected, but the Mac isn't publishing its screen.
        case waitingForScreen
        case live
        case reconnecting
        case failed(String)
    }

    enum CallState: Equatable {
        case off
        case starting
        /// Connected with the microphone on; Spectr may or may not have joined yet.
        case active
    }

    private(set) var phase: Phase = .idle
    private(set) var call: CallState = .off
    private(set) var screen: VideoTrack?
    private(set) var agentJoined = false
    private(set) var agentSpeaking = false
    private(set) var userSpeaking = false
    private(set) var isMuted = false
    private(set) var callStartedAt: Date?

    private let api: any AppAPI
    private var room: Room?
    private var events: RoomEvents?
    private var deviceId: String?
    private var generation = 0

    init(api: any AppAPI) {
        self.api = api
    }

    var isConnected: Bool {
        switch phase {
        case .live, .waitingForScreen, .reconnecting: true
        default: false
        }
    }

    // MARK: Watching

    func watch(deviceId: String) async {
        if self.deviceId == deviceId, room != nil, call == .off, phase != .idle, !isFailed { return }
        self.deviceId = deviceId
        await connect(mode: .watch)
    }

    func retry() async {
        guard let deviceId else { return }
        await connect(mode: call == .off ? .watch : .call, deviceId: deviceId)
    }

    func leave() {
        generation += 1
        let old = room
        room = nil
        events = nil
        screen = nil
        agentJoined = false
        agentSpeaking = false
        userSpeaking = false
        call = .off
        callStartedAt = nil
        phase = .idle
        if let old { Task { await old.disconnect() } }
    }

    // MARK: Calling

    /// Starts a hands-free call with Spectr, keeping the Mac's screen on.
    func startCall(deviceId: String) async {
        guard call == .off else { return }
        self.deviceId = deviceId
        call = .starting
        await connect(mode: .call)
    }

    func endCall() async {
        guard call != .off, let deviceId else { return }
        call = .off
        callStartedAt = nil
        await connect(mode: .watch, deviceId: deviceId)
    }

    func toggleMute() async {
        guard call == .active, let room else { return }
        let mute = !isMuted
        do {
            try await room.localParticipant.setMicrophone(enabled: !mute)
            isMuted = mute
        } catch {
            // Leave the state as it was; the button reflects reality.
        }
    }

    // MARK: Connection

    private var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }

    private func connect(mode: LiveGrant.Mode, deviceId explicit: String? = nil) async {
        generation += 1
        let attempt = generation
        let previous = room
        room = nil
        events = nil
        screen = nil
        agentJoined = false
        if let previous { await previous.disconnect() }
        phase = .connecting
        do {
            let grant = try await api.live(mode: mode, deviceId: explicit ?? deviceId)
            guard attempt == generation else { return }
            let events = RoomEvents { [weak self] in
                Task { @MainActor in self?.sync(attempt) }
            }
            let room = Room(delegate: events)
            self.room = room
            self.events = events
            try await room.connect(url: grant.url, token: grant.token)
            guard attempt == generation else {
                await room.disconnect()
                return
            }
            if mode == .call {
                try await room.localParticipant.setMicrophone(enabled: true)
                isMuted = false
                call = .active
                callStartedAt = Date()
            }
            sync(attempt)
        } catch let error as AppAPIError {
            guard attempt == generation else { return }
            fail(error.message, mode: mode)
        } catch {
            guard attempt == generation else { return }
            fail(
                mode == .call
                    ? "Couldn't start the call. Check that Spectr can use the microphone and try again."
                    : "Couldn't connect to your Mac's screen.", mode: mode)
        }
    }

    private func fail(_ message: String, mode: LiveGrant.Mode) {
        if mode == .call {
            call = .off
            callStartedAt = nil
        }
        phase = .failed(message)
    }

    /// Reads the room's current facts. Called after every LiveKit event.
    private func sync(_ attempt: Int) {
        guard attempt == generation, let room else { return }
        let participants = Array(room.remoteParticipants.values)
        let mac = participants.first { $0.identity?.stringValue.hasPrefix("mac-") == true }
        let track =
            mac?.trackPublications.values
            .first { $0.source == .screenShareVideo || $0.kind == .video }?
            .track as? VideoTrack
        if screen !== track { screen = track }
        let agent = participants.first { $0.kind == .agent }
        agentJoined = agent != nil
        agentSpeaking = agent?.isSpeaking ?? false
        userSpeaking = room.localParticipant.isSpeaking

        switch room.connectionState {
        case .connected:
            phase = track == nil ? .waitingForScreen : .live
        case .reconnecting:
            phase = .reconnecting
        case .connecting:
            phase = .connecting
        case .disconnected:
            if phase != .idle, !isFailed { phase = .failed("Lost the connection to your Mac.") }
            if call != .off {
                call = .off
                callStartedAt = nil
            }
        @unknown default:
            break
        }
    }
}

/// Forwards every room event as a "something changed" signal; the session re-reads state.
private final class RoomEvents: RoomDelegate, @unchecked Sendable {
    private let changed: @Sendable () -> Void

    init(changed: @escaping @Sendable () -> Void) {
        self.changed = changed
    }

    func room(
        _ room: Room, didUpdateConnectionState connectionState: ConnectionState,
        from oldConnectionState: ConnectionState
    ) {
        changed()
    }

    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { changed() }
    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { changed() }
    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        changed()
    }
    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        changed()
    }
    func room(_ room: Room, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) {
        changed()
    }
    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) { changed() }
    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) { changed() }
}
