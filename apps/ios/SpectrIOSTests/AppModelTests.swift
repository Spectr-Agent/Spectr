import Foundation
import SpectrKit
import Testing

@testable import SpectrIOS

private func makeTask(
    _ id: String = "tsk_1", state: TaskState = .running, question: String? = nil, approval: Bool = false
)
    -> AppTask
{
    AppTask(
        taskId: id, deviceId: "mac-1", state: state, revision: 1, instruction: "open Notes and write milk",
        question: question, needsApproval: approval, summary: state.isTerminal ? "Notes shows milk." : nil,
        activity: state.isTerminal ? nil : "Typing “milk”", stepCount: 2, source: "app",
        createdAt: Date(), updatedAt: Date(), screenshotURL: nil)
}

private func home(macs: [AppMac] = [mac], active: AppTask? = nil, recent: [AppTask] = []) -> AppHome {
    AppHome(
        user: .init(userId: "u", email: "j@example.test"), macs: macs, phones: ["+14706211642"], pendingPhone: nil,
        spectrNumber: "+14705969455", activeTask: active, recentTasks: recent)
}

private let mac = AppMac(deviceId: "mac-1", name: "Jared's Mac", status: .online, sharing: true, lastSeenAt: Date())

/// Scripted server: queued home responses, recorded messages.
private final class FakeAPI: AppAPI, @unchecked Sendable {
    private let lock = NSLock()
    var homes: [Result<AppHome, AppAPIError>]
    var messageResult: Result<MessageResult, AppAPIError> = .success(
        MessageResult(kind: "task", created: true, task: makeTask()))
    var stopResult: Result<MessageResult, AppAPIError> = .success(
        MessageResult(kind: "stop", created: true, task: makeTask(state: .cancelled)))
    private(set) var sent: [String] = []
    private(set) var stopped: [String] = []

    init(homes: [Result<AppHome, AppAPIError>]) {
        self.homes = homes
    }

    func home() async throws(AppAPIError) -> AppHome {
        let next: Result<AppHome, AppAPIError> = lock.withLock { homes.count > 1 ? homes.removeFirst() : homes[0] }
        return try next.get()
    }
    func task(id: String) async throws(AppAPIError) -> AppTask { makeTask(id) }
    func send(text: String, clientMessageId: String, deviceId: String?) async throws(AppAPIError) -> MessageResult {
        lock.withLock { sent.append(text) }
        return try messageResult.get()
    }
    func stop(taskId: String, clientMessageId: String) async throws(AppAPIError) -> MessageResult {
        lock.withLock { stopped.append(taskId) }
        return try stopResult.get()
    }
    func live(mode: LiveGrant.Mode, deviceId: String?) async throws(AppAPIError) -> LiveGrant { throw .offline }
    func pair(code: String) async throws(AppAPIError) -> PairResult { PairResult(deviceId: "mac-1", name: "Mac") }
    func linkPhone(_ phone: String) async throws(AppAPIError) -> PhoneLinkResult {
        PhoneLinkResult(status: "pending", phone: phone, callNumber: "+14705969455", expiresAt: nil)
    }
    func unlinkPhone(_ phone: String) async throws(AppAPIError) {}
}

@MainActor
@Suite("App model")
struct AppModelTests {
    @Test func aNewAccountLeadsWithPairing() async {
        let model = AppModel(api: FakeAPI(homes: [.success(home(macs: []))]))
        await model.refresh()
        #expect(model.load == .loaded)
        #expect(model.needsPairing)
    }

    @Test func sendingShowsTheNewTaskWithoutWaitingForAPoll() async {
        let api = FakeAPI(homes: [.success(home())])
        let model = AppModel(api: api)
        await model.refresh()
        #expect(await model.send("  open Notes and write milk "))
        #expect(api.sent == ["open Notes and write milk"])
        #expect(model.activeTask?.taskId == "tsk_1")
        #expect(model.activeTask?.activity == "Typing “milk”")
    }

    @Test func anEmptyMessageIsNotSent() async {
        let api = FakeAPI(homes: [.success(home())])
        let model = AppModel(api: api)
        #expect(await model.send("   ") == false)
        #expect(api.sent.isEmpty)
    }

    @Test func approvalsAnswerWithYesOrNo() async {
        let api = FakeAPI(homes: [
            .success(home(active: makeTask(state: .waitingForUser, question: "Send it?", approval: true)))
        ])
        let model = AppModel(api: api)
        await model.refresh()
        await model.answer(true)
        await model.answer(false)
        #expect(api.sent == ["Yes", "No"])
    }

    @Test func stoppingMovesTheTaskToTheLatestResult() async {
        let api = FakeAPI(homes: [.success(home(active: makeTask()))])
        let model = AppModel(api: api)
        await model.refresh()
        await model.stopTask()
        #expect(api.stopped == ["tsk_1"])
        #expect(model.activeTask == nil)
        #expect(model.latestResult?.state == .cancelled)
    }

    @Test func aTaskThatFinishesBetweenPollsBecomesTheLatestResult() async {
        let done = makeTask(state: .succeeded)
        let api = FakeAPI(homes: [.success(home(active: makeTask())), .success(home(recent: [done]))])
        let model = AppModel(api: api)
        await model.refresh()
        await model.refresh()
        #expect(model.activeTask == nil)
        #expect(model.latestResult?.summary == "Notes shows milk.")
        model.dismissResult()
        #expect(model.latestResult == nil)
    }

    @Test func aFailedActionShowsANoticeAndAnExpiredSessionSignsOut() async {
        let api = FakeAPI(homes: [.success(home())])
        api.messageResult = .failure(.noMac)
        let model = AppModel(api: api)
        await model.refresh()
        #expect(await model.send("hi") == false)
        #expect(model.notice == "Pair a Mac first.")

        var signedOut = false
        let expired = AppModel(api: FakeAPI(homes: [.failure(.signedOut)]))
        expired.onSignedOut = { signedOut = true }
        await expired.refresh()
        #expect(signedOut)
    }
}

@Suite("App API decoding")
struct AppAPIDecodingTests {
    @Test func decodesTheServersHomePayload() throws {
        let json = """
            {"user":{"userId":"589aefe5-4901-4118-a761-90f5d86a737f","email":"j@example.test"},
             "macs":[{"deviceId":"mac-1","name":"Jared's Mac","status":"online","sharing":null,"lastSeenAt":"2026-11-15T11:59:55.000Z"}],
             "phones":["+14706211642"],"pendingPhone":null,"spectrNumber":"+14705969455",
             "activeTask":{"taskId":"tsk_1","deviceId":"mac-1","state":"waitingForUser","revision":2,"instruction":"send it",
               "question":"Should I send this?","needsApproval":true,"summary":null,"activity":null,"stepCount":3,"source":"call",
               "createdAt":"2026-11-15T11:59:00.000Z","updatedAt":"2026-11-15T11:59:50.000Z","screenshotUrl":null},
             "recentTasks":[]}
            """
        let home = try HTTPAppAPI.decoder.decode(AppHome.self, from: Data(json.utf8))
        #expect(home.macs.first?.sharing == nil)
        #expect(home.activeTask?.needsApproval == true)
        #expect(home.activeTask?.state == .waitingForUser)
    }

    @Test func mapsServerErrorsToWhatTheAppShows() {
        let body = Data(#"{"error":{"code":"noMac","message":"Pair a Mac first.","currentRevision":null}}"#.utf8)
        #expect(HTTPAppAPI.error(status: 409, data: body) == .noMac)
        #expect(HTTPAppAPI.error(status: 401, data: Data()) == .signedOut)
        let taken = Data(#"{"error":{"code":"phoneTaken","message":"Already linked.","currentRevision":null}}"#.utf8)
        #expect(HTTPAppAPI.error(status: 409, data: taken) == .phoneTaken("Already linked."))
    }

    @Test func formatsPhoneNumbers() {
        #expect(PhoneFormat.display("+14705969455") == "(470) 596-9455")
        #expect(PhoneFormat.display("+442079460958") == "+442079460958")
        #expect(PhoneFormat.telURL("+14705969455")?.absoluteString == "tel:+14705969455")
    }
}
