import SwiftUI

// A saved card's settings: only what that card needs (picks, activations,
// credits, its anniversary, a welcome or spend bonus). Every control saves as
// it changes, through the engine's update rules. A to-do row opens it at the
// part it's about.
struct CardSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    let focus: SettingsFocus?

    @State private var settings: CardSettings?
    @State private var failure: String?
    @State private var refusal: String?
    @State private var removal: Removal?
    @State private var scrolled = false
    // Tracking turned on before there's an account date to save it with,
    // and spending typed meanwhile: nothing is saved until the date is.
    @State private var trackingDraft = false
    @State private var unsaved: Double?

    var body: some View {
        Group {
            if let settings {
                ScrollViewReader { proxy in
                    form(settings)
                        .onAppear {
                            guard let focus, !scrolled else { return }
                            scrolled = true
                            Task {
                                try? await Task.sleep(for: .milliseconds(350))
                                withAnimation { proxy.scrollTo(focus, anchor: .center) }
                            }
                        }
                }
            } else if let failure {
                ContentUnavailableView("Not in My wallet", systemImage: "wallet.pass", description: Text(failure))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(settings?.card.shortName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.revision) {
            do {
                settings = try await model.cardSettings(id)
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
        .refusalAlert($refusal)
    }

    private func save(_ edit: [String: Any]) {
        Task { refusal = await model.edit(id, edit) }
    }

    private func remove(keep: Bool) {
        Task {
            refusal = await model.remove(id, keep: keep)
            if refusal == nil { dismiss() }
        }
    }

    private func form(_ s: CardSettings) -> some View {
        Form {
            Section {
                NavigationLink(value: Route.card(s.card.id)) {
                    HStack(spacing: 14) {
                        CardArtView(art: s.card.art, width: 64)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.card.name)
                                .font(.headline)
                            Text(s.card.fee)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            if let note = s.note {
                                Text(note)
                                    .font(.footnote)
                                    .foregroundStyle(.tint)
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityHint(s.cardPage)
                }
            }

            if !s.picks.isEmpty {
                Section {
                    ForEach(s.picks) { group in
                        PickChips(group: group) { option in
                            save(["pick": ["choice": group.choice, "option": option]])
                        }
                    }
                }
                .id(SettingsFocus.picks)
            }

            if !s.activations.isEmpty {
                Section {
                    ActivationToggles(title: s.activationsTitle, rows: s.activations) { rule, on in
                        save(["activate": ["rule": rule, "on": on]])
                    }
                }
                .id(SettingsFocus.activations)
            }

            if let credits = s.credits {
                CreditsSection(credits: credits, save: save)
                    .id(SettingsFocus.credits)
            }

            if let anniversary = s.anniversary {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(anniversary.label)
                            .font(.subheadline)
                        AnniversaryPicker(anniversary: anniversary, months: model.home?.months ?? []) { month, day in
                            save(["anniversary": ["month": month, "day": day]])
                        }
                    }
                }
                .id(SettingsFocus.anniversary)
            }

            if let intro = s.intro {
                Section(intro.title) {
                    ForEach(intro.lines, id: \.self) {
                        Text($0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    OpenedPicker(label: intro.label, opened: intro.opened) { date in
                        save(["opened": [
                            "date": date,
                            "tracking": (s.bonus?.tracking ?? false) || trackingDraft,
                            "unsaved": orNull(unsaved),
                        ]])
                    }
                }
            }

            if let bonus = s.bonus {
                BonusSection(bonus: bonus, hasIntro: s.intro != nil, draft: $trackingDraft, unsaved: $unsaved, save: save)
                    .id(SettingsFocus.bonus)
            }

            if let milestone = s.milestone {
                Section(milestone.title) {
                    ForEach(milestone.lines, id: \.self) {
                        Text($0)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    DollarField(label: milestone.label, value: milestone.spent) { dollars in
                        if let dollars { save(["milestoneSpent": dollars]) }
                    }
                }
            }

            Section {
                Button(s.remove, role: .destructive) {
                    Task { removal = try? await model.removal(id) }
                }
                // On the button, so the question points at it.
                .confirmationDialog(removal?.title ?? "", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible) {
                    if let removal {
                        Button(removal.remove, role: .destructive) { remove(keep: false) }
                        if let keep = removal.keep {
                            Button(keep) { remove(keep: true) }
                        }
                    }
                }
            }
        }
    }
}

// The card's credits as tiles: a tap marks one used, another puts it back as
// it was; None marks the unanswered ones not used. Credit details hold what
// each pays and how much of it is used this period.
private struct CreditsSection: View {
    let credits: CardSettings.Credits
    let save: ([String: Any]) -> Void
    // What each tile was before this screen marked it used.
    @State private var before: [String: String?] = [:]
    @State private var tapped = 0

    var body: some View {
        Section {
            let columns = [GridItem(.adaptive(minimum: 140), spacing: 10)]
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(credits.tiles) { tile in
                    CreditTile(tile: tile) { tap(tile) }
                }
            }
            .padding(.vertical, 6)
            if let enroll = credits.enroll {
                Label(enroll, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            DisclosureGroup(credits.detailsTitle) {
                ForEach(credits.details) { detail in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(detail.name)
                            .font(.subheadline.weight(.semibold))
                        Text(detail.text)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let used = detail.used {
                            DollarField(label: used.label, value: used.value) { dollars in
                                save(["creditUsed": ["id": detail.id, "dollars": dollars ?? 0]])
                            }
                        }
                        if let night = detail.night {
                            DollarField(label: night.label, value: night.value, placeholder: night.placeholder) { dollars in
                                save(["nightValue": ["id": detail.id, "dollars": orNull(dollars)]])
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        } header: {
            HStack {
                Text(credits.title)
                Spacer()
                Button(credits.all) {
                    tapped += 1
                    for tile in credits.tiles where tile.answer != "used" { before[tile.id] = tile.answer }
                    save(["credits": "all"])
                }
                .accessibilityLabel("\(credits.title): \(credits.all)")
                Button(credits.none) {
                    tapped += 1
                    before = [:]
                    save(["credits": "none"])
                }
                .accessibilityLabel("\(credits.title): \(credits.none)")
            }
            .font(.subheadline)
            .buttonStyle(.borderless)
        }
        .sensoryFeedback(.selection, trigger: tapped)
    }

    private func tap(_ tile: CardSettings.Credits.Tile) {
        tapped += 1
        let was = before[tile.id] ?? nil
        if tile.answer == "used" { before[tile.id] = nil } else { before[tile.id] = tile.answer }
        save(["credit": ["tap": tile.id, "before": orNull(was)]])
    }
}

private struct CreditTile: View {
    let tile: CardSettings.Credits.Tile
    let action: () -> Void

    private var used: Bool { tile.answer == "used" }
    private var skipped: Bool { tile.answer == "skipped" }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tile.name)
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.leading)
                    if let worth = tile.worth {
                        Text(worth)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if skipped {
                        Text(tile.state)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: used ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(used ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    .font(.title3)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(used ? AnyShapeStyle(Color.accentColor.opacity(0.14)) : AnyShapeStyle(.fill.quaternary))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(used ? Color.accentColor : .clear, lineWidth: 1.5)
            )
            .opacity(skipped ? 0.6 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tile.name)
        .accessibilityValue([tile.worth, tile.state].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(used ? [.isButton, .isSelected] : .isButton)
    }
}

// The account anniversary as a month and a day; saved once both are set.
private struct AnniversaryPicker: View {
    let anniversary: CardSettings.Anniversary
    let months: [String]
    let save: (Int, Int) -> Void
    @State private var month = 0
    @State private var day = 0

    private static let days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

    var body: some View {
        HStack {
            Picker("Month", selection: $month) {
                Text("Month").tag(0)
                ForEach(Array(months.enumerated()), id: \.offset) { i, name in
                    Text(name).tag(i + 1)
                }
            }
            Picker("Day", selection: $day) {
                Text("Day").tag(0)
                ForEach(1...(month > 0 ? Self.days[month - 1] : 31), id: \.self) { d in
                    Text(String(d)).tag(d)
                }
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(anniversary.label)
        .onAppear {
            month = anniversary.month
            day = anniversary.day
        }
        .onChange(of: month) {
            if month > 0 && day > Self.days[month - 1] { day = Self.days[month - 1] }
            send()
        }
        .onChange(of: day) { send() }
    }

    private func send() {
        if month > 0 && day > 0 && (month != anniversary.month || day != anniversary.day) {
            save(month, day)
        }
    }
}

// An opening date, or none. With none, Add asks for the day; nothing is
// saved until one is picked.
private struct OpenedPicker: View {
    let label: String
    let opened: String?
    let save: (String) -> Void
    @State private var asking = false

    var body: some View {
        if let date = Day.date(opened) {
            DatePicker(label, selection: Binding(get: { date }, set: { save(Day.text($0)) }), in: ...Date.now, displayedComponents: .date)
        } else {
            LabeledContent(label) {
                Button("Add") { asking = true }
            }
            .sheet(isPresented: $asking) {
                DaySheet(label: label) { date in
                    asking = false
                    save(Day.text(date))
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}

// A calendar for one day, saved only with Save.
private struct DaySheet: View {
    @Environment(\.dismiss) private var dismiss
    let label: String
    let save: (Date) -> Void
    @State private var date = Date.now

    var body: some View {
        NavigationStack {
            ScrollView {
                DatePicker(label, selection: $date, in: ...Date.now, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .padding(.horizontal)
            }
            .navigationTitle(label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", systemImage: "checkmark") { save(date) }
                }
            }
        }
    }
}

// Turning tracking on saves it only with the account's date: the one saved
// already, or the one the person picks next. Spending typed before then
// waits for that date, as on the site.
private struct BonusSection: View {
    let bonus: CardSettings.Bonus
    let hasIntro: Bool
    @Binding var draft: Bool
    @Binding var unsaved: Double?
    let save: ([String: Any]) -> Void

    private var tracking: Bool { bonus.tracking || draft }

    var body: some View {
        Section {
            if !bonus.offer.isEmpty {
                Text(bonus.offer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            SwiftUI.Toggle(bonus.label, isOn: Binding(get: { tracking }, set: turn))
            if tracking {
                if !hasIntro {
                    OpenedPicker(label: bonus.openedLabel, opened: bonus.opened) { date in
                        save(["opened": ["date": date, "tracking": true, "unsaved": orNull(unsaved)]])
                    }
                }
                DollarField(label: bonus.spentLabel, value: bonus.tracking ? bonus.spent : unsaved) { dollars in
                    if bonus.tracking {
                        save(["spent": ["dollars": dollars ?? 0, "opened": orNull(bonus.opened)]])
                    } else {
                        unsaved = dollars
                    }
                }
            }
        } header: {
            Text(bonus.title)
        }
        .onChange(of: bonus.tracking) {
            if bonus.tracking {
                draft = false
                unsaved = nil
            }
        }
    }

    private func turn(_ on: Bool) {
        if on, let opened = bonus.opened {
            save(["tracking": ["on": true, "opened": opened, "unsaved": orNull(unsaved)]])
        } else if on {
            draft = true
        } else {
            draft = false
            unsaved = nil
            if bonus.tracking { save(["tracking": ["on": false, "opened": NSNull()]]) }
        }
    }
}
