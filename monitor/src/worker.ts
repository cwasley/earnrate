import { onSchedule } from './monitor.ts'

type Env = { GH_DISPATCH_TOKEN?: string }

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await onSchedule(
      controller.cron,
      env.GH_DISPATCH_TOKEN,
      fetch,
      new Date(controller.scheduledTime),
    )
  },
} satisfies ExportedHandler<Env>
