import SwiftUI

@main struct EarnrateApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
        }
    }
}

enum Route: Hashable {
    case answer(String)
    case card(String)
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            Tab("At a store", systemImage: "cart") {
                StoreTab()
            }
            Tab("My wallet", systemImage: "wallet.pass") {
                WalletTab()
            }
            Tab("Next card", systemImage: "sparkles") {
                ComingSoon(title: "Next card", symbol: "sparkles", text: "Welcome offers, and which card to get next.")
            }
            Tab("Cards", systemImage: "rectangle.stack") {
                ComingSoon(title: "Cards", symbol: "rectangle.stack", text: "Every card earnrate knows, to browse and search.")
            }
        }
    }
}

// Shown in place of a tab's content until the engine is ready, or if it
// couldn't start.
struct EngineGate<Content: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder let content: () -> Content

    var body: some View {
        switch model.phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView("Couldn't load cards", systemImage: "exclamationmark.triangle", description: Text(message))
        case .ready:
            content()
        }
    }
}

struct ComingSoon: View {
    let title: String
    let symbol: String
    let text: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Coming soon", systemImage: symbol)
            } description: {
                Text(text)
            }
            .navigationTitle(title)
        }
    }
}
