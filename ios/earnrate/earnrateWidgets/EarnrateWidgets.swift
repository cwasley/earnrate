import AppIntents
import SwiftUI
import WidgetKit

// The cheat sheet on the Home Screen and the Lock Screen. The widgets never
// run the engine: they read the sheet the app last wrote (SharedSheet), for
// this quarter and the next, and switch to the next on the day it starts.
@main struct EarnrateWidgets: WidgetBundle {
    var body: some Widget {
        CheatSheetWidget()
        PurchaseWidget()
    }
}

// MARK: Timelines

struct SheetEntry: TimelineEntry {
    let date: Date
    let sheet: WidgetSnapshot.Sheet?
    var empty: WidgetSnapshot.Empty? = nil
}

enum SheetTimeline {
    // An entry now, and one at the start of each sheet still to come; read
    // again the day after the last one ends, in case the app hasn't been
    // opened since. With no cards saved there's no sheet, only what to say;
    // the app reloads the widgets once cards are added.
    static func entries(now: Date = .now) -> ([SheetEntry], TimelineReloadPolicy) {
        guard let snapshot = SharedSheet.read() else { return ([SheetEntry(date: now, sheet: nil)], .never) }
        if snapshot.sheets.isEmpty { return ([SheetEntry(date: now, sheet: nil, empty: snapshot.empty)], .never) }
        let today = Day.text(now)
        var entries = [SheetEntry(date: now, sheet: snapshot.sheet(on: today))]
        for sheet in snapshot.sheets where sheet.from > today {
            if let starts = Day.date(sheet.from) { entries.append(SheetEntry(date: starts, sheet: sheet)) }
        }
        let after = snapshot.sheets.last.flatMap { Day.date($0.until) }
            .flatMap { Calendar.current.date(byAdding: .day, value: 1, to: $0) }
        return (entries, after.map { .after($0) } ?? .never)
    }
}

struct SheetProvider: TimelineProvider {
    func placeholder(in context: Context) -> SheetEntry {
        SheetEntry(date: .now, sheet: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (SheetEntry) -> Void) {
        completion(SheetTimeline.entries().0.first ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SheetEntry>) -> Void) {
        let (entries, policy) = SheetTimeline.entries()
        completion(Timeline(entries: entries, policy: policy))
    }
}

// MARK: Home Screen

struct CheatSheetWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CheatSheet", provider: SheetProvider()) { entry in
            FamilyReader { CheatSheetView(sheet: entry.sheet, empty: entry.empty, family: $0) }
                .containerBackground(Color.surface, for: .widget)
        }
        .configurationDisplayName("Cheat sheet")
        .description("The card to use for each everyday purchase.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: Lock Screen

// One purchase from the sheet, picked when the widget is added: "Groceries".
struct PurchaseEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Purchase")
    static let defaultQuery = PurchaseQuery()

    let id: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(id)")
    }
}

struct PurchaseQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [PurchaseEntity] {
        identifiers.map(PurchaseEntity.init)
    }

    func suggestedEntities() async throws -> [PurchaseEntity] {
        (SharedSheet.read()?.purchaseLabels ?? []).map(PurchaseEntity.init)
    }

    func defaultResult() async -> PurchaseEntity? {
        try? await suggestedEntities().first
    }
}

struct PurchaseChoice: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Purchase"
    static let description = IntentDescription("The card to use for one kind of purchase.")

    @Parameter(title: "Purchase")
    var purchase: PurchaseEntity?
}

struct PurchaseEntry: TimelineEntry {
    let date: Date
    let row: WidgetSnapshot.Row?
    var empty: WidgetSnapshot.Empty? = nil
}

struct PurchaseProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> PurchaseEntry {
        PurchaseEntry(date: .now, row: nil)
    }

    func snapshot(for configuration: PurchaseChoice, in context: Context) async -> PurchaseEntry {
        await timeline(for: configuration, in: context).entries.first ?? placeholder(in: context)
    }

    func timeline(for configuration: PurchaseChoice, in context: Context) async -> Timeline<PurchaseEntry> {
        let (entries, policy) = SheetTimeline.entries()
        let label = configuration.purchase?.id
        return Timeline(entries: entries.map { entry in
            let rows = entry.sheet?.rows ?? []
            return PurchaseEntry(date: entry.date, row: rows.first { $0.label == label } ?? rows.first, empty: entry.empty)
        }, policy: policy)
    }
}

struct PurchaseWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "Purchase", intent: PurchaseChoice.self, provider: PurchaseProvider()) { entry in
            FamilyReader { PurchaseView(row: entry.row, empty: entry.empty, family: $0) }
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Card for a purchase")
        .description("The card to use for groceries, gas or another everyday purchase.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

// Hands the widget's family to the views, which the app's debug builds
// also draw (Shared/SheetViews.swift).
private struct FamilyReader<Content: View>: View {
    @Environment(\.widgetFamily) private var family
    @ViewBuilder let content: (WidgetFamily) -> Content

    var body: some View {
        content(family)
    }
}