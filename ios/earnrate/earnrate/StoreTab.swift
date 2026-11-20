import SwiftUI

// At a store: type a store or a kind of place, get the card to use.
struct StoreTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.storePath) {
            EngineGate {
                StoreSearch()
            }
            .navigationTitle("At a store")
            .earnrateDestinations()
        }
    }
}

private struct StoreSearch: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var searching = false
    @State private var suggestions: [Suggestion] = []
    @State private var pending: String?

    var body: some View {
        StartList(open: open)
            .searchable(text: $query, isPresented: $searching, placement: .navigationBarDrawer(displayMode: .always), prompt: "Store or category")
            .searchSuggestions {
                SuggestionRows(suggestions: suggestions, open: open)
            }
            .autocorrectionDisabled()
            .onSubmit(of: .search) { open(query) }
            .task(id: query) {
                suggestions = await model.suggest(query)
            }
            .onChange(of: searching) {
                guard !searching, let asked = pending else { return }
                pending = nil
                query = ""
                Task {
                    try? await Task.sleep(for: .milliseconds(600))
                    model.storePath.append(.answer(asked))
                }
            }
    }

    // The search closes before the answer is pushed: pushed from an open
    // search, the answer's title stayed blank.
    private func open(_ asked: String) {
        let trimmed = asked.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        model.remember(trimmed)
        if searching {
            pending = trimmed
            searching = false
        } else {
            model.storePath.append(.answer(trimmed))
        }
    }
}

struct SuggestionRows: View {
    let suggestions: [Suggestion]
    let open: (String) -> Void

    var body: some View {
        ForEach(suggestions, id: \.self) { suggestion in
            Button {
                open(suggestion.text)
            } label: {
                SearchRow(text: suggestion.text, symbol: suggestion.kind == .store ? "storefront" : "tag")
            }
            .foregroundStyle(.primary)
            .accessibilityHint(suggestion.kind == .store ? "Store" : "Kind of place")
        }
    }
}

// Before anything's typed: the add-cards card for someone with none,
// recent searches and the everyday purchases.
private struct StartList: View {
    @Environment(AppModel.self) private var model
    let open: (String) -> Void

    var body: some View {
        List {
            if model.showsNudge, let nudge = model.home?.nudge {
                Section {
                    NudgeCard(nudge: nudge)
                }
            }
            if !model.recents.isEmpty {
                Section {
                    ForEach(model.recents, id: \.self) { recent in
                        Button {
                            open(recent)
                        } label: {
                            SearchRow(text: recent, symbol: "clock.arrow.circlepath")
                        }
                        .foregroundStyle(.primary)
                        .swipeActions {
                            Button("Remove", systemImage: "trash", role: .destructive) {
                                model.forget(recent)
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Recent")
                        Spacer()
                        Button("Clear") { model.forgetRecents() }
                            .font(.subheadline)
                            .textCase(nil)
                    }
                }
            }
            Section {
                ForEach(model.home?.quick ?? [], id: \.self) { item in
                    Button {
                        open(item)
                    } label: {
                        SearchRow(text: item, symbol: "magnifyingglass")
                    }
                    .foregroundStyle(.primary)
                }
            } header: {
                Text("Everyday")
            } footer: {
                if let note = model.home?.startNote {
                    Text(model.hasCards ? note.yours : note.every)
                }
            }
        }
        .animation(.default, value: model.showsNudge)
    }
}

// "Add your cards for answers from your own wallet", until there's a card
// or it's closed.
private struct NudgeCard: View {
    @Environment(AppModel.self) private var model
    let nudge: Home.Nudge

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "wallet.pass.fill")
                .font(.title2)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(nudge.text)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                Button(nudge.button) { model.addingCards = true }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
            Spacer(minLength: 0)
            Button {
                model.dismissNudge()
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.vertical, 4)
    }
}

struct SearchRow: View {
    let text: String
    let symbol: String

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: symbol).foregroundStyle(.secondary)
        }
    }
}
