import SwiftUI

// A card's page: what it earns, its offer, credits and fees, as the site's
// card page and Claude's search_cards say them.
struct CardPageView: View {
    @Environment(AppModel.self) private var model
    let id: String

    @State private var page: CardPage?
    @State private var failure: String?
    @State private var refusal: String?

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
        .task(id: model.walletCards.map(\.id)) {
            do {
                page = try await model.cardPage(id)
            } catch {
                failure = error.localizedDescription
            }
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
                if held {
                    NavigationLink(value: Route.settings(id, nil)) {
                        Label("Settings", systemImage: "slider.horizontal.3")
                    }
                    Button("Remove from My wallet", systemImage: "minus.circle", role: .destructive) {
                        Task { refusal = await model.remove(id) }
                    }
                    .tint(.red)
                } else {
                    Button("Add to My wallet", systemImage: "plus.circle") {
                        Task { refusal = await model.add(id) }
                    }
                }
            } header: {
                VStack(spacing: 12) {
                    CardArtView(art: page.art, width: 172, shine: true)
                    VStack(spacing: 4) {
                        Text(page.name)
                            .font(.title2.bold())
                            .foregroundStyle(Color.primary)
                            .accessibilityAddTraits(.isHeader)
                        Text("\(page.issuer) · \(page.fee)")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                    }
                    .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .textCase(nil)
                .padding(.bottom, 8)
            }

            if !page.earning.isEmpty {
                Section {
                    ForEach(page.earning, id: \.self) { Text($0) }
                } header: {
                    Text("Earns")
                } footer: {
                    if let note = page.ratesNote { Text(note) }
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
                    Text("Public welcome offer")
                } footer: {
                    Text(offer.mayDiffer)
                }
            } else if let history = page.offerHistory {
                Section("Offer history") {
                    Text(history)
                }
            }

            if !page.credits.isEmpty {
                Section("Statement credits") {
                    ForEach(page.credits, id: \.self) { Text($0) }
                }
            }

            if !page.perks.isEmpty {
                Section("Also") {
                    ForEach(page.perks, id: \.self) { Text($0) }
                }
            }

            if let worth = page.feeWorth {
                Section {
                    DisclosureGroup("Is the fee worth it?") {
                        Text(worth)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Fees") {
                Text(page.fee)
                Text(page.foreignFee)
                LabeledContent("Network", value: page.network)
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
                Text("Issuer's pages")
            } footer: {
                Text(page.checked)
            }
        }
        .listSectionSpacing(.compact)
    }
}
