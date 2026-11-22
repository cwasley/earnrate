import SwiftUI
import WidgetKit

// What the widgets draw, from the sheet the app wrote. Here rather than in
// the widget extension so the app's debug builds can draw them too; the
// widgets pass their family in.

struct CheatSheetView: View {
    let sheet: WidgetSnapshot.Sheet?
    var empty: WidgetSnapshot.Empty? = nil
    let family: WidgetFamily
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if let sheet {
            switch family {
            case .systemMedium: medium(sheet)
            default: small(sheet)
            }
        } else {
            WaitingView(text: empty?.text)
        }
    }

    // A purchase none of the cards earn on ("Costco: None of your cards")
    // would take one of a few places; the app's sheet still shows it.
    private func earning(_ sheet: WidgetSnapshot.Sheet) -> [WidgetSnapshot.Row] {
        sheet.rows.filter { !$0.rate.isEmpty }
    }

    // The quarter and the first few purchases; a tap opens the cheat sheet.
    private func small(_ sheet: WidgetSnapshot.Sheet) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            SheetHeading(sheet: sheet, compact: true)
            ForEach(earning(sheet).prefix(size.isAccessibilitySize ? 1 : size >= .xLarge ? 2 : 3)) { row in
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
        let rows = Array(earning(sheet).prefix(columns * perColumn))
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
                CardName(row: row)
                    .font(.caption2)
                    .foregroundStyle(Color.inkSecondary)
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

// The card's name on one line, or its shorter name where that doesn't fit:
// "Sapphire Preferred" for Chase Sapphire Preferred. VoiceOver says the
// whole name.
private struct CardName: View {
    let row: WidgetSnapshot.Row

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(row.name)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            Text(row.short ?? row.name)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
    }
}

// Before the app has written a sheet (it does on its first launch), or with
// no cards saved, when the engine says what to do instead.
private struct WaitingView: View {
    var text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("earnrate")
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(Color("AccentColor"))
            Text(text ?? "Open earnrate to see your cheat sheet here.")
                .font(.caption)
                .foregroundStyle(Color.inkSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(AppLink.sheet.url)
    }
}

// One purchase on the Lock Screen: "Groceries 4%" over the card, or in one
// line beside the clock.
struct PurchaseView: View {
    let row: WidgetSnapshot.Row?
    var empty: WidgetSnapshot.Empty? = nil
    let family: WidgetFamily

    var body: some View {
        Group {
            if let row {
                switch family {
                case .accessoryInline:
                    ViewThatFits(in: .horizontal) {
                        Text(row.line)
                            .fixedSize(horizontal: true, vertical: false)
                        Text(row.shortLine ?? row.line)
                    }
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
                        CardName(row: row)
                            .font(.body)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            } else if let empty {
                switch family {
                case .accessoryInline:
                    Text(empty.short)
                default:
                    VStack(alignment: .leading, spacing: 0) {
                        Text("earnrate")
                            .font(.headline)
                            .widgetAccentable()
                        Text(empty.short)
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
