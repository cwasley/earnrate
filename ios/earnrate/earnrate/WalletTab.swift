import SwiftUI

// My wallet, the home for someone with cards: a store search, the cheat
// sheet, the to-do, the cards, and the cards they've had.
struct WalletTab: View {
    @Environment(AppModel.self) private var model
    @State private var settings = false

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
                        Button("Settings", systemImage: "gearshape") { settings = true }
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
            .sheet(isPresented: $settings) {
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
                ContentUnavailableView {
                    Label("No cards yet", systemImage: "wallet.pass")
                } description: {
                    Text(model.home?.startNote.every ?? "")
                } actions: {
                    Button(model.home?.nudge.button ?? "") { model.addingCards = true }
                        .buttonStyle(.borderedProminent)
                }
            }
            .listRowBackground(Color.clear)
            Section {
                NavigationLink(value: Route.pastCards) {
                    LabeledContent(model.walletHome.past.title, value: model.walletHome.past.count)
                }
            }
        }
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

    private var home: WalletHome { model.walletHome }

    var body: some View {
        List {
            if !model.walletProblems.isEmpty {
                Section {
                    ForEach(model.walletProblems, id: \.self) { Text($0) }
                }
            }

            if let sheet = home.sheet {
                Section {
                    ForEach(sheet.rows) { row in
                        if let query = row.query {
                            NavigationLink(value: Route.answer(query)) {
                                SheetRow(row: row)
                            }
                        } else {
                            SheetRow(row: row)
                        }
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sheet.title)
                        Text(sheet.subtitle)
                            .font(.footnote)
                            .textCase(nil)
                    }
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
                } header: {
                    Text(home.todoTitle)
                }
            }

            Section {
                ForEach(home.cards) { held in
                    NavigationLink(value: Route.settings(held.card.id, nil)) {
                        HeldRow(held: held)
                    }
                    .swipeActions {
                        Button("Remove", systemImage: "minus.circle", role: .destructive) {
                            Task { await askRemove(held.card) }
                        }
                    }
                    .contextMenu {
                        NavigationLink(value: Route.card(held.card.id)) {
                            Label("Card page", systemImage: "creditcard")
                        }
                        Button("Remove", systemImage: "minus.circle", role: .destructive) {
                            Task { await askRemove(held.card) }
                        }
                    }
                }
                Button(home.addCards, systemImage: "plus.circle") { model.addingCards = true }
            } header: {
                Text(home.cardsTitle)
            }

            Section {
                NavigationLink(value: Route.pastCards) {
                    LabeledContent(home.past.title, value: home.past.count)
                }
            }
        }
        .searchable(text: $query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always), prompt: home.searchPrompt)
        .searchSuggestions {
            SuggestionRows(suggestions: suggestions, open: openAnswer)
        }
        .autocorrectionDisabled()
        .onSubmit(of: .search) { openAnswer(query) }
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

extension TodoRow {
    // "Amex Gold · $10 left · by Nov 30", the date in orange.
    fileprivate var meta: Text {
        let detail = Text(item.detail).foregroundStyle(.secondary)
        guard let when = item.when else { return detail }
        let date = Text(when.replacingOccurrences(of: " ", with: "\u{00A0}")).foregroundStyle(.orange)
        return Text("\(detail) · \(date)")
    }
}

private struct SheetRow: View {
    let row: WalletHome.Sheet.Row
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 10))
        layout {
            Text(row.label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(minWidth: size.isAccessibilitySize ? nil : 92, alignment: .leading)
            HStack(spacing: 8) {
                if let art = row.art {
                    CardArtView(art: art, width: 28)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(size.isAccessibilitySize ? nil : 2)
                    if let note = row.note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
            if !size.isAccessibilitySize { Spacer(minLength: 4) }
            Text(row.rate)
                .font(.subheadline.weight(.semibold).monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }
}

private struct HeldRow: View {
    let held: WalletHome.Held
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 12))
        layout {
            CardArtView(art: held.card.art, width: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(held.card.shortName)
                Text(held.card.fee)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let note = held.note {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(held.ask ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                }
            }
            if !size.isAccessibilitySize { Spacer(minLength: 4) }
            if held.ask && held.note == nil {
                Text(held.action)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.tint)
            }
        }
        .accessibilityElement(children: .combine)
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
