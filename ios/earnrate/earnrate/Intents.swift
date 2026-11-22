import AppIntents
import CoreSpotlight
import SwiftUI

// Siri, Shortcuts and Spotlight. "Which card at Costco in earnrate" runs in
// the app's own process without opening it: the engine answers on the
// phone, and Siri says the engine's sentence over a snippet of the pick.

// A store or a kind of purchase, as the store search knows it: its id is
// the words searched for ("Whole Foods Market", "Groceries").
struct StoreEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Store")
    static let defaultQuery = StoreQuery()

    let id: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(id)")
    }
}

struct StoreQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [StoreEntity] {
        identifiers.map { StoreEntity(id: $0) }
    }

    // The store search's matches, and what was said when it matches none,
    // so a store earnrate doesn't know still gets its base-rate answer.
    func entities(matching string: String) async throws -> [StoreEntity] {
        let asked = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !asked.isEmpty else { return [] }
        let found = await AppModel.shared.suggest(asked).map { StoreEntity(id: $0.text) }
        let named = found.contains { $0.id.caseInsensitiveCompare(asked) == .orderedSame }
        return named ? found : found + [StoreEntity(id: asked)]
    }

    func suggestedEntities() async throws -> [StoreEntity] {
        await AppModel.shared.suggestedStores().map { StoreEntity(id: $0) }
    }
}

// A card in My wallet, for Spotlight.
struct CardEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Card")
    static let defaultQuery = CardQuery()

    let id: String
    var name: String
    var issuer: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(issuer)")
    }
}

struct CardQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [CardEntity] {
        let held = await AppModel.shared.walletCards
        return identifiers.map { id in
            let row = held.first { $0.id == id }
            return CardEntity(id: id, name: row?.shortName ?? id, issuer: row?.issuer ?? "")
        }
    }

    func suggestedEntities() async throws -> [CardEntity] {
        await AppModel.shared.walletCards.map { CardEntity(id: $0.id, name: $0.shortName, issuer: $0.issuer) }
    }
}

struct WhichCardIntent: AppIntent {
    static let title: LocalizedStringResource = "Which Card at a Store"
    static let description = IntentDescription("Finds the card that earns the most at a store or on a kind of purchase. It picks from your cards, or from every card until you add yours.")
    static let supportedModes: IntentModes = .background
    // The wallet is saved with complete file protection, readable only
    // while the phone is unlocked.
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @Parameter(title: "Store", requestValueDialog: "Which store?")
    var store: StoreEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Which card at \(\.$store)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let brief = try await AppModel.shared.brief(store.id)
        await AppModel.shared.remember(store.id)
        return .result(value: brief.spoken, dialog: IntentDialog(stringLiteral: brief.spoken), view: BriefSnippet(brief: brief))
    }
}

struct OpenStoreIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open a Store's Answer"

    @Parameter(title: "Store")
    var target: StoreEntity

    func perform() async throws -> some IntentResult {
        await AppModel.shared.go(.link(.answer(target.id)))
        return .result()
    }
}

struct OpenCardIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open a Card"

    @Parameter(title: "Card")
    var target: CardEntity

    func perform() async throws -> some IntentResult {
        await AppModel.shared.go(.card(target.id))
        return .result()
    }
}

struct EarnrateShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WhichCardIntent(),
            phrases: [
                "Which card at \(\.$store) in \(.applicationName)",
                "Which card for \(\.$store) in \(.applicationName)",
                "Best card at \(\.$store) in \(.applicationName)",
                "Ask \(.applicationName) which card to use at \(\.$store)",
                "Which card should I use in \(.applicationName)",
                "Ask \(.applicationName) which card to use",
            ],
            shortTitle: "Which Card",
            systemImageName: "creditcard"
        )
    }

    static let shortcutTileColor: ShortcutTileColor = .orange
}

// Siri's answer under what it says: the place, the pick and its rate, and
// the rule behind it, every word of it the engine's.
struct BriefSnippet: View {
    let brief: Brief
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(brief.title)
                    .font(.headline)
                Spacer(minLength: 8)
                Text("earnrate")
                    .font(.system(.footnote, design: .rounded, weight: .bold))
                    .foregroundStyle(Color("AccentColor"))
                    .accessibilityHidden(true)
            }
            if let subtitle = brief.subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(Color.inkSecondary)
            }
            if let name = brief.name {
                TearLine()
                if let label = brief.label {
                    Text(label)
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .tracking(1)
                        .foregroundStyle(Color("AccentColor"))
                }
                let layout = size.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
                layout { pick(name) }
                if let reason = brief.reason {
                    Text(reason)
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSecondary)
                }
            }
            if let note = brief.note {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func pick(_ name: String) -> some View {
        if let art = brief.art {
            CardDrawing(art: art)
                .frame(width: 56)
        }
        Text(name)
            .font(.title3.weight(.semibold))
            .layoutPriority(1)
        if !size.isAccessibilitySize { Spacer(minLength: 8) }
        if let detail = brief.detail {
            Text(detail)
                .font(.figure(.title2))
                .foregroundStyle(Color.primary)
                .fixedSize()
        }
    }
}

// What the app hands Spotlight: every store and kind of purchase, so
// searching one opens its answer, and the cards in My wallet. Indexed on
// the phone.
enum Spotlight {
    // Stores go in as plain items whose id is the answer's link, opened by
    // the app's Spotlight handler. As StoreEntity, the Siri shortcut's
    // parameter, a tapped store didn't open its answer.
    @discardableResult
    static func index(places: [Places.Place]) async -> Bool {
        let index = CSSearchableIndex.default()
        // Clears stores dropped from the data, and the cards (indexed next).
        try? await index.deleteAllSearchableItems()
        let items = places.map { place in
            let set = CSSearchableItemAttributeSet(contentType: .content)
            set.title = place.text
            set.contentDescription = place.detail
            set.keywords = place.keywords
            return CSSearchableItem(uniqueIdentifier: AppLink.answer(place.text).url.absoluteString, domainIdentifier: "places", attributeSet: set)
        }
        return (try? await index.indexSearchableItems(items)) != nil
    }

    static func link(_ activity: NSUserActivity) -> AppLink? {
        guard let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              let url = URL(string: id)
        else { return nil }
        return AppLink(url)
    }

    static func index(cards: [CardRow]) async {
        let index = CSSearchableIndex.default()
        try? await index.deleteAppEntities(ofType: CardEntity.self)
        let entities = cards.map { CardEntity(id: $0.id, name: $0.shortName, issuer: $0.issuer) }
        if !entities.isEmpty { try? await index.indexAppEntities(entities) }
    }
}

#Preview("Siri answer") {
    BriefSnippet(brief: Brief(
        query: "Whole Foods",
        title: "Whole Foods Market",
        subtitle: "Counts as a supermarket",
        label: "Use",
        name: "Amex Gold",
        detail: "4% back",
        reason: "4x Amex Membership Rewards at supermarkets",
        art: CardArt(color: "#d4af6a", chip: "#d9c08a", light: true),
        note: nil,
        spoken: "Use Amex Gold at Whole Foods Market. It earns 4% back, 4x Amex Membership Rewards at supermarkets."
    ))
    .padding()
}
