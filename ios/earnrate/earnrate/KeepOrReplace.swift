import SwiftUI

// Keep or replace, on a saved fee card's page beside whether its fee is
// worth it: what the card adds to the wallet after its fee, and which
// cheaper cards would keep the most of that. Asked for first, as the site's
// card settings do, since it weighs many cards; worked out on the typical
// month, and it says so.
struct KeepOrReplaceSection: View {
    @Environment(AppModel.self) private var model
    let id: String
    let keep: CardPage.Keep

    @State private var asked = false
    @State private var answer: KeepAnswer?
    @State private var done = false
    @State private var open: String?

    var body: some View {
        Section {
            if !asked {
                VStack(alignment: .leading, spacing: 10) {
                    Text(keep.lead)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button(keep.button) {
                        asked = true
                    }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                }
                .padding(.vertical, 4)
            } else if let answer {
                content(answer)
            } else if !done {
                ProgressView()
                    .frame(maxWidth: .infinity)
            }
        } header: {
            SectionTitle(keep.title)
        }
        .task(id: asked ? model.revision : -1) {
            guard asked else { return }
            answer = try? await model.keepOrReplace(id)
            done = true
        }
        .sensoryFeedback(.selection, trigger: open)
    }

    @ViewBuilder
    private func content(_ k: KeepAnswer) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(k.lead)
                .font(.subheadline.weight(.semibold))
            if let saved = k.saved {
                Text(saved)
                    .font(.subheadline)
            }
        }
        .padding(.vertical, 2)
        if let unsaid = k.unsaid {
            VStack(alignment: .leading, spacing: 6) {
                Text(unsaid)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                NavigationLink(value: Route.settings(id, .credits)) {
                    Text(k.unsaidButton)
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.borderless)
            }
        }
        ForEach(k.replacements) { r in
            ReplacementRow(row: r, cardPage: k.cardPage, expanded: open == r.id) {
                withAnimation(.snappy) { open = open == r.id ? nil : r.id }
            }
        }
        ForEach(k.notes, id: \.self) { note in
            Text(note)
                .font(.footnote)
        }
        VStack(alignment: .leading, spacing: 6) {
            ForEach(k.members, id: \.self) { Text($0) }
            Text(k.math)
            Text(k.perks)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        DisclosureGroup(k.assumesTitle) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(k.assumes, id: \.self) { Text($0) }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .font(.subheadline)
    }
}

// A cheaper card: name, how much it keeps, and what it would add a year. A
// tap shows the rest, with its card page.
private struct ReplacementRow: View {
    let row: KeepAnswer.Replacement
    let cardPage: String
    let expanded: Bool
    let toggle: () -> Void
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: toggle) {
                line.contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? "Hides the details" : "Shows the details")
            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    Text(row.detail)
                    ForEach(row.extras, id: \.self) { Text($0) }
                    NavigationLink(value: Route.card(row.card.id)) {
                        Label(cardPage, systemImage: "creditcard")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tint)
                    }
                    .buttonStyle(.borderless)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.leading, size.isAccessibilitySize ? 0 : 42)
                .transition(.opacity)
            }
        }
    }

    private var line: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if !size.isAccessibilitySize {
                CardArtView(art: row.card.art, width: 32)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 4 }
            }
            VStack(alignment: .leading, spacing: 3) {
                LedgerLine {
                    Text(row.card.shortName)
                        .font(.body.weight(.semibold))
                } figure: {
                    HStack(alignment: .lastTextBaseline, spacing: 1) {
                        Text(row.net)
                            .font(.figure(.title3, weight: .semibold))
                        Text(row.per)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(row.short)
                    .font(.subheadline)
                    .foregroundStyle(Color.inkSecondary)
                if let same = row.samePoints {
                    Text(same)
                        .font(.caption)
                        .foregroundStyle(Color.inkSecondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
