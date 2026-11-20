import SwiftUI

// My wallet: the cards saved on this phone.
struct WalletTab: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var refusal: String?

    var body: some View {
        NavigationStack {
            EngineGate {
                if model.walletCards.isEmpty && model.walletProblems.isEmpty {
                    ContentUnavailableView {
                        Label("No cards yet", systemImage: "wallet.pass")
                    } description: {
                        Text("Until you add yours, answers cover every card earnrate knows. Your cards stay on this phone.")
                    } actions: {
                        Button("Add Cards") { adding = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        if !model.walletProblems.isEmpty {
                            Section {
                                ForEach(model.walletProblems, id: \.self) { Text($0) }
                            }
                        }
                        Section {
                            ForEach(model.walletCards) { card in
                                NavigationLink(value: Route.card(card.id)) {
                                    CardListRow(card: card)
                                }
                                .swipeActions {
                                    Button("Remove", systemImage: "minus.circle", role: .destructive) {
                                        Task { refusal = await model.remove(card.id) }
                                    }
                                }
                            }
                        } footer: {
                            Text("Answers at a store rank these cards. They stay on this phone.")
                        }
                    }
                }
            }
            .navigationTitle("My wallet")
            .toolbar {
                if model.isReady && model.hasCards {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Add Cards", systemImage: "plus") { adding = true }
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .answer(let asked): AnswerScreen(query: asked)
                case .card(let id): CardPageView(id: id)
                }
            }
            .sheet(isPresented: $adding) {
                AddCardsSheet()
            }
            .alert("Couldn't change My wallet", isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(refusal ?? "")
            }
        }
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

// Every card by issuer, or the ones a search finds. A tap adds a card or
// takes it out again.
struct AddCardsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var groups: [CardGroups.Group] = []
    @State private var refusal: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.cards) { card in
                            let held = model.walletCards.contains { $0.id == card.id }
                            Button {
                                Task { refusal = await model.toggle(card) }
                            } label: {
                                HStack {
                                    CardListRow(card: card)
                                    Spacer()
                                    if held {
                                        Image(systemName: "checkmark")
                                            .font(.body.weight(.semibold))
                                            .foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .foregroundStyle(.primary)
                            .accessibilityAddTraits(held ? .isSelected : [])
                        }
                    } header: {
                        if !group.issuer.isEmpty { Text(group.issuer) }
                    }
                }
            }
            .overlay {
                if groups.isEmpty && !query.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Card name or issuer")
            .autocorrectionDisabled()
            .task(id: query) {
                groups = (try? await model.cards(matching: query)) ?? []
            }
            .navigationTitle("Add Cards")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Couldn't change My wallet", isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(refusal ?? "")
            }
        }
    }
}
