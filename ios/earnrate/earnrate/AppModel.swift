import Foundation
import Observation

// The app's one engine and the wallet saved on this phone. Nothing here
// leaves the phone: no network, no analytics.
@Observable final class AppModel {
    enum Phase {
        case loading
        case ready(Engine)
        case failed(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var home = Home(quick: [])
    // The saved cards, as the engine lists them.
    private(set) var walletCards: [CardRow] = []
    private(set) var walletProblems: [String] = []
    private(set) var recents: [String] = []

    private let wallet = WalletFile()
    private static let recentsKey = "recentSearches"
    private static let recentsKept = 8

    var isReady: Bool {
        if case .ready = phase { true } else { false }
    }

    var hasCards: Bool { !walletCards.isEmpty }

    init() {
        recents = UserDefaults.standard.stringArray(forKey: Self.recentsKey) ?? []
    }

    // Loading the engine takes a few hundred milliseconds, so it happens off
    // the main thread while the tabs show a spinner.
    func start() async {
        guard case .loading = phase else { return }
        do {
            let engine = try await Task.detached(priority: .userInitiated) { try Engine() }.value
            phase = .ready(engine)
            home = try await request("home", [:])
            try await refreshWallet()
        } catch {
            phase = .failed(error.localizedDescription)
        }
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

    func cards(matching query: String) async throws -> [CardGroups.Group] {
        let found: CardGroups = try await request("cards", ["query": query], wallet: true)
        return found.groups
    }

    func cardPage(_ id: String) async throws -> CardPage {
        try await request("cardPage", ["id": id], wallet: true)
    }

    // MARK: Wallet

    // Adds or removes a card through the engine's wallet rules. Returns the
    // engine's reason when it refuses.
    @discardableResult
    func add(_ id: String) async -> String? {
        await change("addCard", id)
    }

    @discardableResult
    func remove(_ id: String) async -> String? {
        await change("removeCard", id)
    }

    func toggle(_ card: CardRow) async -> String? {
        walletCards.contains { $0.id == card.id } ? await remove(card.id) : await add(card.id)
    }

    private func change(_ name: String, _ id: String) async -> String? {
        do {
            let data = try await raw(name, ["id": id], wallet: true)
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
