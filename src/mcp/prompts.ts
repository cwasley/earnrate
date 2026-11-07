import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Context } from './context.ts'
import type { ServerDeps } from './server.ts'

// Ready-made questions a client can offer: the user's question, then what
// to call and how to answer. Rates and card facts come only from the tools.
export const PROMPTS = ['which-card', 'cheat-sheet', 'this-quarter', 'set-up']

const FROM_SAVED_OR_ALL =
  "the user's saved cards if there are any, otherwise every card earnrate knows"

const ask = (question: string, guidance: string[]) => ({
  messages: [
    {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `${question}\n\n${guidance.join(' ')}`,
      },
    },
  ],
})

const dollars = (amount: string) => (/^\d/.test(amount) ? `$${amount}` : amount)

export function registerPrompts(
  server: McpServer,
  deps: ServerDeps,
  ctx: Context,
) {
  server.registerPrompt(
    'which-card',
    {
      title: 'Which credit card should I use?',
      description:
        'The card that earns the most at a store or for a kind of purchase, with the reason. From your saved cards, or every card if you have none saved.',
      argsSchema: z.object({
        store: z
          .string()
          .trim()
          .min(1)
          .describe('The store, or the kind of purchase: Costco, groceries'),
        amount: z
          .string()
          .optional()
          .describe('How much you are spending, in US dollars'),
        country: z
          .string()
          .optional()
          .describe('Where you are paying, if not the U.S.: FR, Japan'),
        paying: z
          .string()
          .optional()
          .describe('How you are paying, if you know: Apple Pay, PayPal'),
      }),
    },
    (args) => {
      const amount = args.amount?.trim() || null
      const country = args.country?.trim() || null
      const paying = args.paying?.trim() || null
      const call = [
        `merchant ${JSON.stringify(args.store)}`,
        ...(amount === null
          ? []
          : [`amount ${JSON.stringify(amount)} as a number of US dollars`]),
        ...(country === null
          ? []
          : [`country as the two-letter code for ${JSON.stringify(country)}`]),
        ...(paying === null
          ? []
          : [`payment for paying with ${JSON.stringify(paying)}`]),
      ]
      return ask(
        `Which credit card should I use at ${args.store}${amount === null ? '' : ` for ${dollars(amount)}`}${country === null ? '' : ` in ${country}`}${paying === null ? '' : ` with ${paying}`}?`,
        [
          `Call earnrate's best_card_for_purchase with ${call.join(', ')}.`,
          `It answers from ${FROM_SAVED_OR_ALL}, so don't ask for their cards first.`,
          'Say which card to use and why, with the assumptions and warnings it gives.',
          ...(country === null
            ? [
                'If the user mentions paying abroad or in another currency, ask where, or pass `country` as its two-letter code.',
              ]
            : []),
        ],
      )
    },
  )

  server.registerPrompt(
    'cheat-sheet',
    {
      title: 'Which card for everyday spending?',
      description:
        'The card to use for each everyday kind of purchase right now, from your saved cards or every card.',
    },
    () =>
      ask('Which card should I use for everyday spending?', [
        "Call earnrate's cheat_sheet and show the card for each kind of purchase, with its notes.",
        `It uses ${FROM_SAVED_OR_ALL}.`,
      ]),
  )

  server.registerPrompt(
    'this-quarter',
    {
      title: 'What should I do with my cards this quarter?',
      description:
        'Bonuses to activate, categories to pick, caps running low, welcome bonuses to finish and fee cards coming up for renewal, from your saved cards.',
    },
    () =>
      ask('What should I do with my cards this quarter?', [
        "Call earnrate's list_wallet: it starts with a to-do list. Walk through it, soonest first. A renewal check says whether a fee card still pays for itself; give its math as stated, and don't recommend canceling or downgrading on your own.",
        ctx.walletUse,
        'If no cards are saved, say in a sentence or two what saving them adds (reminders to activate bonuses, pick categories, and watch caps and welcome bonuses), without pressing the user to do it, and offer the cheat sheet from every card instead.',
      ]),
  )

  server.registerPrompt(
    'set-up',
    {
      title: 'Set up my cards',
      description:
        'Save the cards you hold, by name, with their category picks, memberships and activations.',
    },
    () =>
      ask('Help me set up my cards in earnrate.', [
        'Ask which cards the user has; their names are enough. Never ask for card numbers, expiry dates or security codes.',
        ...(deps.savedWallets === 'account'
          ? [
              "Never ask for the recovery code either; it's typed only on earnrate's page.",
            ]
          : []),
        'Find each card with search_cards and check the match with the user, then save it with add_card.',
        ctx.walletUse,
        "When a card needs category picks, a membership like Amazon Prime, activations or its anniversary, ask rather than guessing, and save the answers with update_card or set_memberships. For a card with an annual fee, offer to save its anniversary (or opening date) so earnrate can check before each renewal whether it still pays for itself; it's optional.",
        'When done, call list_wallet and show its to-do list.',
      ]),
  )
}
