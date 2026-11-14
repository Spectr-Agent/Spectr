import Foundation
import Observation
import Security
import SpectrKit

/// A pairing code the Mac shows and the iPhone approves. PROVISIONAL: follows the
/// proposal in `docs/native/CONTRACT.md`; the routes are not deployed yet.
struct PairingChallenge: Equatable, Sendable, Decodable {
    var challengeId: String
    var code: String
    var pollSecret: String
    var expiresAt: Date
}

enum PairingExchange: Equatable, Sendable {
    case pending
    case paired(StoredDevice)
}

enum PairingError: Error, Equatable {
    case unreachable
    case expired
}

protocol PairingClient: Sendable {
    func createChallenge() async throws(PairingError) -> PairingChallenge
    func exchange(_ challenge: PairingChallenge) async throws(PairingError) -> PairingExchange
}

/// The device identity this Mac holds after pairing.
struct StoredDevice: Equatable, Sendable, Codable {
    var deviceId: String
    var deviceCredential: String
    /// Not in the proposed contract yet; nil until the backend returns it.
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
    func createChallenge() async throws(PairingError) -> PairingChallenge { throw .unreachable }
    func exchange(_ challenge: PairingChallenge) async throws(PairingError) -> PairingExchange { throw .unreachable }
}

/// Talks to the proposed pairing routes. Anything but a clean answer is "unreachable".
struct HTTPPairingClient: PairingClient {
    let origin: URL
    var session: URLSession = .shared

    func createChallenge() async throws(PairingError) -> PairingChallenge {
        let (data, status) = try await post("v1/pairing/challenges", body: [:])
        guard status == 200 || status == 201,
            let challenge = try? WireJSON.decoder().decode(PairingChallenge.self, from: data)
        else { throw .unreachable }
        return challenge
    }

    func exchange(_ challenge: PairingChallenge) async throws(PairingError) -> PairingExchange {
        let (data, status) = try await post(
            "v1/pairing/exchange", body: ["challengeId": challenge.challengeId, "pollSecret": challenge.pollSecret])
        switch status {
        case 202: return .pending
        case 200:
            guard let device = try? WireJSON.decoder().decode(StoredDevice.self, from: data) else {
                throw .unreachable
            }
            return .paired(device)
        case 404, 410: throw .expired
        default: throw .unreachable
        }
    }

    private func post(_ path: String, body: [String: String]) async throws(PairingError) -> (Data, Int) {
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(body)
        request.timeoutInterval = 15
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw .unreachable
        }
    }
}

/// Owns the pairing flow: request a code, show it, poll until the iPhone approves.
@MainActor
@Observable
final class PairingController {
    private(set) var state: PairingState
    private let client: any PairingClient
    private let credentials: any DeviceCredentialStore
    private let pollInterval: Duration
    private let now: @Sendable () -> Date
    private var task: Task<Void, Never>?

    init(
        client: any PairingClient,
        credentials: any DeviceCredentialStore,
        pollInterval: Duration = .seconds(2),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.client = client
        self.credentials = credentials
        self.pollInterval = pollInterval
        self.now = now
        if let device = credentials.load() {
            state = .paired(PairedPhone(deviceId: device.deviceId, phoneName: device.phoneName))
        } else {
            state = .unpaired
        }
    }

    /// Requests a code unless one is already on screen or the Mac is paired.
    func start() {
        switch state {
        case .requesting, .awaitingApproval, .paired: return
        case .unpaired, .failed: break
        }
        state = .requesting
        task = Task { await self.run() }
    }

    /// Stops asking; an unapproved code is abandoned.
    func cancel() {
        task?.cancel()
        task = nil
        if state.phone == nil { state = .unpaired }
    }

    /// Forgets the device credential. The iPhone must pair again.
    func unpair() {
        task?.cancel()
        task = nil
        credentials.clear()
        state = .unpaired
    }

    /// Waits for the in-flight attempt to settle. For tests.
    func waitUntilSettled() async {
        await task?.value
    }

    #if DEBUG
        /// Debug only: act as the local lab device so the rest of the app is usable
        /// before the pairing routes exist. Nothing is stored.
        func useLabDevice() {
            task?.cancel()
            state = .paired(PairedPhone(deviceId: ActionLab.deviceId, phoneName: nil))
        }
    #endif

    private func run() async {
        do {
            let challenge = try await client.createChallenge()
            guard !Task.isCancelled else { return }
            state = .awaitingApproval(code: challenge.code, expiresAt: challenge.expiresAt)
            while !Task.isCancelled {
                guard now() < challenge.expiresAt else { throw PairingError.expired }
                if case .paired(let device) = try await client.exchange(challenge) {
                    guard !Task.isCancelled else { return }
                    try? credentials.save(device)
                    state = .paired(PairedPhone(deviceId: device.deviceId, phoneName: device.phoneName))
                    return
                }
                try? await Task.sleep(for: pollInterval)
            }
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed((error as? PairingError) == .expired ? .expired : .unreachable)
        }
    }
}
