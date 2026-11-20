import SwiftUI

// Memberships and point values: most people never change them, so they
// live behind the gear.
struct WalletSettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var settings: WalletSettings?
    @State private var refusal: String?

    var body: some View {
        NavigationStack {
            Form {
                if let settings {
                    Section {
                        MembershipControls(toggles: settings.toggles, menus: settings.menus, refusal: $refusal)
                        if !settings.otherToggles.isEmpty || !settings.otherMenus.isEmpty {
                            DisclosureGroup(settings.othersTitle) {
                                MembershipControls(toggles: settings.otherToggles, menus: settings.otherMenus, refusal: $refusal)
                            }
                        }
                    } header: {
                        Text(settings.membershipsTitle)
                    } footer: {
                        Text(settings.membershipsLead)
                    }
                    if let points = settings.points {
                        Section {
                            if let transfer = points.transfer {
                                SwiftUI.Toggle(transfer.label, isOn: Binding(get: { transfer.on }, set: { on in
                                    Task { refusal = await model.editSettings(["transfer": on]) }
                                }))
                            }
                            ForEach(points.values) { value in
                                PointValueRow(value: value, points: points) { cents in
                                    Task { refusal = await model.editSettings(["pointValue": ["id": value.id, "cents": orNull(cents)]]) }
                                }
                            }
                        } header: {
                            Text(points.title)
                        } footer: {
                            Text(points.range)
                        }
                    }
                }
                Section {
                    NavigationLink("About earnrate") { AboutView() }
                }
            }
            .navigationTitle(model.walletHome.settings)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: model.revision) {
                settings = try? await model.walletSettings()
            }
            .refusalAlert($refusal)
        }
        .presentationDetents([.medium, .large])
    }
}

private struct PointValueRow: View {
    let value: WalletSettings.Points.Value
    let points: WalletSettings.Points
    let save: (Double?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Stepper(value: Binding(get: { value.cents }, set: { save(($0 * 10).rounded() / 10) }), in: points.min...points.max, step: points.step) {
                HStack {
                    Text(value.name)
                    Spacer()
                    Text(value.text)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityValue(value.text)
            if value.own {
                Button(value.reset) { save(nil) }
                    .font(.footnote)
                    .buttonStyle(.borderless)
            }
        }
    }
}
