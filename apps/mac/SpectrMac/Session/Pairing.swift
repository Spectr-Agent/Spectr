import Foundation
import Observation
import Security
import SpectrKit

enum PairingError: Error, Equatable {
    case unreachable
    case invalidToken
}

/// Checks a device token with the backend. The backend issues tokens with
/// `services/api/scripts/issue-device-token.mjs` and authenticates every Mac request
/// with them; there is no code-based pairing route yet.
protocol PairingClient: Sendable {
    func validate(token: String) async throws(PairingError)
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
