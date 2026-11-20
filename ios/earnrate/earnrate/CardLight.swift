import CoreMotion
import SwiftUI

// Where the light falls on a drawn card as the phone tilts, like the shine on
// a card in Apple Wallet. Device motion needs no permission and stays on the
// phone. One motion manager for the app, running only while a card that
// shows the light is on screen, the app is active, and neither Reduce Motion
// nor Low Power Mode is on.
@Observable final class CardLight {
    static let shared = CardLight()

    // -1...1 across and down, eased.
    private(set) var tilt = CGPoint.zero
    private(set) var live = false

    @ObservationIgnored private let manager = CMMotionManager()
    @ObservationIgnored private var watchers = 0
    @ObservationIgnored private var active = true

    func watch() {
        watchers += 1
        update()
    }

    func unwatch() {
        watchers = max(0, watchers - 1)
        update()
    }

    func setActive(_ on: Bool) {
        active = on
        update()
    }

    private func update() {
        let wanted = watchers > 0 && active
            && !UIAccessibility.isReduceMotionEnabled
            && !ProcessInfo.processInfo.isLowPowerModeEnabled
            && manager.isDeviceMotionAvailable
        if wanted && !manager.isDeviceMotionActive {
            manager.deviceMotionUpdateInterval = 1.0 / 30
            manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
                guard let motion else { return }
                MainActor.assumeIsolated { self?.move(motion.gravity) }
            }
            live = true
        } else if !wanted && manager.isDeviceMotionActive {
            manager.stopDeviceMotionUpdates()
            live = false
            tilt = .zero
        }
    }

    // Gravity along the screen: held upright and still, the light sits a
    // little above center; tilting moves it the other way, as a reflection.
    private func move(_ g: CMAcceleration) {
        let x = max(-1, min(1, g.x * 1.6))
        let y = max(-1, min(1, (g.y + 0.6) * 1.6))
        tilt = CGPoint(x: tilt.x * 0.8 + x * 0.2, y: tilt.y * 0.8 + y * 0.2)
    }
}

// The light over a card's face: a soft highlight that follows the tilt (on a
// phone), and one sweep of light across it when it first appears. Nothing
// moves with Reduce Motion on.
struct CardShine: View {
    let corner: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweep: CGFloat = -1.4
    private var light: CardLight { CardLight.shared }

    var body: some View {
        if reduceMotion {
            Color.clear
        } else {
            GeometryReader { box in
                let w = box.size.width
                ZStack {
                    if light.live {
                        RadialGradient(
                            colors: [.white.opacity(0.28), .white.opacity(0)],
                            center: UnitPoint(x: 0.5 - light.tilt.x * 0.6, y: 0.35 - light.tilt.y * 0.5),
                            startRadius: 0,
                            endRadius: w * 0.7
                        )
                        .blendMode(.plusLighter)
                    }
                    LinearGradient(
                        stops: [
                            .init(color: .white.opacity(0), location: 0),
                            .init(color: .white.opacity(0.3), location: 0.5),
                            .init(color: .white.opacity(0), location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: w * 0.4, height: box.size.height * 3)
                    .rotationEffect(.degrees(20))
                    .offset(x: sweep * w)
                    .blendMode(.plusLighter)
                }
                .frame(width: w, height: box.size.height)
            }
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            .allowsHitTesting(false)
            .onAppear {
                light.watch()
                withAnimation(.easeInOut(duration: 1.1).delay(0.35)) { sweep = 1.4 }
            }
            .onDisappear { light.unwatch() }
        }
    }
}

// A small sparkle at a card's corner: the card earnrate picked. It twinkles
// once as it appears; with Reduce Motion it simply shows.
struct PickSparkle: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    @State private var twinkle = 0

    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(
                LinearGradient(colors: [.yellow, .orange], startPoint: .top, endPoint: .bottom)
            )
            .shadow(color: .yellow.opacity(0.5), radius: 3)
            .symbolEffect(.bounce, value: twinkle)
            .scaleEffect(shown || reduceMotion ? 1 : 0.2)
            .opacity(shown || reduceMotion ? 1 : 0)
            .accessibilityHidden(true)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.spring(duration: 0.5, bounce: 0.5).delay(0.5)) { shown = true }
                Task {
                    try? await Task.sleep(for: .milliseconds(900))
                    twinkle += 1
                }
            }
    }
}
