import SwiftUI

// One store or category's answer: the pick, then the rest of the ranking.
struct AnswerScreen: View {
    @Environment(AppModel.self) private var model
    let query: String

    @State private var answer: Answer?
    @State private var failure: String?
    @State private var scope: Scope?
    @State private var kind: String?
    @State private var all = false

    private struct Key: Equatable {
        let scope: Scope?
        let kind: String?
        let all: Bool
        let revision: Int
    }

    var body: some View {
        Group {
            if let answer {
                AnswerList(answer: answer, scope: scopeBinding(answer), kind: $kind, all: $all)
            } else if let failure {
                ContentUnavailableView("No answer", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // Blank until the answer names it: the typed text ("whole foods",
        // "groceries") isn't always the title, and a title that changes flashes.
        .navigationTitle(answer?.title ?? (failure == nil ? "" : query))
        .navigationBarTitleDisplayMode(.large)
        .task(id: Key(scope: scope, kind: kind, all: all, revision: model.revision)) {
            do {
                answer = try await model.answer(query, scope: scope, kind: kind, all: all)
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
        .sensoryFeedback(.selection, trigger: kind)
        .sensoryFeedback(.selection, trigger: scope)
    }

    private func scopeBinding(_ answer: Answer) -> Binding<Scope> {
        Binding(get: { answer.scope }, set: { scope = $0; all = false })
    }
}

private struct AnswerList: View {
    let answer: Answer
    @Binding var scope: Scope
    @Binding var kind: String?
    @Binding var all: Bool
    @State private var open: Set<String> = []

    var body: some View {
        List {
            Section {
                if answer.canChooseScope {
                    Picker("Which cards", selection: $scope) {
                        Text(answer.labels.yours).tag(Scope.yours)
                        Text(answer.labels.every).tag(Scope.every)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 4, trailing: 20))
                }
            } header: {
                VStack(alignment: .center, spacing: 16) {
                    if let subtitle = answer.subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Color.inkSecondary)
                            .plate(cornerRadius: 14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let pick = answer.pick {
                        AnswerHero(pick: pick, behind: Array(answer.rows.prefix(3)))
                        PickText(pick: pick)
                    }
                }
                .textCase(nil)
                .padding(.bottom, 8)
            } footer: {
                if let note = answer.scopeNote {
                    Text(note).foregroundStyle(Color.inkSecondary)
                }
            }

            if let kinds = answer.kinds {
                Section {
                    KindChips(kinds: kinds, kind: $kind)
                        .surfaceRows()
                } header: {
                    SectionTitle(kinds.prompt)
                } footer: {
                    if let lead = kinds.lead { Text(lead).foregroundStyle(Color.inkSecondary) }
                }
            }

            if !answer.callouts.isEmpty {
                Section {
                    ForEach(answer.callouts, id: \.self) { line in
                        Label {
                            Text(line)
                        } icon: {
                            Image(systemName: "info.circle").foregroundStyle(Color.caution)
                        }
                        .font(.subheadline)
                    }
                }
                .surfaceRows()
            }

            if !answer.credits.isEmpty {
                Section {
                    ForEach(answer.credits) { credit in
                        NavigationLink(value: Route.card(credit.card.id)) {
                            CreditRowView(credit: credit)
                        }
                    }
                } header: {
                    SectionTitle(answer.creditsTitle)
                }
                .surfaceRows()
            }

            if !answer.rows.isEmpty {
                Section {
                    ForEach(answer.rows) { row in
                        RankRow(
                            row: row,
                            markHeld: answer.scope == .every,
                            labels: answer.labels,
                            expanded: open.contains(row.id),
                            toggle: { toggle(row.id) }
                        )
                    }
                    if let more = answer.moreLabel {
                        Button(more) { all = true }
                    }
                } header: {
                    if let title = answer.rankingTitle { SectionTitle(title) }
                } footer: {
                    Footer(lines: answer.footer)
                }
                .surfaceRows()
            } else if !answer.footer.isEmpty {
                Section {
                } footer: {
                    Footer(lines: answer.footer)
                }
            }
        }
        .listSectionSpacing(.compact)
        .cardBackdrop([answer.pick?.art, answer.rows.first?.card.art].compactMap { $0 })
        .sensoryFeedback(.selection, trigger: open)
    }

    private func toggle(_ id: String) {
        withAnimation(.snappy) {
            if open.contains(id) { open.remove(id) } else { open.insert(id) }
        }
    }
}

// The kinds of places to tap for a store earnrate doesn't know: the common
// ones as chips, the rest in a menu.
private struct KindChips: View {
    let kinds: Answer.Kinds
    @Binding var kind: String?

    var body: some View {
        let inMore = kinds.more.first { $0.key == kind }
        FlowLayout(spacing: 8) {
            ForEach(kinds.quick) { k in
                Chip(label: k.label, on: kind == k.key) {
                    kind = kind == k.key ? nil : k.key
                }
            }
            SwiftUI.Menu {
                Picker(kinds.moreLabel, selection: $kind) {
                    Text(kinds.clear).tag(String?.none)
                    ForEach(kinds.more) { k in
                        Text(k.label).tag(String?.some(k.key))
                    }
                }
            } label: {
                ChipLabel(label: inMore?.label ?? kinds.moreLabel, on: inMore != nil, menu: true)
            }
            .accessibilityLabel(kinds.moreLabel)
            .accessibilityValue(inMore?.label ?? "")
        }
        .padding(.vertical, 4)
    }
}

private struct Footer: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(lines, id: \.self) { Text($0) }
        }
        .font(.caption)
        .foregroundStyle(Color.inkSecondary)
        .padding(.top, 6)
    }
}

// The words under the pick: what to use, the rate big, and why.
private struct PickText: View {
    let pick: Answer.Pick

    var body: some View {
        VStack(spacing: 4) {
            Text(pick.label)
                .font(.footnote.weight(.bold))
                .textCase(.uppercase)
                .tracking(1.2)
                .foregroundStyle(.tint)
            Text(pick.name)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.primary)
            Text(pick.detail)
                .font(.figure(.largeTitle))
                .foregroundStyle(Color.primary)
            Text(pick.reason)
                .font(.subheadline)
                .foregroundStyle(Color.inkSecondary)
            ForEach(pick.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.caution)
            }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// A ranked card in a line: name, rule and rate. A tap shows what earning it
// takes and the engine's reasoning; the card's page is a link from there and
// in the context menu.
private struct RankRow: View {
    let row: Answer.Row
    let markHeld: Bool
    let labels: Answer.Labels
    let expanded: Bool
    let toggle: () -> Void
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        Button(action: toggle) {
            VStack(alignment: .leading, spacing: 8) {
                line
                if expanded { details }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(expanded ? "Hides the details" : "Shows the details")
        .contextMenu {
            NavigationLink(value: Route.card(row.card.id)) {
                Label(labels.cardPage, systemImage: "creditcard")
            }
        } preview: {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(row.why, id: \.self) { Text($0) }
            }
            .font(.subheadline)
            .padding()
            .frame(width: 320, alignment: .leading)
        }
    }

    private var line: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if !size.isAccessibilitySize {
                CardArtView(art: row.card.art, width: 28)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
            }
            VStack(alignment: .leading, spacing: 3) {
                LedgerLine {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(row.card.shortName)
                            .font(.body.weight(.semibold))
                        if markHeld && row.card.held {
                            Text(labels.held)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tint)
                        }
                    }
                } figure: {
                    HStack(alignment: .lastTextBaseline, spacing: 5) {
                        if !row.warnings.isEmpty && !expanded {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.subheadline)
                                .foregroundStyle(Color.caution)
                                .accessibilityLabel("Has a note")
                        }
                        Text(row.rate)
                            .font(.figure(.title3, weight: .semibold))
                    }
                }
                Text(row.reason)
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(row.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Color.caution)
            }
            ForEach(row.lines, id: \.self) { line in
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(labels.why)
                .font(.footnote.weight(.semibold))
                .padding(.top, 2)
            ForEach(row.why, id: \.self) { line in
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            NavigationLink(value: Route.card(row.card.id)) {
                Label(labels.cardPage, systemImage: "creditcard")
                    .font(.footnote.weight(.semibold))
            }
            .buttonStyle(.borderless)
            .padding(.top, 2)
        }
        .padding(.leading, size.isAccessibilitySize ? 0 : 38)
        .transition(.opacity)
    }
}

private struct CreditRowView: View {
    let credit: Answer.Credit
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            CardArtView(art: credit.card.art, width: 44)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 8 }
            VStack(alignment: .leading, spacing: 3) {
                Text(credit.card.shortName)
                    .font(.body.weight(.semibold))
                Text(credit.text)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text(credit.amount)
                .font(.headline)
        }
        .accessibilityElement(children: .combine)
    }
}
