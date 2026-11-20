import SwiftUI

// One store or category's answer: the pick, then the ranking.
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
        let cards: [String]
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
        .navigationTitle(query)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: Key(scope: scope, kind: kind, all: all, cards: model.walletCards.map(\.id))) {
            do {
                answer = try await model.answer(query, scope: scope, kind: kind, all: all)
                failure = nil
            } catch {
                failure = error.localizedDescription
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

    var body: some View {
        List {
            Section {
                if let pick = answer.pick {
                    NavigationLink(value: Route.card(pick.cardId)) {
                        PickRow(pick: pick)
                    }
                }
            } header: {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(answer.title)
                            .font(.title2.bold())
                            .foregroundStyle(Color.primary)
                            .accessibilityAddTraits(.isHeader)
                        if let subtitle = answer.subtitle {
                            Text(subtitle)
                                .font(.subheadline)
                                .foregroundStyle(Color.secondary)
                        }
                    }
                    if answer.canChooseScope {
                        Picker("Which cards", selection: $scope) {
                            Text("Your cards").tag(Scope.yours)
                            Text("Every card").tag(Scope.every)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .textCase(nil)
                .padding(.bottom, 4)
            } footer: {
                if let note = answer.scopeNote { Text(note) }
            }

            if !answer.callouts.isEmpty {
                Section {
                    ForEach(answer.callouts, id: \.self) { line in
                        Label {
                            Text(line)
                        } icon: {
                            Image(systemName: "info.circle").foregroundStyle(.orange)
                        }
                        .font(.subheadline)
                    }
                }
            }

            if let kinds = answer.kinds {
                Section(kinds.prompt) {
                    Picker("Kind of place", selection: $kind) {
                        Text("Not sure").tag(String?.none)
                        ForEach(kinds.quick) { k in
                            Text(k.label).tag(String?.some(k.key))
                        }
                        Section("Something else") {
                            ForEach(kinds.more) { k in
                                Text(k.label).tag(String?.some(k.key))
                            }
                        }
                    }
                    .pickerStyle(.menu)
                }
            }

            if !answer.credits.isEmpty {
                Section(answer.creditsTitle) {
                    ForEach(answer.credits) { credit in
                        NavigationLink(value: Route.card(credit.card.id)) {
                            CreditRowView(credit: credit)
                        }
                    }
                }
            }

            if !answer.rows.isEmpty {
                Section {
                    ForEach(answer.rows) { row in
                        NavigationLink(value: Route.card(row.card.id)) {
                            RankRow(row: row, markHeld: answer.scope == .every)
                        }
                    }
                    if let more = answer.moreLabel {
                        Button(more) { all = true }
                    }
                } header: {
                    if let title = answer.rankingTitle { Text(title) }
                } footer: {
                    Footer(lines: answer.footer)
                }
            } else if !answer.footer.isEmpty {
                Section {
                } footer: {
                    Footer(lines: answer.footer)
                }
            }
        }
        .listSectionSpacing(.compact)
    }
}

private struct Footer: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(lines, id: \.self) { Text($0) }
        }
        .padding(.top, 8)
    }
}

private struct PickRow: View {
    let pick: Answer.Pick
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(spacing: 16))
        layout {
            CardArtView(art: pick.art, width: 86)
            VStack(alignment: .leading, spacing: 2) {
                Text(pick.label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(pick.name)
                    .font(.title3.bold())
                Text(pick.detail)
                    .font(.headline)
                    .foregroundStyle(.tint)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

private struct RankRow: View {
    let row: Answer.Row
    let markHeld: Bool
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                CardArtView(art: row.card.art, width: 44)
                Text(row.rate)
                    .font(.title3.weight(.semibold).monospacedDigit())
                details
            }
            .accessibilityElement(children: .combine)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                CardArtView(art: row.card.art, width: 44)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 8 }
                details
                Spacer(minLength: 8)
                Text(row.rate)
                    .font(.title3.weight(.semibold).monospacedDigit())
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.card.shortName)
                    .font(.body.weight(.semibold))
                if markHeld && row.card.held {
                    Text("Yours")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            Text(row.reason)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ForEach(row.lines, id: \.self) { line in
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(row.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
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
