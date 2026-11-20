import SwiftUI

// Next card: every card ranked by what it adds over its first two years with
// its welcome offer (to the saved cards, or on its own with none), as the
// site's "A new card" and compare_welcome_offers rank them. Best setups and
// the bonus rules are a tap away.
struct NextCardTab: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $model.nextPath) {
            EngineGate {
                NextCardList()
            }
            .navigationTitle("Next card")
            .navigationBarTitleDisplayMode(size.isAccessibilitySize ? .inline : .automatic)
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
    @State private var open: Set<String> = []
    @State private var focused: String?
    @State private var carouselWidth: CGFloat = 400
    @Environment(\.dynamicTypeSize) private var size

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
            if let ready = model.cachedNextCard(all: all) {
                next = ready
                failure = nil
                return
            }
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
        .sensoryFeedback(.selection, trigger: open)
        .refusalAlert($refusal)
    }

    private func list(_ next: NextCard) -> some View {
        let top = Array(next.rows.prefix(Self.carousel))
        let rest = Array(next.rows.dropFirst(Self.carousel))
        let shown = next.rows.first { $0.id == focused } ?? next.rows.first
        return List {
            if !top.isEmpty {
                Section {
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(top) { row in
                                OfferTile(row: row, width: tileWidth, focused: row.id == shown?.id) {
                                    model.nextPath.append(.card(row.card.id))
                                }
                                .frame(maxHeight: .infinity, alignment: .top)
                                .id(row.id)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .contentMargins(.horizontal, 4, for: .scrollContent)
                    .scrollClipDisabled()
                    .scrollTargetBehavior(.viewAligned)
                    .scrollIndicators(.hidden)
                    .scrollPosition(id: $focused, anchor: .leading)
                    .measuredWidth($carouselWidth)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 12, trailing: 0))
                    .listRowBackground(Color.clear)
                } header: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(next.lead)
                            .font(.headline)
                            .foregroundStyle(Color.primary)
                        if !size.isAccessibilitySize {
                            Text(next.basis)
                                .font(.subheadline)
                                .foregroundStyle(Color.inkSecondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plate()
                    .textCase(nil)
                    .padding(.horizontal, -16)
                    .padding(.bottom, 4)
                }
            }

            // At the largest text sizes the basis and Best setups wait at
            // the bottom, so the first card shows on the first screen.
            if !size.isAccessibilitySize {
                Section {
                    bestSetupsLink(next)
                }
                .surfaceRows()
            }

            Section {
                if let empty = next.empty {
                    Text(empty)
                }
                ForEach(rest) { row in
                    OfferRowView(row: row, expanded: open.contains(row.id), toggle: { toggle(row.id) }, refusal: $refusal)
                }
                if let more = next.moreLabel {
                    Button(more) { all = true }
                }
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(next.members, id: \.self) { Text($0) }
                    Text(next.mayDiffer)
                }
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
                .padding(.top, 4)
            }
            .surfaceRows()
            .opacity(working ? 0.5 : 1)
            .animation(.default, value: working)

            Section {
                DisclosureGroup(next.howTitle) {
                    ForEach(size.isAccessibilitySize ? [next.basis] + next.how : next.how, id: \.self) {
                        Text($0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if size.isAccessibilitySize { bestSetupsLink(next) }
                NavigationLink(value: Route.bonusRules) {
                    LinkRow(title: next.rules.title, text: next.rules.text, symbol: "arrow.trianglehead.2.clockwise")
                }
            }
            .surfaceRows()
        }
        .listSectionSpacing(.compact)
        .cardBackdrop(shown.map { [$0.card.art] } ?? [])
    }

    private static let carousel = 5

    private var tileWidth: CGFloat { max(240, min(carouselWidth - 40, 360)) }

    private func bestSetupsLink(_ next: NextCard) -> some View {
        NavigationLink(value: Route.bestSetups) {
            LinkRow(title: next.best.title, text: next.best.text, symbol: "square.stack.3d.up")
        }
    }

    private func toggle(_ id: String) {
        withAnimation(.snappy) {
            if open.contains(id) { open.remove(id) } else { open.insert(id) }
        }
    }
}

// One of the top next cards, big: the card, what it adds, its offer. A tap
// opens the card's page, with the offer's details and history.
private struct OfferTile: View {
    let row: NextCard.Row
    let width: CGFloat
    let focused: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 8) {
                CardFace(art: row.card.art, name: row.card.shortName, width: width - 28, shine: focused, lifted: focused)
                    .padding(.bottom, 4)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(row.total)
                        .font(.figure(.title))
                        .foregroundStyle(row.ineligible == nil ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.inkSecondary))
                    Text(row.per)
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                }
                Text(row.offerShort)
                    .font(.subheadline)
                    .foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
                if let flag = row.flag {
                    Label(flag, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(Color.caution)
                }
                Text("\(row.fee) · \(row.asOf)")
                    .font(.caption)
                    .foregroundStyle(Color.inkSecondary)
            }
            .padding(14)
            .frame(width: width, alignment: .topLeading)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Color.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.card.shortName)
        .accessibilityValue([row.totalLabel, row.flag, row.offerShort, row.fee, row.asOf].compactMap { $0 }.joined(separator: ". "))
        .accessibilityAddTraits(.isButton)
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

// One next card: what it adds over two years and its offer, in a line or
// two; a tap shows the years, the minimum spend, the offer's history and
// whether the person can get the bonus, with the card's page a tap further.
private struct OfferRowView: View {
    let row: NextCard.Row
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
            if expanded { details }
        }
        .padding(.vertical, 2)
        .contextMenu {
            NavigationLink(value: Route.card(row.card.id)) {
                Label(row.card.shortName, systemImage: "creditcard")
            }
        }
    }

    private var line: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        return layout {
            CardArtView(art: row.card.art, width: 44)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                let head = size.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                    : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
                head {
                    Text(row.card.shortName)
                        .font(.body.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if !size.isAccessibilitySize { Spacer(minLength: 4) }
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text(row.total)
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(row.ineligible == nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        Text(row.per)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .fixedSize()
                }
                Text(row.offerShort)
                    .font(.subheadline)
                    .lineLimit(size.isAccessibilitySize ? nil : 2)
                if let flag = row.flag {
                    Text("\(Text("\(row.fee) · \(row.asOf)").foregroundStyle(.secondary)) · \(Text("\(Image(systemName: "exclamationmark.triangle.fill")) \(flag)").foregroundStyle(Color.caution))")
                        .font(.caption)
                } else {
                    Text("\(row.fee) · \(row.asOf)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.card.shortName)
        .accessibilityValue([row.totalLabel, row.flag, row.offerShort, row.fee, row.asOf].compactMap { $0 }.joined(separator: ". "))
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let ineligible = row.ineligible {
                Warning(text: ineligible)
            }
            if let minimum = row.minimum, !minimum.reachable {
                Warning(text: minimum.text)
            }
            if let note = row.eligibility {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(Color.caution)
            }
            if let ask = row.ask {
                AskField(ask: ask, refusal: $refusal)
            }
            if !row.years.isEmpty {
                Text(row.years.joined(separator: " · "))
                    .font(.footnote.monospacedDigit())
            }
            Text(row.offer)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if let minimum = row.minimum, minimum.reachable {
                Text(minimum.text)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let history = row.history {
                Text(history)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            NavigationLink(value: Route.card(row.card.id)) {
                Label(row.card.shortName, systemImage: "creditcard")
                    .font(.footnote.weight(.semibold))
            }
            .buttonStyle(.borderless)
        }
        .padding(.leading, size.isAccessibilitySize ? 0 : 56)
        .transition(.opacity)
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
        .foregroundStyle(Color.caution)
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
