import Foundation

// The cheat sheet as the engine worked it out for the widgets (the
// `widgets` call in ios/engine/entry.ts): this quarter's and the next's.
nonisolated struct WidgetSnapshot: Codable {
    struct Row: Codable, Hashable, Identifiable {
        let label: String
        let query: String?
        let name: String
        let rate: String
        let line: String
        let art: CardArt?
        var id: String { label }
    }

    struct Sheet: Codable {
        let from: String
        let until: String
        let title: String
        let quarter: String
        let scope: String
        let rows: [Row]
    }

    let sheets: [Sheet]

    // The sheet for a day: the last one that has started.
    func sheet(on day: String) -> Sheet? {
        sheets.last { $0.from <= day } ?? sheets.first
    }
}

// The one file the app and its widgets share, in the App Group's container.
// The app writes it whenever the wallet or the card data changes; the
// widgets only read it, so they never run the engine. It holds the cheat
// sheet alone, never the wallet.
nonisolated enum SharedSheet {
    static let group = "group.dev.earnrate.app"

    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appending(path: "cheat-sheet.json")
    }

    static func read() -> WidgetSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    // Readable while the phone is locked after its first unlock, since Lock
    // Screen widgets draw then.
    static func write(_ data: Data) throws {
        guard let url else { throw CocoaError(.fileNoSuchFile) }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

// Links into the app from its widgets: a purchase's answer, or the cheat
// sheet itself.
nonisolated enum AppLink: Equatable {
    case answer(String)
    case sheet

    private static let scheme = "earnrate"

    var url: URL {
        var parts = URLComponents()
        parts.scheme = Self.scheme
        switch self {
        case .answer(let query):
            parts.host = "answer"
            parts.queryItems = [URLQueryItem(name: "q", value: query)]
        case .sheet:
            parts.host = "sheet"
        }
        return parts.url ?? URL(string: "\(Self.scheme)://sheet")!
    }

    init?(_ url: URL) {
        guard url.scheme == Self.scheme, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        switch parts.host {
        case "answer":
            guard let query = parts.queryItems?.first(where: { $0.name == "q" })?.value, !query.isEmpty else { return nil }
            self = .answer(query)
        case "sheet":
            self = .sheet
        default:
            return nil
        }
    }
}
