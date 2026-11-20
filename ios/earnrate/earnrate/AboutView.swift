import SwiftUI

// What earnrate is, which card data and app version this is, and the
// site's privacy, terms and support pages, which open in Safari.
struct AboutView: View {
    @Environment(AppModel.self) private var model
    @State private var about: About?

    var body: some View {
        List {
            if let about {
                Section {
                    Text(about.lead)
                } footer: {
                    Text(about.privacy)
                }
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(about.data.label)
                        Text(about.data.detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    Text(about.app)
                }
                Section {
                    ForEach(about.links) { link in
                        if let url = URL(string: link.url) {
                            Link(destination: url) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(link.title)
                                            .foregroundStyle(Color.primary)
                                        if let detail = link.detail {
                                            Text(detail)
                                                .font(.subheadline)
                                                .foregroundStyle(Color.secondary)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.up.forward")
                                        .font(.footnote.weight(.semibold))
                                        .foregroundStyle(Color.secondary)
                                        .accessibilityHidden(true)
                                }
                            }
                        }
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(about.notes, id: \.self) { Text($0) }
                    }
                }
            }
        }
        .navigationTitle(about?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.dataVersion) {
            about = try? await model.about()
        }
    }
}
