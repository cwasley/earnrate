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
    // How this purchase is paid, for this answer only: never saved.
    @State private var payment: String?
    @State private var abroad = false
    @State private var recording: RecordTarget?

    private struct Key: Equatable {
        let scope: Scope?
        let kind: String?
        let all: Bool
        let payment: String?
        let abroad: Bool
        let revision: Int
    }

    var body: some View {
        Group {
            if let answer {
                AnswerList(
                    answer: answer,
                    scope: scopeBinding(answer),
                    kind: $kind,
                    all: $all,
                    payment: $payment,
                    abroad: $abroad,
                    used: { recording = $0 }
                )
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
        .task(id: Key(scope: scope, kind: kind, all: all, payment: payment, abroad: abroad, revision: model.revision)) {
            do {
                answer = try await model.answer(query, scope: scope, kind: kind, all: all, payment: payment, abroad: abroad)
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
        .sensoryFeedback(.selection, trigger: kind)
        .sensoryFeedback(.selection, trigger: scope)
        .sensoryFeedback(.selection, trigger: payment)
        .sensoryFeedback(.selection, trigger: abroad)
        .sheet(item: $recording) { target in
            if let ask = answer?.record {
                RecordSheet(target: target, ask: ask, store: answer?.title ?? query, query: query, kind: kind)
            }
        }
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
    @Binding var payment: String?
    @Binding var abroad: Bool
    let used: (RecordTarget) -> Void
    @State private var open: Set<String> = []

    private func canRecord(_ id: String) -> Bool {
        answer.record?.cards.contains(id) == true
    }

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
                    FlowLayout(spacing: 8) {
                        if let subtitle = answer.subtitle {
                            // Sized like ChipLabel so it lines up with the menu beside it.
                            Text(subtitle)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Color.inkSecondary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(Color.surface.opacity(0.9), in: Capsule())
                        }
                        PurchaseMenu(options: answer.purchase, payment: $payment, abroad: $abroad)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // What kind of place it is comes before a pick that
                    // only knows base rates, and stays there once tapped.
                    if let kinds = answer.kinds {
                        KindsAsk(kinds: kinds, kind: $kind)
                    }
                    if let pick = answer.pick {
                        AnswerHero(pick: pick, behind: Array(answer.rows.prefix(3)))
                        PickText(pick: pick)
                        if let ask = answer.record, canRecord(pick.cardId) {
                            UsedButton(label: ask.label, name: pick.name) {
                                used(RecordTarget(cardId: pick.cardId, name: pick.name, art: pick.art))
                            }
                        }
                    } else if let verdict = answer.verdict {
                        VerdictText(verdict: verdict)
                    }
                }
                .textCase(nil)
                .padding(.bottom, 8)
            } footer: {
                if let note = answer.scopeNote {
                    Text(note).foregroundStyle(Color.inkSecondary)
                }
            }

            if !answer.purchase.hints.isEmpty {
                Section {
                    ForEach(answer.purchase.hints) { hint in
                        Button {
                            payment = hint.payment
                        } label: {
                            Label(hint.text, systemImage: "wave.3.right")
                                .font(.subheadline)
                        }
                    }
                }
                .surfaceRows()
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
                            usedLabel: canRecord(row.card.id) ? answer.record?.label : nil,
                            expanded: open.contains(row.id),
                            toggle: { toggle(row.id) },
                            used: { used(RecordTarget(cardId: row.card.id, name: row.card.shortName, art: row.card.art)) }
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

// A store earnrate doesn't know: why only base rates apply, then the kinds
// of places to tap.
private struct KindsAsk: View {
    let kinds: Answer.Kinds
    @Binding var kind: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let lead = kinds.lead {
                Text(lead)
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
            }
            Text(kinds.prompt)
                .font(.headline)
                .foregroundStyle(Color.primary)
                .accessibilityAddTraits(.isHeader)
            KindChips(kinds: kinds, kind: $kind)
        }
        .multilineTextAlignment(.leading)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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
        .endsList()
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
            if let because = pick.because {
                Text(because)
                    .font(.footnote)
                    .foregroundStyle(Color.primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.top, 6)
            }
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

// "None of your cards work here.", where the pick would be; the reason is
// the first line under it.
private struct VerdictText: View {
    let verdict: String

    var body: some View {
        Label {
            Text(verdict)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.primary)
        } icon: {
            Image(systemName: "creditcard.trianglebadge.exclamationmark")
                .foregroundStyle(Color.caution)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

// A ranked card in a line: name, rule and rate. A tap shows what earning it
// takes and the engine's reasoning; the card's page is a link from there and
// in the context menu.
private struct RankRow: View {
    let row: Answer.Row
    let markHeld: Bool
    let labels: Answer.Labels
    let usedLabel: String?
    let expanded: Bool
    let toggle: () -> Void
    let used: () -> Void
    @Environment(\.dynamicTypeSize) private var size

    // The details sit beside the toggle, not inside it: inside, the toggle
    // took the Card page tap and only folded the row.
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
            if let usedLabel {
                Button(action: used) {
                    Label(usedLabel, systemImage: "checkmark.circle")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("\(usedLabel): \(row.card.shortName)")
                .padding(.top, 2)
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
