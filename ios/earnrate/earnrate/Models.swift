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
    struct Welcome: Decodable {
        let title: String
        let lead: String
        let privacy: String
        let add: String
        let skip: String
        let art: [CardArt]
    }

    struct Nudge: Decodable {
        let text: String
        let button: String
    }

    struct StartNote: Decodable {
        let yours: String
        let every: String
    }

    struct Working: Decodable {
        let setups: String
    }

    let quick: [String]
    let months: [String]
    let welcome: Welcome
    let nudge: Nudge
    let startNote: StartNote
    let working: Working
    let held: String
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
        let reason: String
        let warnings: [String]
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
        let lead: String?
        let prompt: String
        let quick: [PlaceKind]
        let moreLabel: String
        let more: [PlaceKind]
        let clear: String
    }

    struct Labels: Decodable {
        let yours: String
        let every: String
        let why: String
        let cardPage: String
        let held: String
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
    let labels: Labels
}

struct CardGroups: Decodable {
    struct Group: Decodable, Identifiable {
        let id: String
        let title: String
        let index: String
        let cards: [CardRow]
    }

    let quickTitle: String
    let quick: [CardRow]
    let groups: [Group]
    let searchPrompt: String
}

struct WalletCards: Decodable {
    let cards: [CardRow]
    let problems: [String]
}

struct Removal: Decodable {
    let title: String
    let remove: String
    let keep: String?
}

// Setup after adding cards, and a card's settings, share these.

struct OnOff: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let on: Bool
}

struct TierMenu: Decodable, Identifiable {
    struct Option: Decodable, Identifiable, Hashable {
        let id: String
        let label: String
    }

    let id: String
    let label: String
    let none: String
    let options: [Option]
    let selected: String?
}

struct PickGroup: Decodable, Identifiable {
    struct Option: Decodable, Identifiable, Hashable {
        let id: String
        let label: String
        let on: Bool
        let enabled: Bool
    }

    struct Info: Decodable, Hashable {
        let question: String
        let answer: String
    }

    let choice: String
    let legend: String
    let count: String
    let single: Bool
    let options: [Option]
    let info: [Info]
    var id: String { choice }
}

struct ActivationRow: Decodable, Identifiable {
    let rule: String
    let label: String
    let on: Bool
    let opens: String?
    var id: String { rule }
}

struct Setup: Decodable {
    struct Card: Decodable, Identifiable {
        let card: CardRow
        let picks: [PickGroup]
        let activations: [ActivationRow]
        let activationsTitle: String
        let notes: [String]
        var id: String { card.id }
    }

    struct Memberships: Decodable {
        let title: String
        let toggles: [OnOff]
        let menus: [TierMenu]
    }

    let title: String
    let lead: String
    let cards: [Card]
    let memberships: Memberships?
    struct Asked: Codable {
        let picks: [String]
        let activations: [String]
        let memberships: [String]

        var json: [String: Any] {
            ["picks": picks, "activations": activations, "memberships": memberships]
        }
    }

    let skip: String
    let done: String
    let asked: Asked

    var asksAnything: Bool { !cards.isEmpty || memberships != nil }
}

enum SettingsFocus: String, Decodable, Hashable {
    case picks
    case activations
    case credits
    case bonus
    case anniversary
}

struct WalletHome: Decodable {
    struct Todo: Decodable, Identifiable {
        let id: String
        let cardId: String
        let art: CardArt
        let title: String
        let detail: String
        let when: String?
        let button: String?
        let url: String?
        let focus: SettingsFocus?
    }

    struct Note: Decodable, Hashable {
        let text: String
        let button: String?
        let url: String?
    }

    struct Sheet: Decodable {
        struct Row: Decodable, Identifiable {
            let label: String
            let query: String?
            let cardId: String?
            let name: String
            let rate: String
            let note: String?
            let art: CardArt?
            var id: String { label }
        }

        let title: String
        let subtitle: String
        let rows: [Row]
    }

    struct Held: Decodable, Identifiable {
        let card: CardRow
        let note: String?
        let ask: Bool
        let action: String
        var id: String { card.id }
    }

    struct Past: Decodable {
        let title: String
        let count: String
    }

    let searchPrompt: String
    let todoTitle: String
    let todoShown: Int
    let todoMore: String?
    let todoFewer: String
    let todo: [Todo]
    let notes: [Note]
    let sheet: Sheet?
    let cardsTitle: String
    let cards: [Held]
    let addCards: String
    let past: Past
    let settings: String
    let problems: [String]

    static let empty = WalletHome(
        searchPrompt: "", todoTitle: "", todoShown: 3, todoMore: nil, todoFewer: "", todo: [], notes: [], sheet: nil, cardsTitle: "",
        cards: [], addCards: "", past: Past(title: "", count: ""), settings: "", problems: []
    )
}

struct CardSettings: Decodable {
    struct Credits: Decodable {
        struct Tile: Decodable, Identifiable {
            let id: String
            let name: String
            let worth: String?
            let answer: String?
            let state: String
        }

        struct Detail: Decodable, Identifiable {
            struct Used: Decodable {
                let label: String
                let value: Double
                let max: Double
            }

            struct Night: Decodable {
                let label: String
                let value: Double?
                let placeholder: String
            }

            let id: String
            let name: String
            let text: String
            let used: Used?
            let night: Night?
        }

        let title: String
        let all: String
        let none: String
        let tiles: [Tile]
        let enroll: String?
        let detailsTitle: String
        let details: [Detail]
    }

    struct Anniversary: Decodable {
        let label: String
        let month: Int
        let day: Int
    }

    struct Intro: Decodable {
        let title: String
        let lines: [String]
        let label: String
        let opened: String?
    }

    struct Bonus: Decodable {
        let title: String
        let offer: String
        let label: String
        let tracking: Bool
        let openedLabel: String
        let opened: String?
        let spentLabel: String
        let spent: Double
    }

    struct Milestone: Decodable {
        let title: String
        let lines: [String]
        let label: String
        let spent: Double?
    }

    let card: CardRow
    let note: String?
    let picks: [PickGroup]
    let activationsTitle: String
    let activations: [ActivationRow]
    let credits: Credits?
    let anniversary: Anniversary?
    let intro: Intro?
    let bonus: Bonus?
    let milestone: Milestone?
    let remove: String
    let cardPage: String
}

struct WalletSettings: Decodable {
    struct Points: Decodable {
        struct Value: Decodable, Identifiable {
            let id: String
            let name: String
            let cents: Double
            let text: String
            let own: Bool
            let reset: String
        }

        let title: String
        let transfer: OnOff?
        let values: [Value]
        let range: String
        let min: Double
        let max: Double
        let step: Double
    }

    let membershipsTitle: String
    let membershipsLead: String
    let toggles: [OnOff]
    let menus: [TierMenu]
    let othersTitle: String
    let otherToggles: [OnOff]
    let otherMenus: [TierMenu]
    let points: Points?
}

// Which month a repeat-bonus note asks for, sent back as it came.
struct MonthAsk: Codable, Hashable {
    let cardId: String
    let held: Bool
    let pastIndex: Int?
    let field: String

    var json: [String: Any] {
        ["cardId": cardId, "held": held, "pastIndex": orNull(pastIndex), "field": field]
    }
}

struct PastCards: Decodable {
    struct Row: Decodable, Identifiable {
        struct Month: Decodable, Identifiable {
            let field: String
            let label: String
            let month: String?
            let never: Bool
            let neverLabel: String?
            var id: String { field }
        }

        struct Ask: Decodable {
            let label: String
            let ask: MonthAsk
        }

        let index: Int
        let card: CardRow
        let months: [Month]
        let text: String?
        let ask: Ask?
        var id: String { "\(index)-\(card.id)" }
    }

    struct Group: Decodable, Identifiable {
        let issuer: String
        let cards: [CardRow]
        var id: String { issuer }
    }

    let title: String
    let lead: String
    let rows: [Row]
    let addTitle: String
    let add: [Group]
    let remove: String
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
    let feeWorthLater: Bool
    let changes: [String]
    let checked: String
    let sources: [String]
}

// Next card, Best setups, the card list and bonus rules.

struct NextFilters: Codable, Hashable {
    var kind = "any"
    var noAnnualFee = false
    var business = false

    var json: [String: Any] {
        ["kind": kind, "noAnnualFee": noAnnualFee, "business": business]
    }
}

struct FilterMenu: Decodable {
    struct Kind: Decodable, Identifiable, Hashable {
        let id: String
        let label: String
    }

    let title: String
    let kindLabel: String
    let kinds: [Kind]
    let kind: String
    let noFee: OnOff
    let business: OnOff
    let active: Int
}

// The month a repeat-bonus note asks for, beside the note.
struct AskRow: Decodable, Hashable {
    let label: String
    let ask: MonthAsk
}

struct NextCard: Decodable {
    struct Row: Decodable, Identifiable {
        struct Minimum: Decodable {
            let text: String
            let reachable: Bool
        }

        let rank: Int
        let card: CardRow
        let total: String
        let per: String
        let totalLabel: String
        let years: [String]
        let offer: String
        let offerShort: String
        let asOf: String
        let flag: String?
        let history: String?
        let minimum: Minimum?
        let ineligible: String?
        let eligibility: String?
        let ask: AskRow?
        var id: String { card.id }
    }

    struct Link: Decodable {
        let title: String
        let text: String
    }

    let lead: String
    let basis: String
    let rows: [Row]
    let shown: Int
    let moreLabel: String?
    let empty: String?
    let members: [String]
    let howTitle: String
    let how: [String]
    let mayDiffer: String
    let filters: FilterMenu
    let best: Link
    let rules: Link
}

struct BestSetups: Decodable {
    struct Row: Decodable, Identifiable {
        let rank: Int
        let key: String
        let cards: [CardRow]
        let name: String
        let fee: String
        let net: String
        let per: String
        let first: String?
        let split: String?
        let lines: [String]
        let warnings: [String]
        let eligibility: String?
        let ask: AskRow?
        var id: String { key }
    }

    let title: String
    let basis: String
    let singlesTitle: String
    let singles: [Row]
    let pairsTitle: String
    let pairsNote: String?
    let pairs: [Row]
    let members: [String]
    let howTitle: String
    let how: [String]
    let filters: FilterMenu
    let callout: String?
    let held: String
}

struct CardIndex: Decodable {
    let title: String
    let searchPrompt: String
    let lead: String
    let art: String
    let none: String
    let rules: NextCard.Link
    let groups: [CardGroups.Group]
}

struct BonusRules: Decodable {
    struct Row: Decodable, Identifiable {
        let card: CardRow
        let label: String
        let detail: String
        let quote: String?
        let yours: String?
        let ask: AskRow?
        var id: String { card.id }
    }

    struct Group: Decodable, Identifiable {
        let id: String
        let title: String
        let rows: [Row]
    }

    struct Had: Decodable {
        let link: String
        let rest: String
    }

    let title: String
    let lead: [String]
    let had: Had
    let column: String
    let searchPrompt: String
    let none: String
    let groups: [Group]
}

struct FeeWorth: Decodable {
    let text: String?
}

struct About: Decodable {
    struct Data: Decodable {
        let label: String
        let detail: String
    }

    struct Link: Decodable, Identifiable {
        let id: String
        let title: String
        let detail: String?
        let url: String
    }

    let title: String
    let lead: String
    let data: Data
    let app: String
    let privacy: String
    let links: [Link]
    let notes: [String]
}
