import SwiftUI

// Adding cards, as the site's tap-to-pick setup: the common cards as tiles,
// then every card by issuer (business cards in their own sections) or a
// search. A tap adds a card; tapping one added here takes it back out. Cards
// held before the sheet opened stay put: they may carry picks or totals, so
// they're removed from My wallet, not here. Next asks only what changes the
// new cards' answers, and all of it can be skipped.
struct AddCardsFlow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var added: [String] = []
    @State private var before: Set<String> = []
    @State private var setup: Setup?
    @State private var asking = false
    @State private var finished = 0

    var body: some View {
        NavigationStack {
            CardPicker(added: $added, before: before)
                .navigationTitle(model.walletHome.addCards.isEmpty ? "Add cards" : model.walletHome.addCards)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        if added.isEmpty {
                            Button("Close", systemImage: "xmark") { dismiss() }
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if !added.isEmpty {
                            Button(setup?.asksAnything == true ? "Next" : "Done") { next() }
                                .buttonStyle(.glassProminent)
                        }
                    }
                }
                .navigationDestination(isPresented: $asking) {
                    SetupView(ids: added) { done() }
                }
        }
        .onAppear { before = Set(model.walletCards.map(\.id)) }
        .task(id: added) {
            setup = added.isEmpty ? nil : try? await model.setup(for: added)
        }
        .sensoryFeedback(.success, trigger: finished)
    }

    private func next() {
        if setup?.asksAnything == true { asking = true } else { done() }
    }

    private func done() {
        finished += 1
        model.tab = .wallet
        dismiss()
    }
}

private struct CardPicker: View {
    @Environment(AppModel.self) private var model
    @Binding var added: [String]
    let before: Set<String>
    @State private var query = ""
    @State private var found: CardGroups?
    @State private var refusal: String?
    @State private var tapped = 0

    private var held: Set<String> { Set(model.walletCards.map(\.id)) }

    var body: some View {
        List {
            if let found, !found.quick.isEmpty {
                Section {
                    QuickGrid(cards: found.quick, held: held, before: before, toggle: toggle)
                        .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                } header: {
                    Text(found.quickTitle)
                }
            }
            ForEach(found?.groups ?? []) { group in
                Section {
                    ForEach(group.cards) { card in
                        CardPickRow(card: card, on: held.contains(card.id), kept: before.contains(card.id)) {
                            toggle(card.id)
                        }
                    }
                } header: {
                    if !group.title.isEmpty { Text(group.title) }
                }
                .sectionIndexLabel(group.index.isEmpty ? nil : group.index)
            }
        }
        .listSectionIndexVisibility(query.isEmpty ? .visible : .hidden)
        .overlay {
            if let found, found.groups.isEmpty && !query.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: found?.searchPrompt ?? "")
        .autocorrectionDisabled()
        .task(id: "\(query)|\(model.revision)") {
            if let next = try? await model.cards(matching: query) { found = next }
        }
        .refusalAlert($refusal)
        .sensoryFeedback(.selection, trigger: tapped)
    }

    private func toggle(_ id: String) {
        guard !before.contains(id) else { return }
        tapped += 1
        Task {
            if held.contains(id) {
                refusal = await model.remove(id)
                if refusal == nil { added.removeAll { $0 == id } }
            } else {
                refusal = await model.add(id)
                if refusal == nil && !added.contains(id) { added.append(id) }
            }
        }
    }
}

// The common cards as tiles, two or three to a row.
private struct QuickGrid: View {
    let cards: [CardRow]
    let held: Set<String>
    let before: Set<String>
    let toggle: (String) -> Void
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: size.isAccessibilitySize ? 220 : 100), spacing: 10)]
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(cards) { card in
                QuickTile(card: card, on: held.contains(card.id), kept: before.contains(card.id)) {
                    toggle(card.id)
                }
            }
        }
    }
}

private struct QuickTile: View {
    let card: CardRow
    let on: Bool
    let kept: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack(alignment: .topTrailing) {
                    CardArtView(art: card.art, width: 64)
                    if on {
                        Image(systemName: "checkmark.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, Color.accentColor)
                            .font(.title3)
                            .offset(x: 8, y: -8)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                Text(card.shortName)
                    .font(.footnote.weight(on ? .semibold : .regular))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.vertical, 10)
            .padding(.horizontal, 6)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(on ? AnyShapeStyle(Color.accentColor.opacity(0.14)) : AnyShapeStyle(.fill.quaternary))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(on ? Color.accentColor : .clear, lineWidth: 2)
            )
            .contentShape(RoundedRectangle(cornerRadius: 14))
            .animation(.snappy, value: on)
        }
        .buttonStyle(.plain)
        .disabled(kept)
        .accessibilityLabel(card.shortName)
        .accessibilityValue(on ? (kept ? "In your wallet" : "Added") : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct CardPickRow: View {
    let card: CardRow
    let on: Bool
    let kept: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                CardListRow(card: card)
                Spacer()
                Image(systemName: on ? "checkmark.circle.fill" : "plus.circle")
                    .font(.title3)
                    .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
            .contentShape(Rectangle())
        }
        .foregroundStyle(.primary)
        .disabled(kept)
        .accessibilityValue(on ? (kept ? "In your wallet" : "Added") : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// What the new cards need: picks, activations and memberships. Every
// answer saves as it's tapped; Skip and Done both just close.
struct SetupView: View {
    @Environment(AppModel.self) private var model
    let ids: [String]
    let done: () -> Void
    @State private var setup: Setup?
    @State private var refusal: String?
    @State private var answered = false

    var body: some View {
        Form {
            if let setup {
                Section {
                } footer: {
                    Text(setup.lead)
                        .font(.subheadline)
                }
                ForEach(setup.cards) { card in
                    Section {
                        ForEach(card.notes, id: \.self) { note in
                            Text(note)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        ForEach(card.picks) { group in
                            PickChips(group: group) { option in
                                Task { refusal = await model.edit(card.card.id, ["pick": ["choice": group.choice, "option": option]]) }
                            }
                        }
                        if !card.activations.isEmpty {
                            ActivationToggles(title: card.activationsTitle, rows: card.activations) { rule, on in
                                Task { refusal = await model.edit(card.card.id, ["activate": ["rule": rule, "on": on]]) }
                            }
                        }
                    } header: {
                        HStack(spacing: 10) {
                            CardArtView(art: card.card.art, width: 36)
                            Text(card.card.shortName)
                                .font(.headline)
                                .foregroundStyle(Color.primary)
                                .textCase(nil)
                        }
                    }
                }
                if let memberships = setup.memberships {
                    Section(memberships.title) {
                        MembershipControls(toggles: memberships.toggles, menus: memberships.menus, refusal: $refusal)
                    }
                }
            }
        }
        .navigationTitle(setup?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button((answered ? setup?.done : setup?.skip) ?? "") { done() }
                    .buttonStyle(.glassProminent)
            }
        }
        .task(id: model.revision) {
            if let next = try? await model.setup(for: ids, asked: setup?.asked) {
                if setup != nil { answered = true }
                setup = next
            }
        }
        .refusalAlert($refusal)
    }
}

// A card's category picks as chips, with what each pick covers.
struct PickChips: View {
    let group: PickGroup
    let pick: (String) -> Void
    @State private var tapped = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.legend)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(group.count)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            FlowLayout(spacing: 8) {
                ForEach(group.options) { option in
                    Chip(label: option.label, on: option.on, enabled: option.enabled) {
                        tapped += 1
                        pick(option.id)
                    }
                }
            }
            ForEach(group.info, id: \.self) { info in
                DisclosureGroup(info.question) {
                    Text(info.answer)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .font(.footnote)
            }
        }
        .padding(.vertical, 4)
        .sensoryFeedback(.selection, trigger: tapped)
    }
}

struct ActivationToggles: View {
    let title: String
    let rows: [ActivationRow]
    let set: (String, Bool) -> Void

    var body: some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
        ForEach(rows) { row in
            SwiftUI.Toggle(isOn: Binding(get: { row.on }, set: { set(row.rule, $0) })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.label)
                        .font(.subheadline)
                    if let opens = row.opens {
                        Text(opens)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .disabled(row.opens != nil)
        }
    }
}

// Memberships as switches, and a menu for each group of tiers.
struct MembershipControls: View {
    @Environment(AppModel.self) private var model
    let toggles: [OnOff]
    let menus: [TierMenu]
    @Binding var refusal: String?

    var body: some View {
        ForEach(toggles) { toggle in
            SwiftUI.Toggle(toggle.label, isOn: Binding(get: { toggle.on }, set: { on in
                Task { refusal = await model.editSettings(["membership": ["id": toggle.id, "on": on]]) }
            }))
        }
        ForEach(menus) { menu in
            Picker(menu.label, selection: Binding(get: { menu.selected }, set: { id in
                Task { refusal = await model.editSettings(["tier": ["group": menu.id, "id": orNull(id)]]) }
            })) {
                Text(menu.none).tag(String?.none)
                ForEach(menu.options) { option in
                    Text(option.label).tag(String?.some(option.id))
                }
            }
        }
    }
}
