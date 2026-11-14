import Foundation
import Observation
import Security
import SpectrKit

enum PairingError: Error, Equatable {
    case unreachable
    case invalidToken
}

/// A pairing code this Mac is showing, and the secret only this Mac holds to collect
/// its device token once the owner enters the code in the Spectr iPhone app.
struct PairingTicket: Equatable, Sendable, Codable {
    var pairingId: String
    var code: String
    var pollSecret: String
    var expiresAt: Date

    /// "K7P4QX" shown as "K7P 4QX".
    var displayCode: String {
        code.count == 6 ? "\(code.prefix(3)) \(code.suffix(3))" : code
    }
}

enum PairingPoll: Equatable, Sendable {
    case pending
    case paired(deviceId: String, token: String)
    case expired
}

/// Talks to the backend about this Mac's identity: pairing codes (`/api/mac/pair`) and,
/// for setups done by hand, checking a token issued with `issue-device-token.mjs`.
protocol PairingClient: Sendable {
    func validate(token: String) async throws(PairingError)
    func startPairing(name: String) async throws(PairingError) -> PairingTicket
    func pollPairing(_ ticket: PairingTicket) async throws(PairingError) -> PairingPoll
}

/// The device identity this Mac holds after pairing.
struct StoredDevice: Equatable, Sendable, Codable {
    var deviceId: String
    var deviceCredential: String
    /// Not returned by the backend yet; nil until it is.
    var phoneName: String?
}

protocol DeviceCredentialStore: Sendable {
    func load() -> StoredDevice?
    func save(_ device: StoredDevice) throws
    func clear()
}

/// Keeps the device credential in the login Keychain, never on disk in the clear.
struct KeychainDeviceCredentialStore: DeviceCredentialStore {
    private let service = "dev.spectr.mac.device"
    private let account = "paired-device"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> StoredDevice? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(StoredDevice.self, from: data)
    }

    func save(_ device: StoredDevice) throws {
        let data = try JSONEncoder().encode(device)
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

final class MemoryDeviceCredentialStore: DeviceCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var device: StoredDevice?

    init(device: StoredDevice? = nil) {
        self.device = device
    }

    func load() -> StoredDevice? { lock.withLock { device } }
    func save(_ device: StoredDevice) throws { lock.withLock { self.device = device } }
    func clear() { lock.withLock { device = nil } }
}

/// Used when the app has no valid API origin: every attempt reports "unreachable".
struct UnavailablePairingClient: PairingClient {
    func validate(token: String) async throws(PairingError) { throw .unreachable }
    func startPairing(name: String) async throws(PairingError) -> PairingTicket { throw .unreachable }
    func pollPairing(_ ticket: PairingTicket) async throws(PairingError) -> PairingPoll { throw .unreachable }
}

/// Validates a token by asking `GET /api/mac/task` with it.
struct HTTPPairingClient: PairingClient {
    let origin: URL
    var transport: any HTTPTransport = URLSessionTransport()

    func validate(token: String) async throws(PairingError) {
        do {
            _ = try await MacAgentClient(origin: origin, deviceToken: token, transport: transport).activeTask()
        } catch .unauthorized {
            throw .invalidToken
        } catch {
            throw .unreachable
        }
    }

    func startPairing(name: String) async throws(PairingError) -> PairingTicket {
        struct Body: Decodable {
            var pairingId: String
            var code: String
            var pollSecret: String
            var expiresAt: String
        }
        let (data, status) = try await post("api/mac/pair", ["name": name])
        guard status == 200, let body = try? JSONDecoder().decode(Body.self, from: data),
            let expires = Self.date(body.expiresAt)
        else { throw .unreachable }
        return PairingTicket(
            pairingId: body.pairingId, code: body.code, pollSecret: body.pollSecret, expiresAt: expires)
    }

    func pollPairing(_ ticket: PairingTicket) async throws(PairingError) -> PairingPoll {
        struct Body: Decodable {
            var status: String
            var deviceId: String?
            var deviceToken: String?
        }
        let (data, status) = try await post(
            "api/mac/pair-status", ["pairingId": ticket.pairingId, "pollSecret": ticket.pollSecret])
        if status == 410 { return .expired }
        guard status == 200, let body = try? JSONDecoder().decode(Body.self, from: data) else { throw .unreachable }
        if body.status == "paired", let deviceId = body.deviceId, let token = body.deviceToken {
            return .paired(deviceId: deviceId, token: token)
        }
        return .pending
    }

    private func post(_ path: String, _ body: [String: String]) async throws(PairingError) -> (Data, Int) {
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        request.httpBody = try? JSONEncoder().encode(body)
        do {
            let (data, response) = try await transport.send(request)
            return (data, response.statusCode)
        } catch {
            throw .unreachable
        }
    }

    private static func date(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}

/// Owns connecting this Mac to the owner's account with a device token.
@MainActor
@Observable
final class PairingController {
    private(set) var state: PairingState {
        didSet { if state != oldValue { onChange?(state) } }
    }
    /// Called after every state change.
    var onChange: ((PairingState) -> Void)?
    private let client: any PairingClient
    private let credentials: any DeviceCredentialStore
    private var task: Task<Void, Never>?

    init(client: any PairingClient, credentials: any DeviceCredentialStore) {
        self.client = client
        self.credentials = credentials
        if let device = credentials.load() {
            state = .paired(PairedPhone(deviceId: device.deviceId, phoneName: device.phoneName))
        } else {
            state = .unpaired
        }
    }

    /// The stored device token, if this Mac is connected.
    var deviceToken: String? { credentials.load()?.deviceCredential }

    /// Checks `token` with the backend and stores it in Keychain when it is accepted.
    func connect(token raw: String) {
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, state != .requesting else { return }
        task?.cancel()
        state = .requesting
        task = Task {
            do {
                try await client.validate(token: token)
                guard !Task.isCancelled else { return }
                let device = StoredDevice(deviceId: "this-mac", deviceCredential: token, phoneName: nil)
                do {
                    try credentials.save(device)
                } catch {
                    state = .failed(.unreachable)
                    return
                }
                state = .paired(PairedPhone(deviceId: device.deviceId, phoneName: nil))
            } catch {
                guard !Task.isCancelled else { return }
                state = .failed((error as? PairingError) == .invalidToken ? .invalidToken : .unreachable)
            }
        }
    }

    /// Shows a pairing code and waits for the owner to enter it in the Spectr iPhone app.
    /// A code that expires is replaced with a new one, so the screen never goes stale.
    func startCodePairing(name: String = Host.current().localizedName ?? "Mac") {
        if case .showingCode = state { return }
        guard state.phone == nil else { return }
        task?.cancel()
        state = .requesting
        task = Task {
            while !Task.isCancelled {
                let ticket: PairingTicket
                do {
                    ticket = try await client.startPairing(name: name)
                } catch {
                    guard !Task.isCancelled else { return }
                    state = .failed(.unreachable)
                    return
                }
                guard !Task.isCancelled else { return }
                state = .showingCode(ticket)
                switch await waitForApproval(ticket) {
                case .paired(let deviceId, let token):
                    do {
                        try credentials.save(StoredDevice(deviceId: deviceId, deviceCredential: token, phoneName: nil))
                    } catch {
                        state = .failed(.unreachable)
                        return
                    }
                    state = .paired(PairedPhone(deviceId: deviceId, phoneName: nil))
                    return
                case .expired:
                    continue
                case .pending:
                    return
                }
            }
        }
    }

    /// Polls until the code is used or expires. Returns `.pending` only when cancelled.
    private func waitForApproval(_ ticket: PairingTicket) async -> PairingPoll {
        var failures = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: pollInterval)
            guard !Task.isCancelled else { break }
            do {
                let result = try await client.pollPairing(ticket)
                failures = 0
                if result != .pending { return result }
            } catch {
                // A brief network drop keeps the code on screen; a long one starts over.
                failures += 1
                if failures >= 15 { return .expired }
            }
        }
        return .pending
    }

    var pollInterval: Duration = .seconds(2)

    func cancel() {
        task?.cancel()
        task = nil
        if state.phone == nil { state = .unpaired }
    }

    /// Forgets the device token. The Mac must be connected again.
    func unpair() {
        task?.cancel()
        task = nil
        credentials.clear()
        state = .unpaired
    }

    /// The backend rejected the stored token (revoked or rotated).
    func tokenRejected() {
        credentials.clear()
        state = .failed(.invalidToken)
    }

    /// Waits for the in-flight attempt to settle. For tests.
    func waitUntilSettled() async {
        await task?.value
    }

    #if DEBUG
        /// Debug only: act as the local lab device so the rest of the app is usable
        /// without a backend. Nothing is stored.
        func useLabDevice() {
            task?.cancel()
            state = .paired(PairedPhone(deviceId: ActionLab.deviceId, phoneName: nil))
        }
    #endif
}
