import SwiftUI

// Cards the person used to have, for issuers' repeat-bonus rules. Only the
// months a rule counts from are asked for, and none is required.
struct PastCardsView: View {
    @Environment(AppModel.self) private var model
    @State private var past: PastCards?
    @State private var refusal: String?
    @State private var adding = false

    var body: some View {
        Group {
            if let past {
                list(past)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(past?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if past != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button(past?.addTitle ?? "", systemImage: "plus") { adding = true }
                }
            }
        }
        .task(id: model.revision) {
            past = try? await model.pastCards()
        }
        .sheet(isPresented: $adding) {
            if let past {
                AddPastCard(groups: past.add, title: past.addTitle) { id in
                    adding = false
                    save(["add": id])
                }
            }
        }
        .refusalAlert($refusal)
    }

    private func save(_ edit: [String: Any]) {
        Task { refusal = await model.editPastCards(edit) }
    }

    private func list(_ past: PastCards) -> some View {
        List {
            Section {
            } footer: {
                Text(past.lead)
                    .font(.subheadline)
            }
            ForEach(past.rows) { row in
                Section {
                    HStack(spacing: 12) {
                        CardArtView(art: row.card.art, width: 44)
                        Text(row.card.shortName)
                            .font(.headline)
                    }
                    .swipeActions {
                        Button(past.remove, systemImage: "trash", role: .destructive) {
                            save(["remove": row.index])
                        }
                    }
                    ForEach(row.months) { month in
                        LabeledContent(month.label) {
                            MonthYearPicker(label: "\(row.card.shortName): \(month.label)", months: model.home?.months ?? [], value: month.month, disabled: month.never) { picked in
                                save(["month": ["index": row.index, "field": month.field, "month": orNull(picked)]])
                            }
                        }
                        if let never = month.neverLabel {
                            SwiftUI.Toggle(never, isOn: Binding(get: { month.never }, set: { on in
                                save(["month": ["index": row.index, "field": month.field, "month": NSNull(), "never": on]])
                            }))
                        }
                    }
                    if let text = row.text {
                        Text(text)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if let ask = row.ask {
                        LabeledContent(ask.label) {
                            MonthYearPicker(label: ask.label, months: model.home?.months ?? [], value: nil) { picked in
                                if let picked {
                                    save(["ask": ["ask": ask.ask.json, "month": picked]])
                                }
                            }
                        }
                    }
                    Button(past.remove, role: .destructive) {
                        save(["remove": row.index])
                    }
                    .font(.subheadline)
                }
            }
            Section {
                Button(past.addTitle, systemImage: "plus.circle") { adding = true }
            }
        }
    }
}

private struct AddPastCard: View {
    @Environment(\.dismiss) private var dismiss
    let groups: [PastCards.Group]
    let title: String
    let add: (String) -> Void
    @State private var query = ""

    private var shown: [PastCards.Group] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return groups }
        return groups.compactMap { g in
            let cards = g.cards.filter { $0.shortName.lowercased().contains(q) || g.issuer.lowercased().contains(q) }
            return cards.isEmpty ? nil : PastCards.Group(issuer: g.issuer, cards: cards)
        }
    }

    // One index letter per letter, on its first issuer.
    private func indexLabel(_ group: PastCards.Group) -> String? {
        let letter = group.issuer.prefix(1)
        return groups.first { $0.issuer.prefix(1) == letter }?.id == group.id ? String(letter) : nil
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(shown) { group in
                    Section(group.issuer) {
                        ForEach(group.cards) { card in
                            Button {
                                add(card.id)
                            } label: {
                                CardListRow(card: card)
                            }
                            .foregroundStyle(.primary)
                        }
                    }
                    .sectionIndexLabel(query.isEmpty ? indexLabel(group) : nil)
                }
            }
            .listSectionIndexVisibility(query.isEmpty ? .visible : .hidden)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .autocorrectionDisabled()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }
}
