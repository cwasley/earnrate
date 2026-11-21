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

// "2026-10-01" both ways, in the phone's own calendar day.
nonisolated enum Day {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func date(_ text: String?) -> Date? {
        text.flatMap { formatter.date(from: String($0.prefix(10))) }
    }

    static func text(_ date: Date) -> String {
        formatter.string(from: date)
    }
}
