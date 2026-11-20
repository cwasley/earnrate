import SwiftUI

extension Font {
    // Rates and totals: rounded, with figures that line up.
    static func figure(_ style: Font.TextStyle, weight: Font.Weight = .bold) -> Font {
        .system(style, design: .rounded, weight: weight).monospacedDigit()
    }
}

// The dotted line between a name and its figure.
struct Leader: View {
    var body: some View {
        StraightLine()
            .stroke(Color.inkSecondary.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [0.1, 5]))
            .frame(height: 2)
            .frame(minWidth: 12)
            .alignmentGuide(.lastTextBaseline) { $0[.bottom] + 2 }
            .accessibilityHidden(true)
    }
}

private struct StraightLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 1, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.midY))
        return path
    }
}

// A dashed rule, like the tear line on a receipt.
struct TearLine: View {
    var body: some View {
        StraightLine()
            .stroke(Color.inkSecondary.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

// "Groceries ········ 4%": a name, the dots, and a figure. At the
// accessibility text sizes the figure goes under the name and the dots go.
struct LedgerLine<Name: View, Figure: View>: View {
    @ViewBuilder let name: () -> Name
    @ViewBuilder let figure: () -> Figure
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 2) {
                name()
                figure()
            }
        } else {
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                name()
                    .layoutPriority(1)
                Leader()
                figure()
                    .fixedSize()
            }
        }
    }
}

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
                        PocketRow(row: row)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(.isButton)
                } else {
                    PocketRow(row: row)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 10)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(alignment: .topLeading) {
            UnevenRoundedRectangle(bottomLeadingRadius: 2, bottomTrailingRadius: 2)
                .fill(.tint)
                .frame(width: 36, height: 4)
                .padding(.leading, 18)
                .accessibilityHidden(true)
        }
        .shadow(color: .black.opacity(scheme == .dark ? 0.4 : 0.08), radius: 14, y: 6)
    }
}

private struct PocketRow: View {
    let row: WalletHome.Sheet.Row

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            LedgerLine {
                Text(row.label)
                    .font(.body.weight(.medium))
            } figure: {
                Text(row.rate)
                    .font(.figure(.title3, weight: .semibold))
                    .foregroundStyle(.tint)
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
                    if let note = row.note {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(Color.caution)
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
