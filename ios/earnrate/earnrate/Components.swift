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
        .foregroundStyle(on ? Color.white : Color.primary)
        .background(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary), in: Capsule())
        .contentShape(Capsule())
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

// A dollar amount typed into a settings row, saved when the field is left or
// Return is pressed.
struct DollarField: View {
    let label: String
    let value: Double?
    var placeholder = "0"
    let onSave: (Double?) -> Void

    @State private var text = ""
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
        .onAppear { text = Self.format(value) }
        .onChange(of: value) { if !focused { text = Self.format(value) } }
        .onChange(of: focused) { if !focused { save() } }
    }

    private func save() {
        let cleaned = text.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
        let next = cleaned.trimmingCharacters(in: .whitespaces).isEmpty ? nil : Double(cleaned)
        if next != value { onSave(next) }
    }

    private static func format(_ value: Double?) -> String {
        guard let value, value > 0 else { return "" }
        return value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
    }
}

// "2026-10-01" both ways, in the phone's own calendar day.
enum Day {
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
