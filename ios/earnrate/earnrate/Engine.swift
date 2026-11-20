import Foundation
import JavaScriptCore

// The one earnrate engine (src/), bundled by scripts/build-ios-engine.ts from
// ios/engine/entry.ts and run in JavaScriptCore. Requests and answers cross
// as JSON strings. A JSContext isn't safe to share across threads, so the
// actor keeps every call on one executor, off the main thread. Each Engine
// has its own JavaScript virtual machine, so two can work at once.
actor Engine {
    enum Failure: LocalizedError {
        case missing(String)
        case script(String)

        var errorDescription: String? {
            switch self {
            case .missing(let name): "The app is missing \(name)."
            case .script(let message): message
            }
        }
    }

    private let context: JSContext
    private let earnrate: JSValue
    private(set) var cardCount = 0

    // An engine on the card data in `catalog` (the stored form: the parsed
    // catalog with its version), or with none yet, to check a download.
    init(catalog: String? = nil) throws {
        guard let context = JSContext() else { throw Failure.script("No JavaScript context.") }
        context.name = "earnrate"
        context.evaluateScript(try Self.resource("engine", "js"))
        try Self.check(context)
        guard let earnrate = context.objectForKeyedSubscript("earnrate"), earnrate.isObject else {
            throw Failure.script("The engine didn't start.")
        }
        self.context = context
        self.earnrate = earnrate
        if let catalog {
            let count = earnrate.invokeMethod("load", withArguments: [catalog])
            try Self.check(context)
            cardCount = Int(count?.toInt32() ?? 0)
        }
    }

    // One engine function: a JSON request in, its JSON answer out.
    func call(_ name: String, _ request: String) throws -> Data {
        let result = earnrate.invokeMethod(name, withArguments: [request])
        try Self.check(context)
        guard let text = result?.toString() else { throw Failure.script("No answer from \(name).") }
        return Data(text.utf8)
    }

    // The card data this engine runs on.
    func info() throws -> CatalogVersion {
        let result = earnrate.invokeMethod("catalogInfo", withArguments: [])
        try Self.check(context)
        return try JSONDecoder().decode(CatalogVersion.self, from: Data((result?.toString() ?? "").utf8))
    }

    // Checks a catalog file downloaded from earnrate.dev with this engine's
    // own schemas and integrity rules, and runs on it from then on. Throws
    // if the file can't be read or isn't newer than the data loaded; returns
    // the catalog in the form the app stores.
    func adopt(_ downloaded: String) throws -> String {
        let result = earnrate.invokeMethod("checkCatalog", withArguments: [downloaded])
        try Self.check(context)
        guard let stored = result?.toString() else { throw Failure.script("The card data didn't check out.") }
        return stored
    }

    // JavaScriptCore keeps an uncaught exception on the context until cleared.
    private static func check(_ context: JSContext) throws {
        guard let exception = context.exception else { return }
        context.exception = nil
        throw Failure.script(exception.toString() ?? "The engine failed.")
    }

    static func resource(_ name: String, _ ext: String) throws -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            throw Failure.missing("\(name).\(ext)")
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
