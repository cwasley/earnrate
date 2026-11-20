import Foundation
import JavaScriptCore

// The one earnrate engine (src/), bundled by scripts/build-ios-engine.ts and
// run in JavaScriptCore. Requests and answers cross as JSON strings.
final class Engine {
    struct Answer: Decodable {
        let text: String
        let card: String?
    }

    enum Failure: Error, CustomStringConvertible {
        case missing(String)
        case script(String)

        var description: String {
            switch self {
            case .missing(let name): "The app is missing \(name)."
            case .script(let message): message
            }
        }
    }

    private final class LastError {
        var message: String?
    }

    private let context: JSContext
    private let lastError = LastError()
    let cardCount: Int
    let loadMilliseconds: Double

    init() throws {
        let started = Date()
        guard let context = JSContext() else { throw Failure.script("No JavaScript context.") }
        self.context = context
        let box = lastError
        context.exceptionHandler = { _, exception in
            box.message = exception?.toString()
        }
        context.evaluateScript(try Self.resource("engine", "js"))
        if let message = box.message { throw Failure.script(message) }
        let count = context.objectForKeyedSubscript("earnrate")
            .invokeMethod("load", withArguments: [try Self.resource("catalog", "json")])
        if let message = box.message { throw Failure.script(message) }
        cardCount = Int(count?.toInt32() ?? 0)
        loadMilliseconds = Date().timeIntervalSince(started) * 1000
    }

    func best(merchant: String, wallet: [String: Any], today: Date = .now) throws -> Answer {
        let request: [String: Any] = [
            "merchant": merchant,
            "wallet": wallet,
            "today": Self.day.string(from: today),
        ]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self)
        lastError.message = nil
        let result = context.objectForKeyedSubscript("earnrate")
            .invokeMethod("best", withArguments: [json])
        if let message = lastError.message { throw Failure.script(message) }
        guard let text = result?.toString() else { throw Failure.script("No answer.") }
        return try JSONDecoder().decode(Answer.self, from: Data(text.utf8))
    }

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static func resource(_ name: String, _ ext: String) throws -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else {
            throw Failure.missing("\(name).\(ext)")
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}
