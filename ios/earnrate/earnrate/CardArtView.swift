import SwiftUI

// earnrate's drawing of a card, as src/format/card-art.ts draws it on the
// site: a plain card in the card's color with a chip. Never the issuer's art.
struct CardArtView: View {
    let art: CardArt
    var width: CGFloat = 48

    @ScaledMetric private var scale: CGFloat = 1

    var body: some View {
        let w = width * min(scale, 2)
        Canvas { context, size in
            let s = size.width / 86
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            let face = Path(roundedRect: CGRect(x: 0.5 * s, y: 0.5 * s, width: 85 * s, height: 53 * s), cornerRadius: 5 * s)
            context.fill(face, with: .color(Color(hex: art.color)))
            context.stroke(face, with: .color(art.light ? .black.opacity(0.18) : .white.opacity(0.14)), lineWidth: max(0.5, s * 0.6))

            var sheen = Path()
            sheen.move(to: point(0, 40))
            sheen.addLine(to: point(56, 0))
            sheen.addLine(to: point(80, 0))
            sheen.addQuadCurve(to: point(85.5, 5), control: point(85.5, 0))
            sheen.addLine(to: point(85.5, 8))
            sheen.addLine(to: point(20, 54))
            sheen.addLine(to: point(5, 54))
            sheen.addQuadCurve(to: point(0, 49), control: point(0, 54))
            sheen.closeSubpath()
            context.clip(to: face)
            context.fill(sheen, with: .color(.white.opacity(0.07)))

            let chip = Path(roundedRect: CGRect(x: 10 * s, y: 17 * s, width: 14 * s, height: 11 * s), cornerRadius: 2 * s)
            context.fill(chip, with: .color(Color(hex: art.chip)))
            var lines = Path()
            lines.move(to: point(10, 22.5))
            lines.addLine(to: point(24, 22.5))
            lines.move(to: point(17, 17))
            lines.addLine(to: point(17, 28))
            context.stroke(chip, with: .color(.black.opacity(0.25)), lineWidth: 0.6 * s)
            context.stroke(lines, with: .color(.black.opacity(0.25)), lineWidth: 0.6 * s)

            let stripe = Path(roundedRect: CGRect(x: 10 * s, y: 40 * s, width: 30 * s, height: 3 * s), cornerRadius: 1.5 * s)
            context.fill(stripe, with: .color((art.light ? Color.black : Color.white).opacity(0.28)))
        }
        .frame(width: w, height: (w * 54 / 86).rounded())
        .accessibilityHidden(true)
    }
}

extension Color {
    // "#1d3f7a" from the card data.
    init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        let value = UInt64(digits, radix: 16) ?? 0x5c5650
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}

#Preview {
    VStack {
        CardArtView(art: CardArt(color: "#d4af6a", chip: "#d9c08a", light: true), width: 160)
        CardArtView(art: CardArt(color: "#1d3f7a", chip: "#d9c08a", light: false))
    }
}
