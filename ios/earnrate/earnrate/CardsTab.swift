import SwiftUI

// Cards: every card earnrate knows by issuer, as the site's /cards/ lists
// them, narrowed the way its box narrows them; and each card's bonus rule.
struct CardsTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.cardsPath) {
            EngineGate {
                CardsList()
            }
            .navigationTitle("Cards")
            .earnrateDestinations()
        }
    }
}

private struct CardsList: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var index: CardIndex?

    private struct Key: Equatable {
        let query: String
        let revision: Int
    }

    var body: some View {
        List {
            if let index {
                if query.isEmpty {
                    Section {
                        NavigationLink(value: Route.bonusRules) {
                            LinkRow(title: index.rules.title, text: index.rules.text, symbol: "arrow.trianglehead.2.clockwise")
                        }
                    }
                }
                ForEach(index.groups) { group in
                    Section(group.title) {
                        ForEach(group.cards) { card in
                            NavigationLink(value: Route.card(card.id)) {
                                IndexRow(card: card, held: model.home?.held ?? "")
                            }
                        }
                    }
                    .sectionIndexLabel(query.isEmpty && !group.index.isEmpty ? group.index : nil)
                }
                if query.isEmpty {
                    Section {
                    } footer: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(index.lead)
                            Text(index.art)
                        }
                    }
                }
            }
        }
        .listSectionIndexVisibility(query.isEmpty ? .visible : .hidden)
        .overlay {
            if let index, index.groups.isEmpty {
                ContentUnavailableView(index.none, systemImage: "magnifyingglass")
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: index?.searchPrompt ?? "")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .task(id: Key(query: query, revision: model.revision)) {
            index = try? await model.cardIndex(matching: query)
        }
    }
}

private struct IndexRow: View {
    let card: CardRow
    let held: String

    var body: some View {
        HStack(spacing: 12) {
            CardListRow(card: card)
            if card.held {
                Spacer(minLength: 4)
                Text(held)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// /bonus-rules: whether each card's sign-up bonus can be earned again, quoted
// from its issuer, and for cards the person holds or had, what that means.
struct BonusRulesView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var rules: BonusRules?
    @State private var refusal: String?

    private struct Key: Equatable {
        let query: String
        let revision: Int
    }

    var body: some View {
        List {
            if let rules {
                if query.isEmpty {
                    Section {
                        NavigationLink(value: Route.pastCards) {
                            Text(rules.had.link + rules.had.rest)
                                .font(.subheadline)
                        }
                    } footer: {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(rules.lead, id: \.self) { Text($0) }
                        }
                    }
                }
                ForEach(rules.groups) { group in
                    Section(group.title) {
                        ForEach(group.rows) { row in
                            NavigationLink(value: Route.card(row.card.id)) {
                                RuleRow(row: row)
                            }
                            if let ask = row.ask {
                                AskField(ask: ask, refusal: $refusal)
                            }
                        }
                    }
                }
            }
        }
        .overlay {
            if let rules, rules.groups.isEmpty {
                ContentUnavailableView(rules.none, systemImage: "magnifyingglass")
            }
        }
        .navigationTitle(rules?.title ?? "")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: rules?.searchPrompt ?? "")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .task(id: Key(query: query, revision: model.revision)) {
            rules = try? await model.bonusRules(matching: query)
        }
        .refusalAlert($refusal)
    }
}

private struct RuleRow: View {
    let row: BonusRules.Row

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                CardArtView(art: row.card.art, width: 36)
                Text(row.card.shortName)
                    .font(.body.weight(.semibold))
            }
            Text("\(Text(row.label).fontWeight(.semibold)). \(row.detail)")
                .font(.subheadline)
            if let quote = row.quote {
                Text("“\(quote)”")
                    .font(.footnote)
                    .italic()
                    .foregroundStyle(.secondary)
            }
            if let yours = row.yours {
                Text(yours)
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
