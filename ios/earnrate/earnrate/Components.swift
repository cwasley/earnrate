import SwiftUI

// Lays its children out in rows, wrapping to the next row when one is full:
// chips for picks and kinds of places.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
                x += min(size.width, bounds.width) + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            let w = min(size.width, width)
            if !row.items.isEmpty && row.width + spacing + w > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.items.isEmpty ? 0 : spacing) + w
            row.height = max(row.height, size.height)
            row.items.append(index)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

// A tappable choice, on or off.
struct Chip: View {
    let label: String
    let on: Bool
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ChipLabel(label: label, on: on)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct ChipLabel: View {
    let label: String
    let on: Bool
    var menu = false

    var body: some View {
        HStack(spacing: 4) {
            if on && !menu {
                Image(systemName: "checkmark")
                    .font(.caption.weight(.bold))
            }
            Text(label)
                .multilineTextAlignment(.leading)
            if menu {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
            }
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .foregroundStyle(on ? Color.onAccent : Color.primary)
        .pill(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), padding: 7)
    }
}

// A capsule while its text fits on one line. Text that wraps (at the largest
// text sizes) keeps the one-line ends on the taller box, since a capsule's
// round ends would cut through the wrapped lines.
struct Pill: Shape {
    let line: CGFloat // one line's height with its padding, or a bit more

    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: min(line, rect.height) / 2).path(in: rect)
    }
}

private struct PillBackground<S: ShapeStyle>: ViewModifier {
    let style: S
    let padding: CGFloat // above and below the text
    // A subheadline line, generously: under it, one line must read as a
    // capsule; two lines must be well over it.
    @ScaledMetric(relativeTo: .subheadline) private var line: CGFloat = 24

    func body(content: Content) -> some View {
        let shape = Pill(line: line + padding * 2)
        content
            .background(style, in: shape)
            .contentShape(shape)
    }
}

extension View {
    // A pill of `style` behind subheadline text padded by `padding` above
    // and below.
    func pill<S: ShapeStyle>(_ style: S, padding: CGFloat) -> some View {
        modifier(PillBackground(style: style, padding: padding))
    }
}

// A month as two menus, the month by name and the year, like the site's
// card history. It reports YYYY-MM once both are picked, and nil when one is
// set back to blank. Months after this one can't be picked.
struct MonthYearPicker: View {
    let label: String
    let months: [String]
    let value: String?
    var disabled = false
    let onChange: (String?) -> Void

    @State private var month = 0
    @State private var year = 0

    private var now: (year: Int, month: Int) {
        let parts = Calendar.current.dateComponents([.year, .month], from: .now)
        return (parts.year ?? 2026, parts.month ?? 1)
    }

    private var years: [Int] {
        let back = Array((now.year - 30)...now.year).reversed()
        if year > 0 && !back.contains(year) { return back + [year] }
        return Array(back)
    }

    var body: some View {
        HStack(spacing: 8) {
            Picker("Month", selection: $month) {
                Text("Month").tag(0)
                ForEach(Array(months.enumerated()), id: \.offset) { i, name in
                    if !(year == now.year && i + 1 > now.month) {
                        Text(name).tag(i + 1)
                    }
                }
            }
            Picker("Year", selection: $year) {
                Text("Year").tag(0)
                ForEach(years, id: \.self) { y in
                    if !(y == now.year && month > now.month) {
                        Text(String(y)).tag(y)
                    }
                }
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .disabled(disabled)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
        .onAppear(perform: load)
        .onChange(of: value) { load() }
        .onChange(of: month) { send() }
        .onChange(of: year) { send() }
    }

    private func load() {
        guard let value, value.count == 7 else {
            if value == nil && (month > 0 && year > 0) { month = 0; year = 0 }
            return
        }
        year = Int(value.prefix(4)) ?? 0
        month = Int(value.suffix(2)) ?? 0
    }

    private func send() {
        let picked = month > 0 && year > 0 ? String(format: "%04d-%02d", year, month) : nil
        if picked != value && (picked != nil || value != nil) { onChange(picked) }
    }
}

// A dollar amount typed into a settings row. The decimal pad has no Return
// key, so it saves from the keyboard bar's Done, when the field loses focus,
// and when the screen goes away (Back), whichever comes first.
struct DollarField: View {
    let label: String
    let value: Double?
    var placeholder = "0"
    let onSave: (Double?) -> Void

    @State private var text = ""
    @State private var edited = false
    @FocusState private var focused: Bool

    var body: some View {
        LabeledContent {
            TextField(placeholder, text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .focused($focused)
                .frame(maxWidth: 120)
                .onSubmit(save)
        } label: {
            Text(label)
        }
        .toolbar {
            // Every field on a screen adds to the one keyboard bar, so only
            // the focused one shows its button.
            if focused {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        save()
                        focused = false
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .onAppear { text = Self.format(value) }
        .onDisappear(perform: save)
        .onChange(of: text) { if focused { edited = true } }
        .onChange(of: value) { if !focused { text = Self.format(value) } }
        .onChange(of: focused) { if !focused { save() } }
    }

    private func save() {
        guard edited else { return }
        edited = false
        let cleaned = text.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        let next = cleaned.isEmpty ? nil : Double(cleaned)
        if !cleaned.isEmpty && next == nil { return }
        if next != value { onSave(next) }
    }

    private static func format(_ value: Double?) -> String {
        guard let value, value > 0 else { return "" }
        return value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
    }
}

// The alert for a change the engine refused, with its reason.
extension View {
    func refusalAlert(_ refusal: Binding<String?>) -> some View {
        alert("Couldn't change My wallet", isPresented: Binding(get: { refusal.wrappedValue != nil }, set: { if !$0 { refusal.wrappedValue = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(refusal.wrappedValue ?? "")
        }
    }
}

// An optional value as JSON wants it: null when it's missing.
func orNull(_ value: Any?) -> Any { value ?? NSNull() }
