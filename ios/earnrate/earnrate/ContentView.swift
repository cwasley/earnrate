import SwiftUI

// Phase 0: the engine answering in the app. Not the real interface.
struct ContentView: View {
    @State private var store = "Whole Foods"
    @State private var answer = ""
    @State private var timing = ""
    @State private var engine: Result<Engine, Error>?

    private let wallet: [String: Any] = [
        "cards": [["id": "amex-gold"], ["id": "chase-sapphire-preferred"], ["id": "citi-double-cash"]]
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Store") {
                    TextField("Whole Foods", text: $store)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .onSubmit(ask)
                }
                Section {
                    Text(answer)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                } footer: {
                    Text(timing)
                }
            }
            .navigationTitle("earnrate")
        }
        .task {
            engine = Result { try Engine() }
            ask()
        }
    }

    private func ask() {
        switch engine {
        case .success(let engine):
            let started = Date()
            do {
                let result = try engine.best(merchant: store, wallet: wallet)
                let ms = Date().timeIntervalSince(started) * 1000
                answer = result.text
                timing = String(format: "%d cards loaded in %.0f ms. Answered in %.0f ms.", engine.cardCount, engine.loadMilliseconds, ms)
            } catch {
                answer = "\(error)"
            }
        case .failure(let error):
            answer = "\(error)"
        case nil:
            break
        }
    }
}

#Preview {
    ContentView()
}
