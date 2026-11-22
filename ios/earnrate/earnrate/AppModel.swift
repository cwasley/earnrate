import AppIntents
import Foundation
import Observation
import WidgetKit

enum AppTab: Hashable {
    case store
    case wallet
    case next
    case cards
}

// The app's engine and the wallet saved on this phone. The wallet never
// leaves the phone, and there are no analytics: the app asks earnrate.dev
// for newer card data (CardData.swift), and only when Add to Apple Wallet
// is tapped sends the pass server what the pass needs (PassRequest.swift). One
// model a process, so Siri, Spotlight and notifications reach the same one
// the screens use.
@Observable final class AppModel {
    static let shared = AppModel()

    enum Phase {
        case loading
        case ready(Engine)
        case failed(String)
    }

    // Where a widget, Spotlight, Siri or a notification asked to go.
    enum Destination: Equatable {
        case link(AppLink)
        case card(String)
        case settings(String, SettingsFocus?)
    }

    private(set) var phase: Phase = .loading
    private(set) var home: Home?
    // The saved cards, as the engine lists them.
    private(set) var walletCards: [CardRow] = []
    private(set) var walletLoaded = false
    private(set) var walletProblems: [String] = []
    private(set) var walletHome = WalletHome.empty
    // Goes up with every saved change, so open screens reload.
    private(set) var revision = 0
    private(set) var recents: [String] = []
    // The card data the engine runs on, and whether it was downloaded.
    private(set) var dataVersion = ""
    private(set) var dataDownloaded = false

    var tab: AppTab = .store
    var storePath: [Route] = []
    var walletPath: [Route] = []
    var nextPath: [Route] = []
    var cardsPath: [Route] = []
    // Next card's and Best setups' filters, kept on this phone.
    var filters: NextFilters {
        didSet {
            Self.save(filters, Self.filtersKey)
            warmUp()
        }
    }
    var showingWelcome = false
    var addingCards = false
    var showingSettings = false
    private(set) var nudgeDismissed: Bool
    private(set) var remindersOn: Bool
    private(set) var reminderOfferAnswered: Bool
    // The phone has notifications off for earnrate, so reminders can't be.
    private(set) var notificationsDenied = false

    private let wallet = WalletFile()
    // The card data the engines were loaded from, for the second engine.
    @ObservationIgnored private var source: CardData.Source?
    // A second engine for the slow answers (Next card, Best setups, whether
    // a fee is worth it), so they never hold up a store answer.
    @ObservationIgnored private var worker: Task<Engine, Error>?
    // Answers worked out for this revision, and those being worked out.
    @ObservationIgnored private var done: [String: Data] = [:]
    @ObservationIgnored private var working: [String: Task<Data, Error>] = [:]
    @ObservationIgnored private var warming: Task<Void, Never>?
    @ObservationIgnored private var checkingData = false
    @ObservationIgnored private var pending: Destination?
    @ObservationIgnored private var elsewhere: Task<Void, Never>?
    @ObservationIgnored private var elsewhereDay = ""
    private static let recentsKey = "recentSearches"
    private static let welcomedKey = "welcomed"
    private static let nudgeKey = "addCardsNudgeDismissed"
    private static let filtersKey = "nextCardFilters"
    private static let dataCheckedKey = "cardDataChecked"
    private static let remindersKey = "remindersOn"
    private static let reminderOfferKey = "reminderOfferAnswered"
    private static let indexedKey = "spotlightIndexedPlaces"
    private static let recentsKept = 8

    var isReady: Bool {
        if case .ready = phase { true } else { false }
    }

    var hasCards: Bool { !walletCards.isEmpty }

    // Not until the saved wallet has loaded, or it flashes for people with cards.
    var showsNudge: Bool { walletLoaded && !hasCards && !nudgeDismissed }

    var showsReminderOffer: Bool { walletHome.reminderOffer != nil && !remindersOn && !reminderOfferAnswered }

    private init() {
        recents = UserDefaults.standard.stringArray(forKey: Self.recentsKey) ?? []
        nudgeDismissed = UserDefaults.standard.bool(forKey: Self.nudgeKey)
        remindersOn = UserDefaults.standard.bool(forKey: Self.remindersKey)
        reminderOfferAnswered = UserDefaults.standard.bool(forKey: Self.reminderOfferKey)
        filters = UserDefaults.standard.data(forKey: Self.filtersKey)
            .flatMap { try? JSONDecoder().decode(NextFilters.self, from: $0) } ?? NextFilters()
    }

    private static func save(_ value: some Encodable, _ key: String) {
        UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: key)
    }

    // Loading the engine takes a moment, so it happens off the main thread
    // while the tabs show a spinner. Someone with cards starts on My wallet;
    // the welcome shows once, on the first launch. Then the slow answers are
    // worked out in the background, and earnrate.dev is asked for newer
    // card data.
    func start() async {
        guard case .loading = phase else { return }
        do {
            let clock = ContinuousClock()
            let began = clock.now
            let (engine, source) = try await EngineLoader.open()
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "EarnrateBenchmark") {
                print("bench load \(began.duration(to: clock.now))")
                await Self.benchmark(engine)
            }
            #endif
            self.source = source
            dataVersion = try await engine.info().version
            dataDownloaded = source.downloaded
            phase = .ready(engine)
            home = try await request("home", [:])
            try await refreshWallet()
            walletLoaded = true
            if let pending {
                self.pending = nil
                go(pending)
            } else if hasCards {
                tab = .wallet
            }
            #if DEBUG
            if let screen = UserDefaults.standard.string(forKey: "EarnrateOpen") { openForScreenshot(screen) }
            #endif
            if !UserDefaults.standard.bool(forKey: Self.welcomedKey) && !hasCards {
                showingWelcome = true
            }
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }
        EarnrateShortcuts.updateAppShortcutParameters()
        await checkForData()
    }

    #if DEBUG
    // `-EarnrateOpen next`, `answer:Whole Foods`, `card:amex-gold`,
    // `wallet:sheet` (scrolled to the cheat sheet) or `wallet:deck` (each
    // card brought forward in turn), `settings` (the wallet's settings) or
    // `brief:Whole Foods` (Siri's snippet for it), for screenshots and
    // recordings from the command line.
    var screenshotDetail: String?
    var screenshotBrief: Brief?

    private func openForScreenshot(_ screen: String) {
        let parts = screen.split(separator: ":", maxSplits: 1).map(String.init)
        screenshotDetail = parts.count == 2 ? parts[1] : nil
        switch parts.first {
        case "next": tab = .next
        case "cards": tab = .cards
        case "settings":
            tab = .wallet
            showingSettings = true
        case "brief" where parts.count == 2:
            tab = .wallet
            Task { screenshotBrief = try? await brief(parts[1]) }
        case "answer" where parts.count == 2:
            tab = .wallet
            walletPath = [.answer(parts[1])]
        case "card" where parts.count == 2:
            tab = .wallet
            walletPath = [.card(parts[1])]
        default: tab = .wallet
        }
    }
    #endif

    // The newest card data on the phone; a download the engine can't load
    // is deleted, and the app's own data used.
    nonisolated static func open() async throws -> (Engine, CardData.Source) {
        if let downloaded = CardData.downloaded() {
            if let engine = try? Engine(catalog: downloaded.catalog) { return (engine, downloaded) }
            CardData.discard()
        }
        let bundled = try CardData.bundled()
        return (try Engine(catalog: bundled.catalog), bundled)
    }

    // MARK: Card data updates

    // At most once a day (on launch, or back in the foreground): asks
    // earnrate.dev for its card data's version and, only when that's newer
    // than the data here, downloads it, checks it with a fresh engine and
    // stores it. Offline, or with data the engine can't read, nothing
    // changes.
    func checkForData() async {
        guard case .ready(let engine) = phase, !checkingData else { return }
        let base = Self.dataBase
        let defaults = UserDefaults.standard
        if base == CardDataFetcher.site,
           let last = defaults.object(forKey: Self.dataCheckedKey) as? Date,
           Date.now.timeIntervalSince(last) < 24 * 60 * 60 {
            return
        }
        checkingData = true
        defer { checkingData = false }
        do {
            let current = try await engine.info()
            let fetcher = CardDataFetcher(base: base)
            let latest = try await fetcher.latest(etag: defaults.string(forKey: CardData.etagKey))
            defaults.set(Date.now, forKey: Self.dataCheckedKey)
            guard case .version(let release, let etag) = latest else { return }
            // The ETag is kept once this release is dealt with, so a check
            // that fails partway is tried again. A release this engine
            // refused once isn't downloaded again.
            guard release.format == current.format,
                  release.isNewer(than: current.version),
                  defaults.string(forKey: CardData.refusedKey) != release.version
            else {
                defaults.set(etag, forKey: CardData.etagKey)
                return
            }
            let file = try await fetcher.catalog(release.version)
            #if DEBUG
            let clock = ContinuousClock()
            let began = clock.now
            #endif
            let checked = await Task.detached(priority: .utility) { () async throws -> (Engine, String, CatalogVersion) in
                let fresh = try Engine()
                let stored = try await fresh.adopt(file)
                let version = try await fresh.info()
                guard version.isNewer(than: current.version) else {
                    throw Engine.Failure.script("Card data \(version.version) isn't newer.")
                }
                try CardData.save(stored, version)
                return (fresh, stored, version)
            }.result
            #if DEBUG
            print("card data: \(release.version) checked in \(began.duration(to: clock.now)): \(checked.map { _ in "used" })")
            #endif
            let fresh: Engine, stored: String, version: CatalogVersion
            switch checked {
            case .success(let result):
                (fresh, stored, version) = result
            case .failure(let error as Engine.Failure):
                defaults.set(etag, forKey: CardData.etagKey)
                defaults.set(release.version, forKey: CardData.refusedKey)
                throw error
            case .failure(let error):
                throw error
            }
            defaults.set(etag, forKey: CardData.etagKey)
            guard case .ready = phase else { return }
            source = CardData.Source(catalog: stored, downloaded: true)
            worker = nil
            phase = .ready(fresh)
            dataVersion = version.version
            dataDownloaded = true
            home = try? await request("home", [:])
            try? await refreshWallet()
        } catch {
            #if DEBUG
            print("card data: \(error.localizedDescription)")
            #endif
        }
    }

    // Debug builds can point at another copy of the site, such as
    // site-dist served on this Mac: launch with -EarnrateCardData <url>.
    // That also checks on every launch.
    private static var dataBase: URL {
        #if DEBUG
        if let given = UserDefaults.standard.string(forKey: "EarnrateCardData"),
           let url = URL(string: given) {
            return url
        }
        #endif
        return CardDataFetcher.site
    }

    func about() async throws -> About {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? ""
        let build = info?["CFBundleVersion"] as? String ?? ""
        var fields: [String: Any] = ["appVersion": "\(version) (\(build))", "downloaded": dataDownloaded]
        if let refused = UserDefaults.standard.string(forKey: CardData.refusedKey) { fields["refused"] = refused }
        return try await request("about", fields)
    }

    #if DEBUG
    // Times the engine's calls on a three-card wallet, for checking speed
    // with JavaScriptCore's JIT off (launch with -EarnrateBenchmark YES).
    private static func benchmark(_ engine: Engine) async {
        let wallet: [String: Any] = [
            "version": 1, "valuations": [:], "memberships": [],
            "cards": [["id": "amex-gold"], ["id": "chase-sapphire-preferred"], ["id": "citi-double-cash"]],
        ]
        let filters: [String: Any] = ["kind": "any", "noAnnualFee": false, "business": false]
        let calls: [(String, String, [String: Any])] = [
            ("store (yours)", "answer", ["query": "Whole Foods", "all": false, "wallet": wallet]),
            ("store (every)", "answer", ["query": "Costco", "all": false]),
            ("cheat sheet", "walletHome", ["wallet": wallet]),
            ("next card", "nextCard", ["filters": filters, "all": false, "wallet": wallet]),
            ("best setups", "bestSetups", ["filters": filters, "wallet": wallet]),
            ("card page", "cardPage", ["id": "amex-gold", "feeWorth": false, "wallet": wallet]),
            ("fee worth", "cardFeeWorth", ["id": "amex-gold", "wallet": wallet]),
        ]
        let clock = ContinuousClock()
        for round in 1...2 {
            for (label, name, fields) in calls {
                guard let data = try? JSONSerialization.data(withJSONObject: fields) else { continue }
                let began = clock.now
                _ = try? await engine.call(name, String(decoding: data, as: UTF8.self))
                print("bench \(round) \(label) \(began.duration(to: clock.now))")
            }
        }
    }
    #endif

    func finishWelcome(addCards: Bool) {
        UserDefaults.standard.set(true, forKey: Self.welcomedKey)
        showingWelcome = false
        if addCards { addingCards = true }
    }

    func dismissNudge() {
        nudgeDismissed = true
        UserDefaults.standard.set(true, forKey: Self.nudgeKey)
    }


    // MARK: Engine calls

    func suggest(_ query: String) async -> [Suggestion] {
        let found: Suggestions? = try? await request("suggest", ["query": query])
        return found?.suggestions ?? []
    }

    // `payment` and `abroad` are how this one purchase is paid, as the
    // site's This purchase asks; neither is saved.
    func answer(_ query: String, scope: Scope?, kind: String?, all: Bool, payment: String? = nil, abroad: Bool = false) async throws -> Answer {
        var fields: [String: Any] = ["query": query, "all": all, "abroad": abroad]
        if let scope { fields["scope"] = scope.rawValue }
        if let kind { fields["kind"] = kind }
        if let payment { fields["payment"] = payment }
        return try await request("answer", fields, wallet: true)
    }

    // "I used it": the purchase goes through the engine's record rules into
    // the saved wallet. The wallet as it was comes back for Undo.
    func record(_ cardId: String, query: String, kind: String?, amount: Double) async throws -> Recorded {
        var fields: [String: Any] = ["cardId": cardId, "query": query, "amount": amount]
        if let kind { fields["kind"] = kind }
        let before = wallet.load()
        let data = try await raw("recordPurchase", fields, wallet: true)
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Engine.Failure.script("The engine's answer didn't make sense.")
        }
        guard result["ok"] as? Bool == true else {
            throw Engine.Failure.script(result["error"] as? String ?? "That didn't work.")
        }
        let message = result["message"] as? String ?? ""
        guard result["recorded"] as? Bool == true, let next = result["wallet"], !(next is NSNull) else {
            return Recorded(message: message, changed: false, before: nil)
        }
        try wallet.save(JSONSerialization.data(withJSONObject: next, options: [.sortedKeys]))
        try await refreshWallet()
        return Recorded(message: message, changed: true, before: before)
    }

    // Puts the wallet back as it was before a purchase was recorded.
    func undo(_ recorded: Recorded) async throws {
        guard recorded.changed, let before = recorded.before else { return }
        try wallet.save(before)
        try await refreshWallet()
    }

    // Keep or replace a saved fee card: slow, so on the second engine.
    func keepOrReplace(_ id: String) async throws -> KeepAnswer? {
        let data = try await slow("keep|\(id)", "keepOrReplace", ["id": id])
        return try JSONDecoder().decode(KeepResult.self, from: data).answer
    }

    // The form the site's Add to Apple Wallet button posts, for the saved
    // cards; nil with none.
    func walletPass() async throws -> WalletPassRequest? {
        let data = try await raw("walletPass", [:], wallet: true)
        return try? JSONDecoder().decode(WalletPassRequest.self, from: data)
    }

    func cards(matching query: String) async throws -> CardGroups {
        try await request("cards", ["query": query], wallet: true)
    }

    // Without whether the fee is worth it, which feeWorth works out.
    func cardPage(_ id: String) async throws -> CardPage {
        try await request("cardPage", ["id": id, "feeWorth": false], wallet: true)
    }

    func cachedFeeWorth(_ id: String) -> FeeWorth? {
        done["fee|\(id)"].flatMap { try? JSONDecoder().decode(FeeWorth.self, from: $0) }
    }

    func feeWorth(_ id: String) async throws -> FeeWorth {
        try JSONDecoder().decode(FeeWorth.self, from: try await slow("fee|\(id)", "cardFeeWorth", ["id": id]))
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

    func cachedNextCard(all: Bool) -> NextCard? {
        done[nextKey(all)].flatMap { try? JSONDecoder().decode(NextCard.self, from: $0) }
    }

    func nextCard(all: Bool) async throws -> NextCard {
        try JSONDecoder().decode(NextCard.self, from: try await slow(nextKey(all), "nextCard", ["filters": filters.json, "all": all]))
    }

    // The slowest answer the app asks for (every card alone and in pairs).
    func cachedSetups() -> BestSetups? {
        done[setupsKey].flatMap { try? JSONDecoder().decode(BestSetups.self, from: $0) }
    }

    func bestSetups() async throws -> BestSetups {
        try JSONDecoder().decode(BestSetups.self, from: try await slow(setupsKey, "bestSetups", ["filters": filters.json]))
    }

    private var filtersKey: String {
        "\(filters.kind)|\(filters.noAnnualFee)|\(filters.business)"
    }

    private var setupsKey: String { "setups|\(filtersKey)" }

    private func nextKey(_ all: Bool) -> String { "next|\(filtersKey)|\(all)" }

    // A slow answer, from the second engine, kept until the wallet or the
    // card data changes; asked twice at once, it's worked out once.
    private func slow(_ key: String, _ name: String, _ fields: [String: Any]) async throws -> Data {
        if let ready = done[key] { return ready }
        if let pending = working[key] { return try await pending.value }
        let at = revision
        let task = Task { try await raw(name, fields, wallet: true, worker: true) }
        working[key] = task
        defer { if revision == at { working[key] = nil } }
        let data = try await task.value
        if revision == at { done[key] = data }
        return data
    }

    // Works out Next card and Best setups ahead of time, a moment after
    // the wallet, the filters or the card data change.
    private func warmUp() {
        warming?.cancel()
        warming = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard let self, !Task.isCancelled else { return }
            #if DEBUG
            let clock = ContinuousClock()
            let began = clock.now
            defer { print("warm-up done in \(began.duration(to: clock.now))") }
            #endif
            _ = try? await self.nextCard(all: false)
            guard !Task.isCancelled else { return }
            _ = try? await self.bestSetups()
        }
    }

    private func workerEngine() async throws -> Engine {
        if let worker { return try await worker.value }
        guard let catalog = source?.catalog else { throw Engine.Failure.script("The engine isn't loaded yet.") }
        let task = Task.detached(priority: .utility) { try Engine(catalog: catalog) }
        worker = task
        return try await task.value
    }

    func cardIndex(matching query: String) async throws -> CardIndex {
        try await request("cardIndex", ["query": query], wallet: true)
    }

    func bonusRules(matching query: String) async throws -> BonusRules {
        try await request("bonusRules", ["query": query], wallet: true)
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
        done = [:]
        working = [:]
        updateElsewhere()
        warmUp()
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

    // Siri and Shortcuts can ask before the screens have loaded the engine,
    // or with no screen at all; they wait for the same one.
    private func raw(_ name: String, _ fields: [String: Any], wallet withWallet: Bool, worker onWorker: Bool = false) async throws -> Data {
        let main: Engine
        if case .ready(let ready) = phase {
            main = ready
        } else {
            main = try await EngineLoader.open().0
        }
        let engine = onWorker ? try await workerEngine() : main
        var fields = fields
        if withWallet, let saved = wallet.load(), let object = try? JSONSerialization.jsonObject(with: saved) {
            fields["wallet"] = object
        }
        let request = String(decoding: try JSONSerialization.data(withJSONObject: fields), as: UTF8.self)
        return try await engine.call(name, request)
    }

    // MARK: Outside the app

    // A tap on a widget, a Spotlight result, Siri's answer or a reminder. One
    // that comes while the engine is still loading waits for it, and then
    // takes the place of the usual first tab.
    func go(_ destination: Destination) {
        guard isReady else {
            pending = destination
            return
        }
        switch destination {
        case .link(.answer(let query)):
            if hasCards {
                tab = .wallet
                walletPath = [.answer(query)]
            } else {
                tab = .store
                storePath = [.answer(query)]
            }
        case .link(.sheet):
            if hasCards {
                tab = .wallet
                walletPath = []
            } else {
                tab = .store
                storePath = []
            }
        case .card(let id):
            if hasCards {
                tab = .wallet
                walletPath = [.card(id)]
            } else {
                tab = .cards
                cardsPath = [.card(id)]
            }
        case .settings(let id, let focus):
            tab = .wallet
            walletPath = walletCards.contains { $0.id == id } ? [.settings(id, focus)] : []
        }
    }

    // One store's answer in a few words, for Siri and Shortcuts.
    func brief(_ query: String) async throws -> Brief {
        try await request("brief", ["query": query], wallet: true)
    }

    // The everyday purchases and recent searches, for Siri to offer.
    func suggestedStores() async -> [String] {
        let everyday: [String]
        if let home {
            everyday = home.quick
        } else {
            let fetched: Home? = try? await request("home", [:])
            everyday = fetched?.quick ?? []
        }
        var seen = Set<String>()
        return (everyday + recents).filter { seen.insert($0.lowercased()).inserted }
    }

    // Reminders on or off. Turning them on is when the phone asks to allow
    // notifications; refused, they stay off.
    func setReminders(_ on: Bool) async {
        answerReminderOffer()
        guard on else {
            remindersOn = false
            UserDefaults.standard.set(false, forKey: Self.remindersKey)
            await ReminderSchedule.clear()
            return
        }
        let allowed = await ReminderSchedule.allow()
        notificationsDenied = !allowed
        remindersOn = allowed
        UserDefaults.standard.set(allowed, forKey: Self.remindersKey)
        if allowed { await scheduleReminders() }
    }

    func answerReminderOffer() {
        reminderOfferAnswered = true
        UserDefaults.standard.set(true, forKey: Self.reminderOfferKey)
    }

    // Whether notifications were turned off in the Settings app since.
    func checkNotifications() async {
        notificationsDenied = await ReminderSchedule.denied()
    }

    // Once a day, the widgets' sheet and the reminders move forward even
    // when nothing in the wallet changed.
    func refreshElsewhereIfNewDay() {
        guard isReady, elsewhereDay != Day.text(.now) else { return }
        updateElsewhere()
    }

    // The widgets' cheat sheet, reminders and Spotlight, worked out on the
    // second engine after every change to the wallet or the card data.
    private func updateElsewhere() {
        elsewhereDay = Day.text(.now)
        elsewhere?.cancel()
        elsewhere = Task { [weak self] in
            guard let self else { return }
            await self.writeWidgets()
            guard !Task.isCancelled else { return }
            await self.scheduleReminders()
            guard !Task.isCancelled else { return }
            await self.indexSpotlight()
        }
    }

    private func writeWidgets() async {
        guard let data = try? await raw("widgets", [:], wallet: true, worker: true) else { return }
        guard !Task.isCancelled, (try? SharedSheet.write(data)) != nil else { return }
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func scheduleReminders() async {
        guard remindersOn,
              let data = try? await raw("reminders", [:], wallet: true, worker: true),
              let list = try? JSONDecoder().decode(Reminders.self, from: data),
              !Task.isCancelled
        else { return }
        await ReminderSchedule.replace(with: list.reminders)
    }

    // Every store once per card data release; the saved cards each time,
    // after the stores, since indexing those clears the index.
    private func indexSpotlight() async {
        if UserDefaults.standard.string(forKey: Self.indexedKey) != dataVersion,
           let data = try? await raw("places", [:], wallet: false, worker: true),
           let list = try? JSONDecoder().decode(Places.self, from: data),
           await Spotlight.index(places: list.places) {
            UserDefaults.standard.set(dataVersion, forKey: Self.indexedKey)
        }
        await Spotlight.index(cards: walletCards)
    }
}

// The process's first engine, opened once whether the screens or Siri asked
// for it first.
enum EngineLoader {
    private static var opening: Task<(Engine, CardData.Source), Error>?

    static func open() async throws -> (Engine, CardData.Source) {
        if let opening { return try await opening.value }
        let task = Task.detached(priority: .userInitiated) { try await AppModel.open() }
        opening = task
        do {
            return try await task.value
        } catch {
            opening = nil
            throw error
        }
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
