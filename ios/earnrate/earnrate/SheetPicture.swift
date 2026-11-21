import CoreTransferable
import PassKit
import SwiftUI
import UniformTypeIdentifiers

// The cheat sheet as a picture to share, drawn like the site's
// (site/app/sheet-image.ts): the quarter, each purchase with the card and
// rate, and the date. Nothing else about the person: no notes, amounts,
// stores asked about or checkout names. 1080 × 1350 pixels.
struct SheetPicture: View {
    let sheet: WalletHome.Sheet
    let dark: Bool

    static let size = CGSize(width: 360, height: 450)

    // The site picture's colors (site/app/picture.ts), so a shared sheet
    // looks the same from either.
    private var paper: Color { Color(hex: dark ? "#1c1a18" : "#ffffff") }
    private var ink: Color { Color(hex: dark ? "#eeebe6" : "#1d1b19") }
    private var muted: Color { Color(hex: dark ? "#a8a29c" : "#625d58") }
    private var line: Color { Color(hex: dark ? "#2e2a27" : "#e8e1d9") }
    private var accent: Color { Color(hex: dark ? "#e8a877" : "#9a5020") }

    private let pad: CGFloat = 24

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            rows
                .padding(.horizontal, pad)
                .padding(.top, 14)
            Spacer(minLength: 8)
            footer
                .padding(.horizontal, pad)
                .padding(.bottom, 18)
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .background(paper)
        .environment(\.colorScheme, dark ? .dark : .light)
        .dynamicTypeSize(.large)
    }

    private var header: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                Text("earnrate")
                    .font(.system(size: 13.3, weight: .bold))
                    .padding(.top, 22)
                Text(sheet.share.title)
                    .font(.system(size: 22, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.top, 10)
                    .padding(.trailing, 72)
                Text(sheet.share.subtitle)
                    .font(.system(size: 10))
                    .opacity(0.82)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            StackedCards(color: paper, chip: accent)
                .frame(width: 72, height: 48)
                .padding(.top, 17)
        }
        .foregroundStyle(paper)
        .padding(.horizontal, pad)
        .frame(height: 93, alignment: .top)
        .background(accent)
    }

    private var rows: some View {
        let shown = sheet.rows
        let height = min(34.7, (Self.size.height - 93 - 14 - 63 - 8) / CGFloat(max(shown.count, 1)))
        return VStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 0) {
                    Text(row.label)
                        .font(.system(size: 9.3, weight: .medium))
                        .foregroundStyle(muted)
                        .lineLimit(1)
                        .frame(width: 100, alignment: .leading)
                    Text(row.name)
                        .font(.system(size: 11.3, weight: .semibold))
                        .foregroundStyle(ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !row.rate.isEmpty {
                        Text(row.rate)
                            .font(.system(size: 13.3, weight: .bold))
                            .foregroundStyle(accent)
                            .padding(.leading, 8)
                    }
                }
                .frame(height: height)
                .overlay(alignment: .bottom) {
                    if index < shown.count - 1 {
                        Rectangle().fill(line).frame(height: 0.67)
                    }
                }
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(sheet.share.footer, id: \.self) { note in
                Text(note)
                    .font(.system(size: 8.7))
                    .foregroundStyle(muted)
            }
            Text(sheet.share.site)
                .font(.system(size: 10.7, weight: .bold))
                .foregroundStyle(accent)
                .padding(.top, 6)
        }
    }

    // A PNG of the picture at three times its size.
    @MainActor
    static func png(_ sheet: WalletHome.Sheet, dark: Bool) -> Data? {
        let renderer = ImageRenderer(content: SheetPicture(sheet: sheet, dark: dark))
        renderer.scale = 3
        renderer.proposedSize = ProposedViewSize(size)
        return renderer.uiImage?.pngData()
    }
}

// The stacked-cards mark (site/app/Logo.tsx), in its 120 × 80 box.
private struct StackedCards: View {
    let color: Color
    let chip: Color

    var body: some View {
        Canvas { context, size in
            let s = size.width / 120
            func box(_ x: CGFloat, _ y: CGFloat) -> Path {
                Path(roundedRect: CGRect(x: x * s, y: y * s, width: 92 * s, height: 58 * s), cornerRadius: 9 * s)
            }
            context.stroke(box(22, 6), with: .color(color.opacity(0.3)), lineWidth: 2 * s)
            context.stroke(box(14, 12), with: .color(color.opacity(0.55)), lineWidth: 2 * s)
            context.fill(box(6, 18), with: .color(color))
            context.fill(Path(roundedRect: CGRect(x: 18 * s, y: 34 * s, width: 16 * s, height: 12 * s), cornerRadius: 2 * s), with: .color(chip))
        }
        .accessibilityHidden(true)
    }
}

// The picture as a file for the share sheet, named as the site names it.
struct SheetPictureFile: Transferable {
    let png: Data
    let filename: String

    var preview: Image {
        UIImage(data: png).map { Image(uiImage: $0) } ?? Image(systemName: "photo")
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { $0.png }
            .suggestedFileName { $0.filename }
    }
}

// Under the cheat sheet: share it as a picture, and add it to Apple Wallet.
// Both quiet, both only for someone with cards saved.
struct SheetActions: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var size
    let sheet: WalletHome.Sheet

    @State private var picture: SheetPictureFile?
    @State private var making = false
    @State private var pass: PKPass?
    @State private var failure: (title: String, message: String)?

    var body: some View {
        VStack(spacing: 10) {
            let layout = size.isAccessibilitySize
                ? AnyLayout(VStackLayout(spacing: 12))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
            layout {
                if PKAddPassesViewController.canAddPasses() {
                    ZStack {
                        AddPassButton(dark: scheme == .dark) { Task { await addPass() } }
                            .frame(width: 150, height: 44)
                            .opacity(making ? 0.4 : 1)
                            .disabled(making)
                            .accessibilityLabel(sheet.pass.label)
                        if making { ProgressView() }
                    }
                }
                if let picture {
                    ShareLink(item: picture, preview: SharePreview(sheet.share.title, image: picture.preview)) {
                        Label(sheet.share.label, systemImage: "square.and.arrow.up")
                            .frame(minHeight: 26)
                    }
                    .buttonStyle(PlateButtonStyle())
                    .accessibilityLabel(sheet.share.accessibility)
                }
            }
            if PKAddPassesViewController.canAddPasses() {
                Text(sheet.pass.note)
                    .font(.caption)
                    .foregroundStyle(Color.inkSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .task(id: "\(sheet.subtitle)|\(sheet.rows.map { $0.name + $0.rate }.joined())|\(scheme == .dark)") {
            if let png = SheetPicture.png(sheet, dark: scheme == .dark) {
                picture = SheetPictureFile(png: png, filename: sheet.share.filename)
                #if DEBUG
                // Debug builds leave the picture in the app's temporary
                // folder, for review.
                try? png.write(to: FileManager.default.temporaryDirectory.appending(path: sheet.share.filename))
                #endif
            }
        }
        .sheet(isPresented: Binding(get: { pass != nil }, set: { if !$0 { pass = nil } })) {
            if let pass {
                AddPassSheet(pass: pass) { self.pass = nil }
                    .ignoresSafeArea()
            }
        }
        .alert(failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure?.message ?? "")
        }
    }

    private func addPass() async {
        guard !making else { return }
        making = true
        defer { making = false }
        guard let request = try? await model.walletPass() else { return }
        do {
            pass = try await PassRequest.make(request)
        } catch {
            failure = (request.failed, error.localizedDescription)
        }
    }
}
