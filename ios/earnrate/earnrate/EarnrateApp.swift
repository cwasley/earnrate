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
    case settings(String, SettingsFocus?)
    case pastCards
    case bestSetups
    case bonusRules
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.tab) {
            Tab("At a store", systemImage: "cart", value: AppTab.store) {
                StoreTab()
            }
            Tab("My wallet", systemImage: "wallet.pass", value: AppTab.wallet) {
                WalletTab()
            }
            Tab("Next card", systemImage: "sparkles", value: AppTab.next) {
                NextCardTab()
            }
            Tab("Cards", systemImage: "rectangle.stack", value: AppTab.cards) {
                CardsTab()
            }
        }
        .onChange(of: scenePhase) {
            CardLight.shared.setActive(scenePhase == .active)
        }
        .sheet(isPresented: $model.showingWelcome) {
            if let welcome = model.home?.welcome {
                WelcomeView(welcome: welcome)
                    .interactiveDismissDisabled()
            }
        }
        .sheet(isPresented: $model.addingCards) {
            AddCardsFlow()
        }
    }
}

// Every screen's destinations, in whichever tab it's pushed.
extension View {
    func earnrateDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .answer(let asked): AnswerScreen(query: asked)
            case .card(let id): CardPageView(id: id)
            case .settings(let id, let focus): CardSettingsView(id: id, focus: focus)
            case .pastCards: PastCardsView()
            case .bestSetups: BestSetupsView()
            case .bonusRules: BonusRulesView()
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

// The first launch: what earnrate does, that it stays on the phone, and
// the two ways in.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    let welcome: Home.Welcome

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    HStack(spacing: -28) {
                        ForEach(Array(welcome.art.enumerated()), id: \.offset) { i, art in
                            CardArtView(art: art, width: 110, shine: true)
                                .rotationEffect(.degrees(i == 0 ? -8 : 6))
                                .offset(y: i == 0 ? 0 : 10)
                        }
                    }
                    .padding(.top, 24)
                    .padding(.bottom, 12)
                    .accessibilityHidden(true)
                    Text(welcome.title)
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(welcome.lead)
                        .font(.title3)
                        .multilineTextAlignment(.center)
                    Label {
                        Text(welcome.privacy)
                    } icon: {
                        Image(systemName: "lock.iphone")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.center, for: .alignment)
            VStack(spacing: 12) {
                Button {
                    model.finishWelcome(addCards: true)
                } label: {
                    Text(welcome.add)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent)
                Button {
                    model.finishWelcome(addCards: false)
                } label: {
                    Text(welcome.skip)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.glass)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .sensoryFeedback(.selection, trigger: model.showingWelcome)
    }
}
