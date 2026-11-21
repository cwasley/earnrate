import UIKit
import UserNotifications

// Reminders before the to-do's deadlines, as notifications scheduled on
// this phone: the engine picks the items and the mornings (`reminders` in
// ios/engine/entry.ts), and nothing is sent anywhere. Off until the person
// turns them on, and the phone asks to allow notifications only then.
enum ReminderSchedule {
    private static let prefix = "reminder."
    private static let hour = 9

    private static var center: UNUserNotificationCenter { .current() }

    static func allow() async -> Bool {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        case .denied:
            return false
        default:
            return true
        }
    }

    static func denied() async -> Bool {
        await center.notificationSettings().authorizationStatus == .denied
    }

    // In place of every reminder scheduled before: an item that's done or
    // gone from the to-do loses its reminder.
    static func replace(with items: [Reminders.Item], now: Date = .now) async {
        await clear()
        let calendar = Calendar.current
        for item in items {
            guard let day = Day.date(item.remindOn) else { continue }
            var when = calendar.dateComponents([.year, .month, .day], from: day)
            when.hour = hour
            guard let fires = calendar.date(from: when), fires > now else { continue }
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.subtitle = item.card
            content.body = item.body
            content.sound = .default
            content.threadIdentifier = item.cardId
            content.userInfo = ["cardId": item.cardId, "focus": item.focus?.rawValue ?? ""]
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: prefix + item.id, content: content, trigger: trigger))
        }
        #if DEBUG
        // `-EarnrateRemindSoon YES`: the first reminder again, ten seconds
        // out, to see one arrive.
        if UserDefaults.standard.bool(forKey: "EarnrateRemindSoon"), let item = items.first {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.subtitle = item.card
            content.body = item.body
            content.sound = .default
            content.userInfo = ["cardId": item.cardId, "focus": item.focus?.rawValue ?? ""]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 10, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: prefix + "soon", content: content, trigger: trigger))
        }
        #endif
    }

    static func clear() async {
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
}

// Shows a reminder that arrives with the app open, and opens the card's
// settings when one is tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let cardId = info["cardId"] as? String else { return }
        let focus = (info["focus"] as? String).flatMap(SettingsFocus.init(rawValue:))
        await MainActor.run {
            AppModel.shared.go(.settings(cardId, focus))
        }
    }
}
