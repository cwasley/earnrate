import SwiftUI

// The card-forward look: screens washed with the colors of the cards on
// them, drawn cards with their names on the face, and cards in stacks.

extension CardArt {
    var tone: Color { Color(hex: color) }

    // Black or white, whichever reads better on the card's color. One of
    // the two is always at least 4.5:1, so names on a card stay legible.
    var ink: Color { luminance > 0.179 ? .black : .white }

    var luminance: Double {
        let digits = color.hasPrefix("#") ? String(color.dropFirst()) : color
        let value = UInt64(digits, radix: 16) ?? 0x5c5650
        func linear(_ c: UInt64) -> Double {
            let v = Double(c & 0xff) / 255
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(value >> 16) + 0.7152 * linear(value >> 8) + 0.0722 * linear(value)
    }
}

// A screen's background: earnrate's warm canvas, washed at the top with the
// colors of the cards it's about. A light card over the dark canvas (or a
// dark one over the light) brings the wash too close to the text colors, so
// text that isn't black or white sits on a plate or the surface, never on
// the wash itself.
struct CardBackdrop: View {
    let arts: [CardArt]
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let strength = scheme == .dark ? 0.36 : 0.28
        let first = arts.first?.tone ?? Color.ember
        let second = arts.dropFirst().first?.tone ?? (arts.isEmpty ? Color.accentColor : first)
        ZStack {
            Color.canvas
            LinearGradient(
                stops: [
                    .init(color: first.opacity(strength), location: 0),
                    .init(color: first.opacity(strength * 0.45), location: 0.3),
                    .init(color: first.opacity(0), location: 0.62),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [second.opacity(strength * 0.6), second.opacity(0)],
                center: UnitPoint(x: 1, y: 0),
                startRadius: 0,
                endRadius: 380
            )
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.45), value: arts)
    }
}

extension View {
    func cardBackdrop(_ arts: [CardArt]) -> some View {
        scrollContentBackground(.hidden)
            .background { CardBackdrop(arts: arts) }
    }

    // For a footer that ends a screen: a list leaves room under its last
    // section but none under a footer's last line, which then sat against
    // the floating tab bar.
    func endsList(_ last: Bool = true) -> some View {
        padding(.bottom, last ? 20 : 0)
    }

    // Rows on the backdrop sit on earnrate's warm surface.
    func surfaceRows() -> some View {
        listRowBackground(Color.surface)
    }

    // Text laid over the wash: a near-opaque piece of the surface behind it.
    func plate(cornerRadius: CGFloat = 18) -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.surface.opacity(0.9), in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

// A section's title over the wash, in the primary ink, which stays legible
// on any card's wash where the secondary grays don't.
struct SectionTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(Color.primary)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
    }
}

// A quiet button on the wash: the accent on a capsule of the surface.
struct PlateButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.tint)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Color.surface, in: Capsule())
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Capsule())
    }
}

// The filled button on the wash: the accent with its own ink.
struct AccentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.onAccent)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Color.accentColor, in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Capsule())
    }
}

// A drawn card with its name on the face, and a rate or fee at the right.
// The text on a card stops growing at the larger text sizes, since the card
// itself can't; every screen also says it in text off the card.
struct CardFace: View {
    let art: CardArt
    let name: String
    var trailing: String?
    var footer: String?
    let width: CGFloat
    var shine = false
    var sparkle = false
    var lifted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        CardArtView(art: art, width: width, shine: shine, sparkle: sparkle, scales: false)
            .shadow(
                color: lifted ? art.tone.opacity(scheme == .dark ? 0.45 : 0.4) : .black.opacity(scheme == .dark ? 0.5 : 0.14),
                radius: lifted ? 18 : 4,
                y: lifted ? 10 : 2
            )
            .overlay(alignment: .topLeading) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Spacer(minLength: 4)
                    if let trailing {
                        Text(trailing)
                            .font(.system(.headline, design: .rounded).monospacedDigit())
                    }
                }
                .padding(.horizontal, width * 0.055)
                .padding(.top, width * 0.04)
                .padding(.trailing, sparkle ? 10 : 0)
            }
            .overlay(alignment: .bottomTrailing) {
                if let footer {
                    Text(footer)
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, width * 0.055)
                        .padding(.bottom, width * 0.045)
                }
            }
            .foregroundStyle(art.ink)
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }
}

// The pick tips with the phone, a few degrees, as the light moves across it.
struct CardTilt: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var light: CardLight { CardLight.shared }

    func body(content: Content) -> some View {
        let on = light.live && !reduceMotion
        content
            .rotation3DEffect(.degrees(on ? Double(light.tilt.x) * 7 : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
            .rotation3DEffect(.degrees(on ? Double(-light.tilt.y) * 5 : 0), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
    }
}

// Measures the width a row has, for cards sized to the screen.
private struct Measured: ViewModifier {
    @Binding var width: CGFloat

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    func measuredWidth(_ width: Binding<CGFloat>) -> some View {
        modifier(Measured(width: width))
    }
}

// A few drawn cards fanned like a hand, the front one catching the light
// with the pick's sparkle, for the welcome and an empty wallet.
struct CardFan: View {
    let arts: [CardArt]
    var width: CGFloat = 190
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var open = false

    var body: some View {
        let shown = Array(arts.prefix(3))
        let count = shown.count
        ZStack {
            ForEach(Array(shown.enumerated()), id: \.offset) { i, art in
                let spread = Double(i) - Double(count - 1) / 2
                let front = i == count - 1
                CardArtView(art: art, width: width, shine: front, sparkle: front, scales: false)
                    .shadow(color: art.tone.opacity(0.45), radius: 16, y: 10)
                    .rotationEffect(.degrees(open ? spread * 14 : 0), anchor: .bottom)
                    .offset(x: open ? spread * width * 0.3 : 0, y: open ? abs(spread) * 10 : 0)
            }
        }
        .frame(height: width)
        .accessibilityHidden(true)
        .onAppear {
            if reduceMotion {
                open = true
            } else {
                withAnimation(.spring(response: 0.7, dampingFraction: 0.7).delay(0.15)) { open = true }
            }
        }
    }
}

// My wallet's cards as a stack, like Apple Wallet: the front card whole,
// the others' top edges above it with their names. A tap brings one to the
// front; a tap on the front card opens its settings. VoiceOver gets each
// card's settings, page and removal as actions, so nothing needs the card
// brought forward first.
struct WalletDeck: View {
    let cards: [WalletHome.Held]
    let open: (WalletHome.Held) -> Void
    let page: (CardRow) -> Void
    let remove: (CardRow) -> Void
    @Binding var front: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .subheadline) private var scaledBand: CGFloat = 38
    @State private var width: CGFloat = 340

    private var frontId: String? {
        if let front, cards.contains(where: { $0.id == front }) { return front }
        return cards.first?.id
    }

    // Back to front: the others in the wallet's order, then the front card.
    private var order: [WalletHome.Held] {
        cards.filter { $0.id != frontId } + cards.filter { $0.id == frontId }
    }

    var body: some View {
        let cardWidth = min(width - 40, 320)
        let cardHeight = (cardWidth * 54 / 86).rounded()
        let band = min(scaledBand, cardHeight * 0.22, cards.count > 6 ? 30 : .infinity)
        let stack = order
        Color.clear
            .frame(height: band * CGFloat(max(stack.count - 1, 0)) + cardHeight)
            .measuredWidth($width)
            .overlay(alignment: .top) {
                ZStack(alignment: .top) {
                    ForEach(Array(stack.enumerated()), id: \.element.id) { position, held in
                        let isFront = held.id == frontId
                        let depth = stack.count - 1 - position
                        Button {
                            if isFront {
                                open(held)
                            } else {
                                withAnimation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.78)) {
                                    front = held.id
                                }
                            }
                        } label: {
                            CardFace(
                                art: held.card.art,
                                name: held.card.shortName,
                                footer: isFront ? held.card.fee : nil,
                                width: cardWidth,
                                shine: isFront,
                                lifted: isFront
                            )
                        }
                        .buttonStyle(DeckPress())
                        .scaleEffect(1 - CGFloat(depth) * 0.025, anchor: .top)
                        .offset(y: CGFloat(position) * band)
                        .zIndex(Double(position))
                        .contextMenu {
                            Button("Card page", systemImage: "creditcard") { page(held.card) }
                            Button("Remove", systemImage: "minus.circle", role: .destructive) { remove(held.card) }
                        }
                        .accessibilityLabel(held.card.shortName)
                        .accessibilityValue([held.card.fee, held.note].compactMap { $0 }.joined(separator: ". "))
                        .accessibilityHint(isFront ? "Opens its settings" : "Brings it to the front")
                        .accessibilityAction(named: "Settings") { open(held) }
                        .accessibilityAction(named: "Card page") { page(held.card) }
                        .accessibilityAction(named: "Remove") { remove(held.card) }
                        .accessibilitySortPriority(Double(cards.count - (cards.firstIndex { $0.id == held.id } ?? 0)))
                    }
                }
                .frame(width: cardWidth)
            }
            .sensoryFeedback(.selection, trigger: front)
    }
}

// A card pressed in the deck sinks a little.
private struct DeckPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

// An answer's pick, front and big, with the next cards in the ranking
// peeking out behind it with their rates.
struct AnswerHero: View {
    let pick: Answer.Pick
    let behind: [Answer.Row]

    @ScaledMetric(relativeTo: .subheadline) private var scaledBand: CGFloat = 36
    @State private var width: CGFloat = 340

    var body: some View {
        let cardWidth = min(width - 24, 340)
        let cardHeight = (cardWidth * 54 / 86).rounded()
        let band = min(scaledBand, cardHeight * 0.22)
        let count = behind.count
        Color.clear
            .frame(height: band * CGFloat(count) + cardHeight + 12)
            .measuredWidth($width)
            .overlay(alignment: .top) {
                ZStack(alignment: .top) {
                    ForEach(Array(behind.enumerated()), id: \.element.id) { index, row in
                        let depth = index + 1
                        NavigationLink(value: Route.card(row.card.id)) {
                            CardFace(art: row.card.art, name: row.card.shortName, trailing: row.rate, width: cardWidth)
                        }
                        .buttonStyle(.plain)
                        .scaleEffect(1 - CGFloat(depth) * 0.05, anchor: .top)
                        .offset(y: CGFloat(count - depth) * band)
                        .zIndex(Double(-depth))
                        .accessibilityLabel(row.card.shortName)
                        .accessibilityValue(row.rate)
                        .accessibilitySortPriority(Double(-depth))
                    }
                    NavigationLink(value: Route.card(pick.cardId)) {
                        CardFace(art: pick.art, name: pick.name, width: cardWidth, shine: true, sparkle: true, lifted: true)
                            .modifier(CardTilt())
                    }
                    .buttonStyle(.plain)
                    .offset(y: CGFloat(count) * band)
                    .zIndex(1)
                    .id(pick.cardId)
                    .accessibilityLabel(pick.name)
                    .accessibilityValue(pick.detail)
                    .accessibilitySortPriority(1)
                }
            }
    }
}
