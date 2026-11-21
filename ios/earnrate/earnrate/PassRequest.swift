import Foundation
import PassKit
import SwiftUI

// Add to Apple Wallet: the one request the app makes with anything from the
// wallet in it, and only when the button is tapped. It posts exactly the
// site's form (the engine's walletPass: card ids, picks, activations,
// checkout labels, memberships and the date) to pass.earnrate.dev, which
// signs the cheat-sheet pass and keeps nothing. An ephemeral session: no
// cookies, cache or credentials, and fixed headers that say nothing about
// the phone beyond its being an iPhone (the pass server counts passes by
// kind of device).
enum PassRequest {
    enum Failure: LocalizedError {
        case refused(String)
        case offline(String)

        var errorDescription: String? {
            switch self {
            case .refused(let text), .offline(let text): text
            }
        }
    }

    static func make(_ request: WalletPassRequest) async throws -> PKPass {
        guard let url = URL(string: request.url) else { throw Failure.offline(request.offline) }
        var post = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
        post.httpMethod = "POST"
        post.httpShouldHandleCookies = false
        post.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        post.setValue("application/vnd.apple.pkpass", forHTTPHeaderField: "Accept")
        post.setValue("en", forHTTPHeaderField: "Accept-Language")
        post.setValue("earnrate (iPhone)", forHTTPHeaderField: "User-Agent")
        post.httpBody = Data(form(request.fields).utf8)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: post)
        } catch {
            throw Failure.offline(request.offline)
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.offline(request.offline) }
        // The pass server answers a refusal (503 until its signing secrets
        // are set, 429, 400) in a plain sentence.
        guard http.statusCode == 200 else {
            let said = String(decoding: data.prefix(500), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw Failure.refused(said.isEmpty ? request.offline : said)
        }
        do {
            return try PKPass(data: data)
        } catch {
            throw Failure.refused(request.failed)
        }
    }

    // application/x-www-form-urlencoded, every byte but A-Z a-z 0-9 - . _ ~
    // percent-encoded (tests/pass.test.ts sends it the same way).
    static func form(_ fields: [WalletPassRequest.Field]) -> String {
        fields.map { "\(encode($0.name))=\(encode($0.value))" }.joined(separator: "&")
    }

    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func encode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}

// Apple's own Add to Apple Wallet button: black, outlined on a dark
// background as Apple asks.
struct AddPassButton: UIViewRepresentable {
    let dark: Bool
    let action: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeUIView(context: Context) -> PKAddPassButton {
        let button = PKAddPassButton(addPassButtonStyle: dark ? .blackOutline : .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.tapped), for: .touchUpInside)
        button.setContentHuggingPriority(.required, for: .horizontal)
        button.setContentHuggingPriority(.required, for: .vertical)
        return button
    }

    func updateUIView(_ button: PKAddPassButton, context: Context) {
        context.coordinator.action = action
        button.addPassButtonStyle = dark ? .blackOutline : .black
    }

    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func tapped() { action() }
    }
}

// The system's Add Pass sheet for a pass the server signed.
// It asks its presenter to close it when the person adds or cancels.
struct AddPassSheet: UIViewControllerRepresentable {
    let pass: PKPass
    let finish: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(finish: finish) }

    func makeUIViewController(context: Context) -> UIViewController {
        guard let controller = PKAddPassesViewController(pass: pass) else { return UIViewController() }
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Coordinator: NSObject, PKAddPassesViewControllerDelegate {
        let finish: () -> Void
        init(finish: @escaping () -> Void) { self.finish = finish }

        func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
            finish()
        }
    }
}
