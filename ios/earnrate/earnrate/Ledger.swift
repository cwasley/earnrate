import SwiftUI

// The cheat sheet as a pocket card: one screenshot's worth of paper, each
// purchase a line with its rate and, under it, the card to use.
struct PocketCard: View {
    let sheet: WalletHome.Sheet
    let open: (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(sheet.title)
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Text("earnrate")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
            }
            Text(sheet.subtitle)
                .font(.footnote)
                .foregroundStyle(Color.inkSecondary)
                .padding(.top, 2)
            TearLine()
                .padding(.top, 12)
                .padding(.bottom, 4)
            ForEach(sheet.rows) { row in
                if let query = row.query {
                    Button {
                        open(query)
                    } label: {
                        PocketRow(row: row, opens: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(.isButton)
                } else {
                    PocketRow(row: row, opens: false)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 10)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(scheme == .dark ? 0.4 : 0.08), radius: 14, y: 6)
    }
}

private struct PocketRow: View {
    let row: WalletHome.Sheet.Row
    let opens: Bool

    var body: some View {
        HStack(spacing: 8) {
            lines
            // Kept, invisible, on a row that opens nothing, so the rates
            // stay in one column.
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.inkSecondary)
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .opacity(opens ? 1 : 0)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var lines: some View {
        VStack(alignment: .leading, spacing: 3) {
            // A purchase none of the cards earn on has no figure, so no dots.
            if row.rate.isEmpty {
                label
            } else {
                LedgerLine {
                    label
                } figure: {
                    Text(row.rate)
                        .font(.figure(.title3, weight: .semibold))
                        .foregroundStyle(.tint)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                if let art = row.art {
                    CardArtView(art: art, width: 22)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.name)
                        .font(.footnote)
                        .foregroundStyle(Color.inkSecondary)
                    if let accepts = row.accepts {
                        Text(accepts)
                            .font(.caption)
                            .foregroundStyle(Color.inkSecondary)
                    }
                    if let note = row.note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(Color.caution)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var label: some View {
        Text(row.label)
            .font(.body.weight(.medium))
    }
}
