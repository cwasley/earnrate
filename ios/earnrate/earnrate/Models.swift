import Foundation

// What ios/engine/entry.ts returns. Swift only lays these out: every rate,
// rule and sentence in them comes from the engine.

struct CardArt: Decodable, Hashable {
    let color: String
    let chip: String
    let light: Bool
}

struct CardRow: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let shortName: String
    let issuer: String
    let fee: String
    let art: CardArt
    let held: Bool
}

struct Home: Decodable {
    let quick: [String]
}

struct Suggestion: Decodable, Hashable {
    enum Kind: String, Decodable {
        case store
        case place
    }

    let text: String
    let kind: Kind
}

struct Suggestions: Decodable {
    let suggestions: [Suggestion]
}

enum Scope: String, Codable, Hashable {
    case yours
    case every
}

struct PlaceKind: Decodable, Hashable, Identifiable {
    let key: String
    let label: String
    var id: String { key }
}

struct Answer: Decodable {
    struct Pick: Decodable {
        let cardId: String
        let label: String
        let name: String
        let detail: String
        let art: CardArt
    }

    struct Row: Decodable, Identifiable {
        let rank: Int
        let card: CardRow
        let rate: String
        let reason: String
        let lines: [String]
        let warnings: [String]
        let why: [String]
        var id: String { card.id }
    }

    struct Credit: Decodable, Identifiable {
        let card: CardRow
        let amount: String
        let text: String
        var id: String { card.id + text }
    }

    struct Kinds: Decodable {
        let prompt: String
        let quick: [PlaceKind]
        let more: [PlaceKind]
    }

    let title: String
    let subtitle: String?
    let scope: Scope
    let canChooseScope: Bool
    let scopeNote: String?
    let pick: Pick?
    let callouts: [String]
    let creditsTitle: String
    let credits: [Credit]
    let rankingTitle: String?
    let rows: [Row]
    let more: Int
    let moreLabel: String?
    let footer: [String]
    let kinds: Kinds?
    let kind: String?
}

struct CardGroups: Decodable {
    struct Group: Decodable, Identifiable {
        let issuer: String
        let cards: [CardRow]
        var id: String { issuer }
    }

    let groups: [Group]
}

struct WalletCards: Decodable {
    let cards: [CardRow]
    let problems: [String]
}

struct CardPage: Decodable {
    struct Offer: Decodable {
        let terms: String
        let asOf: String
        let again: String
        let note: String?
        let mayDiffer: String
    }

    let id: String
    let name: String
    let shortName: String
    let issuer: String
    let network: String
    let fee: String
    let foreignFee: String
    let art: CardArt
    let held: Bool
    let earning: [String]
    let ratesNote: String?
    let offer: Offer?
    let offerHistory: String?
    let credits: [String]
    let perks: [String]
    let feeWorth: String?
    let changes: [String]
    let checked: String
    let sources: [String]
}
