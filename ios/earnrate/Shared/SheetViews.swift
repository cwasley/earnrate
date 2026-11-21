import SwiftUI
import WidgetKit

// What the widgets draw, from the sheet the app wrote. Here rather than in
// the widget extension so the app's debug builds can draw them too; the
// widgets pass their family in.

struct CheatSheetView: View {
    let sheet: WidgetSnapshot.Sheet?
    let family: WidgetFamily
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if let sheet {
            switch family {
            case .systemMedium: medium(sheet)
            default: small(sheet)
            }
        } else {
            WaitingView()
        }
    }

    // The quarter and the first few purchases; a tap opens the cheat sheet.
    private func small(_ sheet: WidgetSnapshot.Sheet) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            SheetHeading(sheet: sheet, compact: true)
            ForEach(sheet.rows.prefix(size.isAccessibilitySize ? 1 : size >= .xLarge ? 2 : 3)) { row in
                SheetRow(row: row, compact: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(AppLink.sheet.url)
    }

    // The pocket card: six purchases in two columns, each opening its answer.
    private func medium(_ sheet: WidgetSnapshot.Sheet) -> some View {
        let columns = size.isAccessibilitySize ? 1 : 2
        let perColumn = size >= .xLarge ? 2 : 3
        let rows = Array(sheet.rows.prefix(columns * perColumn))
        return VStack(alignment: .leading, spacing: 6) {
            SheetHeading(sheet: sheet, compact: false)
            HStack(alignment: .top, spacing: 16) {
                ForEach(0..<columns, id: \.self) { column in
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(rows.dropFirst(column * perColumn).prefix(perColumn)) { row in
                            if let query = row.query {
                                Link(destination: AppLink.answer(query).url) { SheetRow(row: row, compact: false) }
                            } else {
                                SheetRow(row: row, compact: false)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(AppLink.sheet.url)
    }
}

private struct SheetHeading: View {
    let sheet: WidgetSnapshot.Sheet
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if compact {
                    Text(sheet.quarter)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color("AccentColor"))
                } else {
                    Text(sheet.title)
                        .font(.subheadline.bold())
                    Text("\(sheet.quarter) · \(sheet.scope)")
                        .font(.caption2)
                        .foregroundStyle(Color.inkSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Text("earnrate")
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .foregroundStyle(Color("AccentColor"))
                    .accessibilityHidden(true)
            }
            TearLine()
        }
    }
}

// "Groceries ···· 4%" with the card under it, as on the pocket card. A row
// no card earns on (Costco without a Visa) has no figure, so no dots.
private struct SheetRow: View {
    let row: WidgetSnapshot.Row
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if row.rate.isEmpty {
                label
            } else {
                LedgerLine {
                    label
                } figure: {
                    Text(row.rate)
                        .font(.figure(.subheadline, weight: .semibold))
                        .foregroundStyle(Color("AccentColor"))
                }
            }
            HStack(spacing: 5) {
                if !compact, let art = row.art {
                    CardDrawing(art: art)
                        .frame(width: 16)
                }
                Text(row.name)
                    .font(.caption2)
                    .foregroundStyle(Color.inkSecondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var label: some View {
        Text(row.label)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
    }
}

// Before the app has written a sheet: it does on its first launch.
private struct WaitingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("earnrate")
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(Color("AccentColor"))
            Text("Open earnrate to see your cheat sheet here.")
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// One purchase on the Lock Screen: "Groceries 4%" over the card, or in one
// line beside the clock.
struct PurchaseView: View {
    let row: WidgetSnapshot.Row?
    let family: WidgetFamily

    var body: some View {
        Group {
            if let row {
                switch family {
                case .accessoryInline:
                    Text(row.line)
                default:
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(row.label)
                                .font(.headline)
                                .widgetAccentable()
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Text(row.rate)
                                .font(.figure(.headline))
                                .widgetAccentable()
                        }
                        Text(row.name)
                            .font(.body)
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            } else {
                Text("earnrate")
            }
        }
        .widgetURL(row?.query.map { AppLink.answer($0).url } ?? AppLink.sheet.url)
    }
}
