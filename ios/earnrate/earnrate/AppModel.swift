import Foundation
import Observation

enum AppTab: Hashable {
    case store
    case wallet
    case next
    case cards
}

// The app's one engine and the wallet saved on this phone. Nothing here
// leaves the phone: no network, no analytics.
@Observable final class AppModel {
    enum Phase {
        case loading
        case ready(Engine)
        case failed(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var home: Home?
    // The saved cards, as the engine lists them.
    private(set) var walletCards: [CardRow] = []
    private(set) var walletProblems: [String] = []
    private(set) var walletHome = WalletHome.empty
    // Goes up with every saved change, so open screens reload.
    private(set) var revision = 0
    private(set) var recents: [String] = []

    var tab: AppTab = .store
    var storePath: [Route] = []
    var walletPath: [Route] = []
    var showingWelcome = false
    var addingCards = false
    private(set) var nudgeDismissed: Bool

    private let wallet = WalletFile()
    private static let recentsKey = "recentSearches"
    private static let welcomedKey = "welcomed"
    private static let nudgeKey = "addCardsNudgeDismissed"
    private static let recentsKept = 8

    var isReady: Bool {
        if case .ready = phase { true } else { false }
    }

    var hasCards: Bool { !walletCards.isEmpty }

    var showsNudge: Bool { isReady && !hasCards && !nudgeDismissed }

    init() {
        recents = UserDefaults.standard.stringArray(forKey: Self.recentsKey) ?? []
        nudgeDismissed = UserDefaults.standard.bool(forKey: Self.nudgeKey)
    }

    // Loading the engine takes a few hundred milliseconds, so it happens off
    // the main thread while the tabs show a spinner. Someone with cards
    // starts on My wallet; the welcome shows once, on the first launch.
    func start() async {
        guard case .loading = phase else { return }
        do {
            let engine = try await Task.detached(priority: .userInitiated) { try Engine() }.value
            phase = .ready(engine)
            home = try await request("home", [:])
            try await refreshWallet()
            if hasCards { tab = .wallet }
            if !UserDefaults.standard.bool(forKey: Self.welcomedKey) && !hasCards {
                showingWelcome = true
            }
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func finishWelcome(addCards: Bool) {
        UserDefaults.standard.set(true, forKey: Self.welcomedKey)
        showingWelcome = false
        if addCards { addingCards = true }
    }

    func dismissNudge() {
        nudgeDismissed = true
        UserDefaults.standard.set(true, forKey: Self.nudgeKey)
    }

    // From My wallet's search or cheat sheet: At a store's answer.
    func openAnswer(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        remember(trimmed)
        storePath = [.answer(trimmed)]
        tab = .store
    }

    // MARK: Engine calls

    func suggest(_ query: String) async -> [Suggestion] {
        let found: Suggestions? = try? await request("suggest", ["query": query])
        return found?.suggestions ?? []
    }

    func answer(_ query: String, scope: Scope?, kind: String?, all: Bool) async throws -> Answer {
        var fields: [String: Any] = ["query": query, "all": all]
        if let scope { fields["scope"] = scope.rawValue }
        if let kind { fields["kind"] = kind }
        return try await request("answer", fields, wallet: true)
    }

    func cards(matching query: String) async throws -> CardGroups {
        try await request("cards", ["query": query], wallet: true)
    }

    func cardPage(_ id: String) async throws -> CardPage {
        try await request("cardPage", ["id": id], wallet: true)
    }

    // `asked` keeps the questions first asked on screen once answered.
    func setup(for ids: [String], asked: Setup.Asked? = nil) async throws -> Setup {
        var fields: [String: Any] = ["ids": ids]
        if let asked { fields["asked"] = asked.json }
        return try await request("setup", fields, wallet: true)
    }

    func cardSettings(_ id: String) async throws -> CardSettings {
        try await request("cardSettings", ["id": id], wallet: true)
    }

    func walletSettings() async throws -> WalletSettings {
        try await request("walletSettings", [:], wallet: true)
    }

    func pastCards() async throws -> PastCards {
        try await request("pastCards", [:], wallet: true)
    }

    func removal(_ id: String) async throws -> Removal {
        try await request("removal", ["id": id])
    }

    // MARK: Wallet changes

    // Each goes through the engine's wallet rules, and returns the engine's
    // reason when it refuses.
    @discardableResult
    func add(_ id: String) async -> String? {
        await change("addCard", ["id": id])
    }

    @discardableResult
    func remove(_ id: String, keep: Bool = false) async -> String? {
        await change("removeCard", ["id": id, "keep": keep])
    }

    @discardableResult
    func edit(_ id: String, _ edit: [String: Any]) async -> String? {
        await change("editCard", ["id": id, "edit": edit])
    }

    @discardableResult
    func editSettings(_ edit: [String: Any]) async -> String? {
        await change("editSettings", ["edit": edit])
    }

    @discardableResult
    func editPastCards(_ edit: [String: Any]) async -> String? {
        await change("editPastCards", ["edit": edit])
    }

    private func change(_ name: String, _ fields: [String: Any]) async -> String? {
        do {
            let data = try await raw(name, fields, wallet: true)
            guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return "The engine's answer didn't make sense."
            }
            if result["ok"] as? Bool != true {
                return result["error"] as? String ?? "That didn't work."
            }
            if let next = result["wallet"], !(next is NSNull) {
                try wallet.save(JSONSerialization.data(withJSONObject: next, options: [.sortedKeys]))
            } else {
                try wallet.clear()
            }
            try await refreshWallet()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func refreshWallet() async throws {
        let listed: WalletCards = try await request("walletCards", [:], wallet: true)
        walletCards = listed.cards
        walletProblems = listed.problems
        walletHome = try await request("walletHome", [:], wallet: true)
        revision += 1
    }

    // MARK: Recent searches

    func remember(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        recents.removeAll { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        recents.insert(trimmed, at: 0)
        recents = Array(recents.prefix(Self.recentsKept))
        UserDefaults.standard.set(recents, forKey: Self.recentsKey)
    }

    func forget(_ query: String) {
        recents.removeAll { $0 == query }
        UserDefaults.standard.set(recents, forKey: Self.recentsKey)
    }

    func forgetRecents() {
        recents = []
        UserDefaults.standard.removeObject(forKey: Self.recentsKey)
    }

    // MARK: Plumbing

    private func request<T: Decodable>(_ name: String, _ fields: [String: Any], wallet withWallet: Bool = false) async throws -> T {
        let data = try await raw(name, fields, wallet: withWallet)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func raw(_ name: String, _ fields: [String: Any], wallet withWallet: Bool) async throws -> Data {
        guard case .ready(let engine) = phase else { throw Engine.Failure.script("The engine isn't loaded yet.") }
        var fields = fields
        if withWallet, let saved = wallet.load(), let object = try? JSONSerialization.jsonObject(with: saved) {
            fields["wallet"] = object
        }
        let request = String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self)
        return try await engine.call(name, request)
    }
}

// The wallet as one JSON file in Application Support, in the engine's own
// wallet format, written whole and atomically.
struct WalletFile {
    private var url: URL {
        URL.applicationSupportDirectory.appending(path: "wallet.json")
    }

    func load() -> Data? {
        try? Data(contentsOf: url)
    }

    func save(_ data: Data) throws {
        try FileManager.default.createDirectory(at: URL.applicationSupportDirectory, withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    func clear() throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch CocoaError.fileNoSuchFile {
            // Already gone.
        }
    }
}
