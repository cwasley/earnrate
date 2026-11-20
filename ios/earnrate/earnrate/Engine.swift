import Foundation
import JavaScriptCore

// The one earnrate engine (src/), bundled by scripts/build-ios-engine.ts from
// ios/engine/entry.ts and run in JavaScriptCore. Requests and answers cross
// as JSON strings. A JSContext isn't safe to share across threads, so the
// actor keeps every call on one executor, off the main thread.
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
    let cardCount: Int

    init() throws {
        guard let context = JSContext() else { throw Failure.script("No JavaScript context.") }
        context.name = "earnrate"
        context.evaluateScript(try Self.resource("engine", "js"))
        try Self.check(context)
        guard let earnrate = context.objectForKeyedSubscript("earnrate"), earnrate.isObject else {
            throw Failure.script("The engine didn't start.")
        }
        let count = earnrate.invokeMethod("load", withArguments: [try Self.resource("catalog", "json")])
        try Self.check(context)
        self.context = context
        self.earnrate = earnrate
        cardCount = Int(count?.toInt32() ?? 0)
    }

    // One engine function: a JSON request in, its JSON answer out.
    func call(_ name: String, _ request: String) throws -> Data {
        let result = earnrate.invokeMethod(name, withArguments: [request])
        try Self.check(context)
        guard let text = result?.toString() else { throw Failure.script("No answer from \(name).") }
        return Data(text.utf8)
    }

    // JavaScriptCore keeps an uncaught exception on the context until cleared.
    private static func check(_ context: JSContext) throws {
        guard let exception = context.exception else { return }
        context.exception = nil
        throw Failure.script(exception.toString() ?? "The engine failed.")
    }

    private static func resource(_ name: String, _ ext: String) throws -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            throw Failure.missing("\(name).\(ext)")
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
