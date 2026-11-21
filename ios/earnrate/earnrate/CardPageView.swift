import SwiftUI

// A card's page: what it earns, its offer, credits and fees, as the site's
// card page and Claude's search_cards say them.
struct CardPageView: View {
    @Environment(AppModel.self) private var model
    let id: String

    @State private var page: CardPage?
    @State private var worth: FeeWorth?
    @State private var failure: String?
    @State private var refusal: String?
    @State private var width: CGFloat = 400

    private var held: Bool { model.walletCards.contains { $0.id == id } }

    var body: some View {
        Group {
            if let page {
                content(page)
            } else if let failure {
                ContentUnavailableView("Couldn't open this card", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(page?.shortName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.revision) {
            do {
                page = try await model.cardPage(id)
            } catch {
                failure = error.localizedDescription
                return
            }
            guard page?.feeWorthLater == true else { return }
            worth = model.cachedFeeWorth(id)
            if worth == nil { worth = try? await model.feeWorth(id) }
        }
        .alert("Couldn't change My wallet", isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(refusal ?? "")
        }
    }

    private func content(_ page: CardPage) -> some View {
        List {
            Section {
            } header: {
                VStack(spacing: 14) {
                    CardFace(art: page.art, name: page.shortName, width: heroWidth, shine: true, lifted: true)
                        .modifier(CardTilt())
                        .padding(.top, 8)
                        .accessibilityHidden(true)
                    VStack(spacing: 4) {
                        Text(page.name)
                            .font(.title2.bold())
                            .foregroundStyle(Color.primary)
                            .accessibilityAddTraits(.isHeader)
                        Text("\(page.issuer) · \(page.fee)")
                            .font(.subheadline)
                            .foregroundStyle(Color.inkSecondary)
                    }
                    .multilineTextAlignment(.center)
                    if !held {
                        Button {
                            Task { refusal = await model.add(id) }
                        } label: {
                            Label("Add to My wallet", systemImage: "plus.circle")
                        }
                        .buttonStyle(AccentButtonStyle())
                    }
                }
                .frame(maxWidth: .infinity)
                .measuredWidth($width)
                .textCase(nil)
                .padding(.bottom, 8)
            }

            Group {
                if held {
                    Section {
                        NavigationLink(value: Route.settings(id, nil)) {
                            Label("Settings", systemImage: "slider.horizontal.3")
                        }
                    }
                }

                if !page.earning.isEmpty {
                    Section {
                        ForEach(page.earning, id: \.self) { EarnLine(line: $0) }
                    } header: {
                        SectionTitle("Earns")
                    } footer: {
                        if let note = page.ratesNote { Text(note).foregroundStyle(Color.inkSecondary) }
                    }
                }

                if let offer = page.offer {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(offer.terms)
                            Text(offer.asOf)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        LabeledContent {
                            EmptyView()
                        } label: {
                            Text("Can you get it again?").font(.subheadline.weight(.semibold))
                            Text(offer.again)
                        }
                        if let note = offer.note {
                            DisclosureGroup("Who can get it") {
                                Text(note).font(.subheadline)
                            }
                        }
                        if let history = page.offerHistory {
                            LabeledContent {
                                EmptyView()
                            } label: {
                                Text("Offer history").font(.subheadline.weight(.semibold))
                                Text(history)
                            }
                        }
                    } header: {
                        SectionTitle("Public welcome offer")
                    } footer: {
                        Text(offer.mayDiffer).foregroundStyle(Color.inkSecondary)
                    }
                } else if let history = page.offerHistory {
                    Section {
                        Text(history)
                    } header: {
                        SectionTitle("Offer history")
                    }
                }

                if !page.credits.isEmpty {
                    Section {
                        ForEach(page.credits, id: \.self) { Text($0) }
                    } header: {
                        SectionTitle("Statement credits")
                    }
                }

                if !page.perks.isEmpty {
                    Section {
                        ForEach(page.perks, id: \.self) { Text($0) }
                    } header: {
                        SectionTitle("Also")
                    }
                }

                // Worked out after the page shows; gone if the card has none.
                if page.feeWorthLater && (worth == nil || worth?.text != nil) {
                    Section {
                        DisclosureGroup("Is the fee worth it?") {
                            if let text = worth?.text {
                                Text(text)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            } else {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            }
                        }
                    }
                }

                if let keep = page.keep {
                    KeepOrReplaceSection(id: id, keep: keep)
                }

                Section {
                    Text(page.fee)
                    Text(page.foreignFee)
                    LabeledContent("Network", value: page.network)
                } header: {
                    SectionTitle("Fees")
                }

                if !page.changes.isEmpty {
                    Section {
                        DisclosureGroup("Recent changes") {
                            ForEach(page.changes, id: \.self) {
                                Text($0)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    ForEach(page.sources, id: \.self) { source in
                        if let url = URL(string: source) {
                            Link(destination: url) {
                                Label(url.host() ?? source, systemImage: "safari")
                            }
                        }
                    }
                } header: {
                    SectionTitle("Issuer's pages")
                } footer: {
                    Text(page.checked)
                        .foregroundStyle(Color.inkSecondary)
                        .endsList(!held)
                }

                if held {
                    Section {
                        Button("Remove from My wallet", systemImage: "minus.circle", role: .destructive) {
                            Task { refusal = await model.remove(id) }
                        }
                        .tint(.red)
                    }
                }
            }
            .surfaceRows()
        }
        .listSectionSpacing(.compact)
        .cardBackdrop([page.art])
    }

    private var heroWidth: CGFloat { min(width - 72, 320) }
}

// An earning line with its rate pulled out front, when it starts with one
// ("4x Amex Membership Rewards at restaurants").
private struct EarnLine: View {
    let line: String
    @Environment(\.dynamicTypeSize) private var size
    @ScaledMetric(relativeTo: .title3) private var rateWidth: CGFloat = 44

    var body: some View {
        if let split = Self.split(line) {
            let layout = size.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
            layout {
                Text(split.rate)
                    .font(.figure(.title3))
                    .foregroundStyle(.tint)
                    .frame(minWidth: size.isAccessibilitySize ? nil : rateWidth, alignment: .leading)
                Text(split.rest)
                    .font(.subheadline)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(line)
        } else {
            Text(line)
        }
    }

    private static func split(_ line: String) -> (rate: String, rest: String)? {
        guard let space = line.firstIndex(of: " ") else { return nil }
        let rate = String(line[..<space])
        guard rate.range(of: #"^\d+(\.\d+)?(x|%)$"#, options: .regularExpression) != nil else { return nil }
        return (rate, String(line[line.index(after: space)...]))
    }
}
