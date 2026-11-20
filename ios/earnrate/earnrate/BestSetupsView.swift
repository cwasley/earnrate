import SwiftUI

// Best setups: every card alone and the best pairs on typical spending, as
// the site's Best setups works them out from scratch. It's the slowest answer
// in the app, so it runs on the engine off the main thread while a progress
// view shows, and is kept until the wallet or the filters change.
struct BestSetupsView: View {
    @Environment(AppModel.self) private var model
    @State private var setups: BestSetups?
    @State private var failure: String?
    @State private var working = false
    @State private var open: Set<String> = []
    @State private var refusal: String?

    private struct Key: Equatable {
        let filters: NextFilters
        let revision: Int
    }

    var body: some View {
        Group {
            if let setups {
                list(setups)
            } else if let failure {
                ContentUnavailableView("No answer", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                progress
            }
        }
        .navigationTitle(setups?.title ?? model.home?.working.setups ?? "")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if let menu = setups?.filters {
                ToolbarItem(placement: .primaryAction) {
                    FiltersMenu(menu: menu)
                }
            }
        }
        .task(id: Key(filters: model.filters, revision: model.revision)) {
            if let ready = model.cachedSetups() {
                setups = ready
                return
            }
            working = true
            defer { working = false }
            do {
                setups = try await model.bestSetups()
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
        .sensoryFeedback(.selection, trigger: open)
        .refusalAlert($refusal)
    }

    private var progress: some View {
        ProgressView {
            Text(model.home?.working.setups ?? "")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func list(_ s: BestSetups) -> some View {
        List {
            if let callout = s.callout {
                Section {
                    Label(callout, systemImage: "info.circle")
                }
            }
            Section {
                ForEach(s.singles) { row in
                    SetupRowView(row: row, held: s.held, expanded: open.contains(row.key), toggle: { toggle(row.key) }, refusal: $refusal)
                }
            } header: {
                VStack(alignment: .leading, spacing: 8) {
                    Text(s.basis)
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                        .textCase(nil)
                    Text(s.singlesTitle)
                }
            } footer: {
                if !s.members.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(s.members, id: \.self) { Text($0) }
                    }
                }
            }

            if s.pairsNote != nil || !s.pairs.isEmpty {
                Section(s.pairsTitle) {
                    if let note = s.pairsNote {
                        Text(note)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(s.pairs) { row in
                        SetupRowView(row: row, held: s.held, expanded: open.contains(row.key), toggle: { toggle(row.key) }, refusal: $refusal)
                    }
                }
            }

            Section {
                DisclosureGroup(s.howTitle) {
                    ForEach(s.how, id: \.self) {
                        Text($0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listSectionSpacing(.compact)
        .opacity(working ? 0.5 : 1)
        .overlay {
            if working {
                ProgressView()
                    .controlSize(.large)
            }
        }
        .animation(.default, value: working)
    }

    private func toggle(_ key: String) {
        withAnimation(.snappy) {
            if open.contains(key) { open.remove(key) } else { open.insert(key) }
        }
    }
}

// A card or a pair: what it nets a year after fees; a tap shows how, with a
// link to each card's page.
private struct SetupRowView: View {
    let row: BestSetups.Row
    let held: String
    let expanded: Bool
    let toggle: () -> Void
    @Binding var refusal: String?
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: toggle) {
                line
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Hides the details" : "Shows the details")
            if let split = row.split {
                Text(split)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if expanded { details }
        }
        .contextMenu {
            ForEach(row.cards) { card in
                NavigationLink(value: Route.card(card.id)) {
                    Label(card.shortName, systemImage: "creditcard")
                }
            }
        }
    }

    private var line: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        return layout {
            HStack(spacing: -14) {
                ForEach(row.cards) { card in
                    CardArtView(art: card.art, width: 44)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name)
                    .font(.body.weight(.semibold))
                if row.cards.contains(where: \.held) {
                    Text(held)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tint)
                }
                Text(row.fee)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !size.isAccessibilitySize { Spacer(minLength: 8) }
            VStack(alignment: .trailing, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(row.net)
                        .font(.title3.weight(.semibold).monospacedDigit())
                    Text(row.per)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let first = row.first {
                    Text(first)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize()
        }
        .accessibilityElement(children: .combine)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(row.warnings, id: \.self) { Warning(text: $0) }
            ForEach(row.lines, id: \.self) {
                Text($0)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let note = row.eligibility {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
            if let ask = row.ask {
                AskField(ask: ask, refusal: $refusal)
            }
            ForEach(row.cards) { card in
                NavigationLink(value: Route.card(card.id)) {
                    Label(card.shortName, systemImage: "creditcard")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.borderless)
            }
        }
        .transition(.opacity)
    }
}
