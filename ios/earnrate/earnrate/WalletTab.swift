import SwiftUI

// My wallet, the home for someone with cards: a store search, the cheat
// sheet, the to-do, the cards, and the cards they've had.
struct WalletTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.walletPath) {
            EngineGate {
                if model.walletCards.isEmpty && model.walletProblems.isEmpty {
                    EmptyWallet()
                } else {
                    WalletList()
                }
            }
            .navigationTitle("My wallet")
            .toolbar {
                if model.isReady {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Settings", systemImage: "gearshape") { model.showingSettings = true }
                            .accessibilityLabel(model.walletHome.settings)
                    }
                    if model.hasCards {
                        ToolbarItem(placement: .primaryAction) {
                            Button(model.walletHome.addCards, systemImage: "plus") { model.addingCards = true }
                        }
                    }
                }
            }
            .earnrateDestinations()
            .sheet(isPresented: $model.showingSettings) {
                WalletSettingsSheet()
            }
        }
    }
}

private struct EmptyWallet: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Section {
                VStack(spacing: 18) {
                    if let art = model.home?.welcome.art {
                        CardFan(arts: art, width: 150)
                            .padding(.top, 28)
                            .padding(.bottom, 12)
                    }
                    Text("No cards yet")
                        .font(.title2.bold())
                    Text(model.home?.startNote.every ?? "")
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                        .multilineTextAlignment(.center)
                        .plate()
                    Button(model.home?.nudge.button ?? "") { model.addingCards = true }
                        .buttonStyle(AccentButtonStyle())
                }
                .frame(maxWidth: .infinity)
            }
            .listRowBackground(Color.clear)
            if model.walletHome.past.shown {
                Section {
                    NavigationLink(value: Route.pastCards) {
                        LabeledContent(model.walletHome.past.title, value: model.walletHome.past.count)
                    }
                }
                .surfaceRows()
            }
        }
        .cardBackdrop(model.home?.welcome.art ?? [])
    }
}

private struct WalletList: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var query = ""
    @State private var searching = false
    @State private var pending: String?
    @State private var suggestions: [Suggestion] = []
    @State private var removing: CardRow?
    @State private var removal: Removal?
    @State private var refusal: String?
    @State private var removed = 0
    @State private var allTodo = false
    @State private var front: String?

    private var frontCard: WalletHome.Held? {
        home.cards.first { $0.id == front } ?? home.cards.first
    }

    private var home: WalletHome { model.walletHome }

    var body: some View {
        ScrollViewReader { proxy in
            list
            #if DEBUG
                .task { await screenshotDemo(proxy) }
            #endif
        }
        .searchable(text: $query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always), prompt: home.searchPrompt)
        .searchSuggestions {
            SuggestionRows(suggestions: suggestions, open: openAnswer)
        }
        .autocorrectionDisabled()
        .onSubmit(of: .search) { submit() }
        .task(id: query) {
            suggestions = await model.suggest(query)
        }
        .onChange(of: searching) {
            guard !searching, let asked = pending else { return }
            pending = nil
            query = ""
            Task {
                try? await Task.sleep(for: .milliseconds(600))
                model.walletPath.append(.answer(asked))
            }
        }
        .confirmationDialog(removal?.title ?? "", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible) {
            if let removal, let card = removing {
                Button(removal.remove, role: .destructive) {
                    Task { await remove(card, keep: false) }
                }
                if let keep = removal.keep {
                    Button(keep) {
                        Task { await remove(card, keep: true) }
                    }
                }
            }
        }
        .refusalAlert($refusal)
        .sensoryFeedback(.success, trigger: removed)
    }

    private var list: some View {
        List {
            if !model.walletProblems.isEmpty {
                Section {
                    ForEach(model.walletProblems, id: \.self) { Text($0) }
                }
                .surfaceRows()
            }

            if !home.cards.isEmpty {
                // The front card's buttons stay out of a list row: a tap
                // beside a row's buttons fires its first one, so a near miss
                // on Card page would open the card's settings.
                Section {
                } header: {
                    VStack(spacing: 6) {
                        WalletDeck(
                            cards: home.cards,
                            open: { model.walletPath.append(.settings($0.card.id, nil)) },
                            page: { model.walletPath.append(.card($0.id)) },
                            remove: { card in Task { await askRemove(card) } },
                            front: $front
                        )
                        if let held = frontCard {
                            FrontControls(held: held, open: { model.walletPath.append(.settings(held.card.id, nil)) }, page: { model.walletPath.append(.card(held.card.id)) })
                                .padding(.vertical, 2)
                        }
                    }
                    .padding(.top, 4)
                    .padding(.bottom, 6)
                    .textCase(nil)
                }
            }

            if let sheet = home.sheet {
                Section {
                    PocketCard(sheet: sheet) { model.walletPath.append(.answer($0)) }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                        .listRowSeparator(.hidden)
                        .id(Self.sheetId)
                    SheetActions(sheet: sheet)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 8, trailing: 0))
                        .listRowSeparator(.hidden)
                }
            }

            if !home.todo.isEmpty || !home.notes.isEmpty {
                Section {
                    ForEach(allTodo ? home.todo : Array(home.todo.prefix(home.todoShown))) { item in
                        TodoRow(item: item, open: open)
                    }
                    if let more = home.todoMore {
                        Button(allTodo ? home.todoFewer : more) {
                            withAnimation { allTodo.toggle() }
                        }
                        .font(.subheadline)
                    }
                    ForEach(home.notes, id: \.self) { note in
                        Text(note.text)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if model.showsReminderOffer, let offer = home.reminderOffer {
                        ReminderOfferRow(offer: offer)
                    }
                } header: {
                    Text(home.todoTitle)
                        .font(.title2.bold())
                        .foregroundStyle(Color.primary)
                        .textCase(nil)
                }
                .surfaceRows()
            }

            Section {
                Button(home.addCards, systemImage: "plus.circle") { model.addingCards = true }
                if home.past.shown {
                    NavigationLink(value: Route.pastCards) {
                        LabeledContent(home.past.title, value: home.past.count)
                    }
                }
            }
            .surfaceRows()
        }
        .listSectionSpacing(.compact)
        .cardBackdrop(frontCard.map { [$0.card.art] } ?? [])
    }

    private static let sheetId = "sheet"

    #if DEBUG
    private func screenshotDemo(_ proxy: ScrollViewProxy) async {
        switch model.screenshotDetail {
        case "sheet":
            try? await Task.sleep(for: .milliseconds(400))
            proxy.scrollTo(Self.sheetId, anchor: .top)
        case "deck":
            for step in 1...8 {
                try? await Task.sleep(for: .milliseconds(1100))
                let cards = home.cards
                guard !cards.isEmpty else { continue }
                withAnimation(.spring(response: 0.5, dampingFraction: 0.78)) {
                    front = cards[step % cards.count].id
                }
            }
            model.walletPath.append(.answer("Whole Foods"))
        default:
            break
        }
    }
    #endif

    // Closing the search after a suggestion's tap also submits the typed
    // text, so a submit counts only while the search is still open.
    private func submit() {
        guard searching, pending == nil else { return }
        openAnswer(query)
    }

    // The answer opens here, in My wallet; the search closes first, since an
    // answer pushed from an open search kept a blank title.
    private func openAnswer(_ asked: String) {
        let trimmed = asked.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        model.remember(trimmed)
        if searching {
            pending = trimmed
            searching = false
        } else {
            query = ""
            model.walletPath.append(.answer(trimmed))
        }
    }

    private func open(_ item: WalletHome.Todo) {
        if let url = item.url.flatMap(URL.init(string:)) {
            openURL(url)
        } else {
            model.walletPath.append(.settings(item.cardId, item.focus))
        }
    }

    private func askRemove(_ card: CardRow) async {
        removing = card
        removal = try? await model.removal(card.id)
    }

    private func remove(_ card: CardRow, keep: Bool) async {
        refusal = await model.remove(card.id, keep: keep)
        if refusal == nil { removed += 1 }
        removal = nil
        removing = nil
    }
}

// Under the deck: what the front card is waiting for, and its page. (A
// tap on the card itself opens its settings.)
private struct FrontControls: View {
    let held: WalletHome.Held
    let open: () -> Void
    let page: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { buttons }
            VStack(spacing: 8) { buttons }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var buttons: some View {
        if let note = held.note, held.quiet {
            Button(note, action: open)
                .buttonStyle(PlateButtonStyle())
        } else if let note = held.note {
            Button(note, action: open)
                .buttonStyle(AccentButtonStyle())
        } else if held.ask {
            Button(held.action, action: open)
                .buttonStyle(AccentButtonStyle())
        }
        Button("Card page", action: page)
            .buttonStyle(PlateButtonStyle())
    }
}

private struct TodoRow: View {
    let item: WalletHome.Todo
    let open: (WalletHome.Todo) -> Void
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        Button {
            open(item)
        } label: {
            let layout = size.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout {
                CardArtView(art: item.art, width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                    meta
                        .font(.footnote)
                }
                if !size.isAccessibilitySize { Spacer(minLength: 8) }
                if let button = item.button {
                    HStack(spacing: 2) {
                        Text(button)
                        Image(systemName: item.url == nil ? "chevron.right" : "arrow.up.right")
                            .font(.caption2.weight(.bold))
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tint)
                    .fixedSize()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// Asked once, the first time the to-do has a deadline: either answer puts
// it away for good, and the switch stays in Settings.
private struct ReminderOfferRow: View {
    @Environment(AppModel.self) private var model
    let offer: WalletHome.ReminderOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(offer.text)
                    .font(.subheadline)
            } icon: {
                Image(systemName: "bell")
                    .foregroundStyle(.tint)
            }
            HStack(spacing: 8) {
                Button(offer.yes) {
                    Task { await model.setReminders(true) }
                }
                .buttonStyle(AccentButtonStyle())
                Button(offer.no) {
                    withAnimation { model.answerReminderOffer() }
                }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }
}

extension TodoRow {
    // "Amex Gold · $10 left · by Nov 30", the date in amber, kept on one
    // line with its dot so a wrap never leaves the dot hanging.
    fileprivate var meta: Text {
        let detail = Text(item.detail).foregroundStyle(.secondary)
        guard let when = item.when else { return detail }
        let date = Text(when.replacingOccurrences(of: " ", with: "\u{00A0}")).foregroundStyle(Color.caution)
        return Text("\(detail)\u{00A0}·\u{00A0}\(date)")
    }
}

struct CardListRow: View {
    let card: CardRow
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            CardArtView(art: card.art, width: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.shortName)
                Text(card.fee)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
