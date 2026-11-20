import SwiftUI

// Next card: every card ranked by what it adds over its first two years with
// its welcome offer (to the saved cards, or on its own with none), as the
// site's "A new card" and compare_welcome_offers rank them. Best setups and
// the bonus rules are a tap away.
struct NextCardTab: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.nextPath) {
            EngineGate {
                NextCardList()
            }
            .navigationTitle("Next card")
            .earnrateDestinations()
        }
    }
}

private struct NextCardList: View {
    @Environment(AppModel.self) private var model
    @State private var next: NextCard?
    @State private var failure: String?
    @State private var all = false
    @State private var working = false
    @State private var refusal: String?

    private struct Key: Equatable {
        let filters: NextFilters
        let revision: Int
        let all: Bool
    }

    var body: some View {
        Group {
            if let next {
                list(next)
            } else if let failure {
                ContentUnavailableView("No answer", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .toolbar {
            if let menu = next?.filters {
                ToolbarItem(placement: .primaryAction) {
                    FiltersMenu(menu: menu)
                }
            }
        }
        .task(id: Key(filters: model.filters, revision: model.revision, all: all)) {
            working = true
            defer { working = false }
            do {
                next = try await model.nextCard(all: all)
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
        .onChange(of: model.filters) { all = false }
        .refusalAlert($refusal)
    }

    private func list(_ next: NextCard) -> some View {
        List {
            Section {
                NavigationLink(value: Route.bestSetups) {
                    LinkRow(title: next.best.title, text: next.best.text, symbol: "square.stack.3d.up")
                }
            } header: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(next.lead)
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                    Text(next.basis)
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                }
                .textCase(nil)
                .padding(.bottom, 8)
            }

            Section {
                if let empty = next.empty {
                    Text(empty)
                }
                ForEach(next.rows) { row in
                    NavigationLink(value: Route.card(row.card.id)) {
                        OfferRowView(row: row)
                    }
                    // Cards an issuer counts together ask for the same month;
                    // it's asked once, under the first of them.
                    if let ask = row.ask, next.rows.first(where: { $0.ask == ask })?.id == row.id {
                        AskField(ask: ask, refusal: $refusal)
                    }
                }
                if let more = next.moreLabel {
                    Button(more) { all = true }
                }
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(next.members, id: \.self) { Text($0) }
                    Text(next.mayDiffer)
                }
                .padding(.top, 4)
            }
            .opacity(working ? 0.5 : 1)
            .animation(.default, value: working)

            Section {
                DisclosureGroup(next.howTitle) {
                    ForEach(next.how, id: \.self) {
                        Text($0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                NavigationLink(value: Route.bonusRules) {
                    LinkRow(title: next.rules.title, text: next.rules.text, symbol: "arrow.trianglehead.2.clockwise")
                }
            }
        }
        .listSectionSpacing(.compact)
    }
}

// A row that opens another screen: a title, a line under it, an icon.
struct LinkRow: View {
    let title: String
    let text: String
    let symbol: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol)
                .foregroundStyle(.tint)
        }
    }
}

// One next card: what it adds over two years, its offer, and whether the
// person can get its bonus.
private struct OfferRowView: View {
    let row: NextCard.Row
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        layout {
            CardArtView(art: row.card.art, width: 48)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                let head = size.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                head {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.card.shortName)
                            .font(.body.weight(.semibold))
                        Text(row.card.fee)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    if !size.isAccessibilitySize { Spacer(minLength: 4) }
                    let total = size.isAccessibilitySize
                        ? AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 2))
                        : AnyLayout(VStackLayout(alignment: .trailing, spacing: 0))
                    total {
                        Text(row.total)
                            .font(.title3.weight(.semibold).monospacedDigit())
                            .foregroundStyle(row.ineligible == nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        Text(row.per)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .fixedSize()
                }
                if !row.years.isEmpty {
                    Text(row.years.joined(separator: " · "))
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Text(row.offer)
                    .font(.footnote)
                if let ineligible = row.ineligible {
                    Warning(text: ineligible)
                }
                if let minimum = row.minimum, !minimum.reachable {
                    Warning(text: minimum.text)
                }
                if let note = row.eligibility {
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if let history = row.history {
                    Text(history)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.card.shortName)
        .accessibilityValue(
            [row.totalLabel, row.ineligible, row.minimum.flatMap { $0.reachable ? nil : $0.text }, row.eligibility, row.offer, row.history]
                .compactMap { $0 }
                .joined(separator: " ")
        )
    }
}

struct Warning: View {
    let text: String

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
        }
        .font(.footnote)
        .foregroundStyle(.orange)
    }
}

// The month a repeat-bonus note asks for, saved under Cards you've had (or
// on the card held), the same as on the site.
struct AskField: View {
    @Environment(AppModel.self) private var model
    let ask: AskRow
    @Binding var refusal: String?

    var body: some View {
        LabeledContent {
            MonthYearPicker(label: ask.label, months: model.home?.months ?? [], value: nil) { picked in
                guard let picked else { return }
                Task { refusal = await model.editPastCards(["ask": ["ask": ask.ask.json, "month": picked]]) }
            }
        } label: {
            Text(ask.label)
                .font(.subheadline)
        }
    }
}

// Which cards Next card and Best setups compare, as a native menu.
struct FiltersMenu: View {
    @Environment(AppModel.self) private var model
    let menu: FilterMenu

    var body: some View {
        @Bindable var model = model
        Menu {
            Picker(menu.kindLabel, selection: $model.filters.kind) {
                ForEach(menu.kinds) { kind in
                    Text(kind.label).tag(kind.id)
                }
            }
            .pickerStyle(.inline)
            Section {
                Toggle(menu.noFee.label, isOn: $model.filters.noAnnualFee)
                Toggle(menu.business.label, isOn: $model.filters.business)
            }
        } label: {
            Label(menu.title, systemImage: menu.active > 0
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle")
        }
        .accessibilityValue(menu.active > 0 ? String(menu.active) : "")
        .sensoryFeedback(.selection, trigger: model.filters)
    }
}
