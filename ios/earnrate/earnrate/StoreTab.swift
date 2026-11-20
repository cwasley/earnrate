import SwiftUI

// At a store: type a store or a kind of place, get the card to use.
struct StoreTab: View {
    @Environment(AppModel.self) private var model
    @State private var path: [Route] = []
    @State private var query = ""
    @State private var searching = false
    @State private var suggestions: [Suggestion] = []

    var body: some View {
        NavigationStack(path: $path) {
            EngineGate {
                StartList(open: open)
            }
            .navigationTitle("At a store")
            .searchable(text: $query, isPresented: $searching, prompt: "Store or category")
            .searchSuggestions {
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
            .autocorrectionDisabled()
            .onSubmit(of: .search) { open(query) }
            .task(id: query) {
                suggestions = model.isReady ? await model.suggest(query) : []
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .answer(let asked): AnswerScreen(query: asked)
                case .card(let id): CardPageView(id: id)
                }
            }
        }
    }

    private func open(_ asked: String) {
        let trimmed = asked.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        model.remember(trimmed)
        searching = false
        query = ""
        path.append(.answer(trimmed))
    }
}

// Before anything's typed: recent searches and the everyday purchases.
private struct StartList: View {
    @Environment(AppModel.self) private var model
    let open: (String) -> Void

    var body: some View {
        List {
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
                ForEach(model.home.quick, id: \.self) { item in
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
                Text(model.hasCards
                    ? "Answers rank the cards in My wallet. You can switch to every card on any answer."
                    : "Answers cover every card earnrate knows until you add yours in My wallet.")
            }
        }
    }
}

private struct SearchRow: View {
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
