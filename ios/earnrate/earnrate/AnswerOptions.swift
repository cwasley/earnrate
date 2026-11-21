import SwiftUI

// What an answer offers beside the ranking: how this purchase is paid, and
// "I used it" on a saved card.

// A saved card someone says they used here.
struct RecordTarget: Identifiable {
    let cardId: String
    let name: String
    let art: CardArt
    var id: String { cardId }
}

// How this purchase is paid, in one quiet menu beside the answer's line:
// the site's This purchase. Not sure and in the U.S. until changed.
struct PurchaseMenu: View {
    let options: PurchaseOptions
    @Binding var payment: String?
    @Binding var abroad: Bool

    var body: some View {
        SwiftUI.Menu {
            // Checkmark items, not an inline picker: in a menu the picker
            // takes the section's place and its "Paying with" heading goes.
            Section(options.payingTitle) {
                ForEach(options.paying) { p in
                    Toggle(p.label, isOn: Binding(get: { p.id == payment }, set: { if $0 { payment = p.id } }))
                }
            }
            Section {
                Toggle(options.abroadLabel, isOn: $abroad)
            }
        } label: {
            ChipLabel(label: options.summary, on: options.active, menu: true)
        }
        .accessibilityLabel(options.title)
        .accessibilityValue(options.active ? options.summary : "")
    }
}

// "I used it" under the pick.
struct UsedButton: View {
    let label: String
    let name: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: "checkmark.circle")
                .font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .accessibilityLabel("\(label): \(name)")
    }
}

// Records one purchase on a saved card: the amount (from the search when it
// had one), then the record rules' own sentence, with Undo.
struct RecordSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var size
    let target: RecordTarget
    let ask: RecordAsk
    let store: String
    let query: String
    let kind: String?

    @State private var text = ""
    @State private var recorded: Recorded?
    @State private var failure: String?
    @State private var working = false
    @State private var undone = false
    @FocusState private var focused: Bool

    private var amount: Double? {
        let cleaned = text.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value > 0 else { return nil }
        return value
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        CardArtView(art: target.art, width: 44)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(target.name)
                                .font(.body.weight(.semibold))
                            Text(store)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }

                if let recorded {
                    Section {
                        Label {
                            Text(undone ? ask.undone : recorded.message)
                        } icon: {
                            Image(systemName: recorded.changed && !undone ? "checkmark.circle.fill" : "info.circle")
                                .foregroundStyle(recorded.changed && !undone ? Color.accentColor : Color.inkSecondary)
                        }
                        .font(.subheadline)
                    }
                } else {
                    Section {
                        LabeledContent(ask.amountLabel) {
                            TextField("$0", text: $text)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .focused($focused)
                                .accessibilityLabel(ask.amountLabel)
                        }
                    } footer: {
                        Text(ask.lead)
                    }
                }
                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(Color.caution)
                    }
                }
            }
            .navigationTitle(ask.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let recorded {
                    if recorded.changed && !undone {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(ask.undo) { Task { await undo(recorded) } }
                                .disabled(working)
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(ask.done) { dismiss() }
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(role: .cancel) { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(ask.button) { Task { await record() } }
                            .buttonStyle(.glassProminent)
                            .disabled(amount == nil || working)
                    }
                }
            }
        }
        // At the accessibility sizes the sentence needs the whole height.
        .presentationDetents(size.isAccessibilitySize ? [.large] : [.medium, .large])
        .sensoryFeedback(.success, trigger: recorded?.changed == true)
        .onAppear {
            if let given = ask.amount {
                text = given.rounded() == given ? String(Int(given)) : String(format: "%.2f", given)
            } else {
                focused = true
            }
        }
    }

    private func record() async {
        guard let amount, !working else { return }
        working = true
        defer { working = false }
        do {
            recorded = try await model.record(target.cardId, query: query, kind: kind, amount: amount)
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }

    private func undo(_ recorded: Recorded) async {
        working = true
        defer { working = false }
        do {
            try await model.undo(recorded)
            undone = true
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }
}
