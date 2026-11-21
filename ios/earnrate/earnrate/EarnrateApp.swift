import SwiftUI
import WidgetKit

@main struct EarnrateApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @State private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
                .onOpenURL { url in
                    if let link = AppLink(url) { model.go(.link(link)) }
                }
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
        .tint(Color("AccentColor"))
        .onChange(of: scenePhase) {
            CardLight.shared.setActive(scenePhase == .active)
            if scenePhase == .active {
                model.refreshElsewhereIfNewDay()
                Task { await model.checkForData() }
            }
        }
        .sheet(isPresented: $model.showingWelcome) {
            if let welcome = model.home?.welcome {
                WelcomeView(welcome: welcome)
                    .interactiveDismissDisabled()
                    .tint(Color("AccentColor"))
            }
        }
        .sheet(isPresented: $model.addingCards) {
            AddCardsFlow()
                .tint(Color("AccentColor"))
        }
        #if DEBUG
        .overlay {
            if model.screenshotDetail == "lock", let sheet = SharedSheet.read()?.sheet(on: Day.text(.now)) {
                LockScreenMock(sheet: sheet)
            }
        }
        .overlay(alignment: .top) {
            if let brief = model.screenshotBrief {
                ZStack(alignment: .top) {
                    Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
                    BriefSnippet(brief: brief)
                        .padding(.horizontal, 12)
                        .padding(.top, 60)
                }
            }
        }
        #endif
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
                    CardFan(arts: welcome.art)
                        .padding(.top, 40)
                        .padding(.bottom, 20)
                        .accessibilityHidden(true)
                    Text(welcome.title)
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(welcome.lead)
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.primary)
                    Label {
                        Text(welcome.privacy)
                    } icon: {
                        Image(systemName: "lock.iphone")
                    }
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
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
                        .foregroundStyle(Color.onAccent)
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
        .background { CardBackdrop(arts: welcome.art) }
        .sensoryFeedback(.selection, trigger: model.showingWelcome)
    }
}

#if DEBUG
// `-EarnrateOpen widgets:lock`: the Lock Screen widgets drawn by their own
// views at their sizes, in white as the Lock Screen tints them, since the
// Simulator can't edit its Lock Screen.
private struct LockScreenMock: View {
    let sheet: WidgetSnapshot.Sheet

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "#1c1a33"), Color(hex: "#3a3f6b")], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 10) {
                if let first = sheet.rows.first {
                    PurchaseView(row: first, family: .accessoryInline)
                        .font(.subheadline.weight(.semibold))
                }
                Text(Date.now, format: .dateTime.hour().minute())
                    .font(.system(size: 92, weight: .semibold, design: .rounded))
                HStack(spacing: 12) {
                    ForEach(sheet.rows.prefix(2)) { row in
                        PurchaseView(row: row, family: .accessoryRectangular)
                            .frame(width: 160, height: 72)
                    }
                }
                Spacer()
            }
            .foregroundStyle(.white.opacity(0.92))
            .padding(.top, 70)
        }
    }
}
#endif
