import SwiftUI

// A card's drawing (CardDrawing) at a size that follows the text size. A large
// card can catch the light (`shine`), and the pick wears a sparkle.
struct CardArtView: View {
    let art: CardArt
    var width: CGFloat = 48
    var shine = false
    var sparkle = false
    // Off for a card sized to the screen, which mustn't grow past it.
    var scales = true

    @ScaledMetric private var scale: CGFloat = 1

    var body: some View {
        let w = scales ? width * min(scale, 2) : width
        CardDrawing(art: art)
            .frame(width: w, height: (w * 54 / 86).rounded())
            .overlay {
                if shine { CardShine(corner: w * 5 / 86) }
            }
            .overlay(alignment: .topTrailing) {
                if sparkle { PickSparkle().offset(x: 7, y: -8) }
            }
            .accessibilityHidden(true)
    }
}

#Preview {
    VStack {
        CardArtView(art: CardArt(color: "#d4af6a", chip: "#d9c08a", light: true), width: 160)
        CardArtView(art: CardArt(color: "#1d3f7a", chip: "#d9c08a", light: false))
    }
}
