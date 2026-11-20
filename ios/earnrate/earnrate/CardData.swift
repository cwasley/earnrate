import Foundation

// The card data's version, as catalog-version.json says it, in the app and
// on earnrate.dev.
nonisolated struct CatalogVersion: Codable, Equatable {
    let format: Int
    let version: String

    // "2026.11.17.2" is newer than "2026.11.17", and both than "2026.11.9".
    func isNewer(than other: String) -> Bool {
        let mine = version.split(separator: ".").map { Int($0) ?? 0 }
        let theirs = other.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(mine.count, theirs.count) {
            let a = i < mine.count ? mine[i] : 0
            let b = i < theirs.count ? theirs[i] : 0
            if a != b { return a > b }
        }
        return false
    }
}

// The card data on this phone: the catalog that came with the app, and a
// newer one downloaded from earnrate.dev, if any, in Application Support.
// Each is the parsed catalog with its version, plus that version alone, so
// the two can be compared without reading either catalog.
nonisolated enum CardData {
    struct Source {
        let catalog: String
        let downloaded: Bool
    }

    private static var folder: URL { URL.applicationSupportDirectory.appending(path: "card-data") }
    private static var storedCatalog: URL { folder.appending(path: "catalog.json") }
    private static var storedVersion: URL { folder.appending(path: "catalog-version.json") }

    static func bundledVersion() throws -> CatalogVersion {
        try JSONDecoder().decode(CatalogVersion.self, from: Data(Engine.resource("catalog-version", "json").utf8))
    }

    static func bundled() throws -> Source {
        Source(catalog: try Engine.resource("catalog", "json"), downloaded: false)
    }

    // A download newer than the app's own data, if one is stored; one an
    // app update has caught up with is deleted.
    static func downloaded() -> Source? {
        guard let data = try? Data(contentsOf: storedVersion),
              let stored = try? JSONDecoder().decode(CatalogVersion.self, from: data),
              let bundled = try? bundledVersion()
        else { return nil }
        guard stored.isNewer(than: bundled.version),
              let catalog = try? String(contentsOf: storedCatalog, encoding: .utf8)
        else {
            discard()
            return nil
        }
        return Source(catalog: catalog, downloaded: true)
    }

    // The catalog first, then its version, each written whole.
    static func save(_ catalog: String, _ version: CatalogVersion) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data(catalog.utf8).write(to: storedCatalog, options: .atomic)
        try JSONEncoder().encode(version).write(to: storedVersion, options: .atomic)
    }

    // Where the app keeps the last version file's ETag, and a release its
    // engine couldn't read.
    static let etagKey = "cardDataETag"
    static let refusedKey = "cardDataRefused"

    static func discard() {
        try? FileManager.default.removeItem(at: folder)
        UserDefaults.standard.removeObject(forKey: etagKey)
    }
}

// Fetches card data from earnrate.dev: the small version file, sent with
// the ETag of the last one so an unchanged check is a 304 with no body, and
// a release's catalog (its own address, cached for good on the site) only
// when it's newer. The requests carry nothing about the person: no cookies,
// no identifiers, nothing of the app's own beyond the ETag.
nonisolated struct CardDataFetcher {
    static let site = URL(string: "https://earnrate.dev")!

    enum Latest {
        case unchanged
        case version(CatalogVersion, etag: String?)
    }

    let base: URL

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    func latest(etag: String?) async throws -> Latest {
        var request = URLRequest(url: base.appending(path: "app/catalog-version.json"))
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await Self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode == 304 { return .unchanged }
        guard http.statusCode == 200 else { throw URLError(.badServerResponse) }
        let version = try JSONDecoder().decode(CatalogVersion.self, from: data)
        return .version(version, etag: http.value(forHTTPHeaderField: "ETag"))
    }

    func catalog(_ version: String) async throws -> String {
        let (data, response) = try await Self.session.data(from: base.appending(path: "app/catalog/\(version).json"))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return String(decoding: data, as: UTF8.self)
    }
}
