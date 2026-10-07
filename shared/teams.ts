/**
 * Microsoft Teams Webhook & Adaptive Card Notification System
 * Generates Adaptive Card v1.5 JSON payloads for Teams incoming webhooks
 * and powers the in-app Teams toast feed.
 */

export interface TeamsAdaptiveCard {
  id: string;
  timestamp: number;
  title: string;
  subtitle: string;
  color: string;
  facts: { title: string; value: string }[];
  summary: string;
  actionUrl?: string;
}

export function buildTeamsCard(opts: {
  title: string;
  subtitle: string;
  color?: string;
  summary: string;
  facts?: { title: string; value: string }[];
  actionUrl?: string;
}): TeamsAdaptiveCard {
  return {
    id: `teams-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    title: opts.title,
    subtitle: opts.subtitle,
    color: opts.color ?? '#464EB8', // Microsoft Teams purple
    facts: opts.facts ?? [],
    summary: opts.summary,
    actionUrl: opts.actionUrl,
  };
}

export function formatAdaptiveCardJson(card: TeamsAdaptiveCard): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.5',
          body: [
            {
              type: 'Container',
              items: [
                {
                  type: 'TextBlock',
                  text: card.title,
                  weight: 'Bolder',
                  size: 'Medium',
                  color: 'Accent',
                },
                {
                  type: 'TextBlock',
                  text: card.subtitle,
                  isSubtle: true,
                  spacing: 'None',
                  size: 'Small',
                },
                {
                  type: 'TextBlock',
                  text: card.summary,
                  wrap: true,
                  spacing: 'Medium',
                },
                {
                  type: 'FactSet',
                  facts: card.facts,
                },
              ],
            },
          ],
          actions: card.actionUrl
            ? [
                {
                  type: 'Action.OpenUrl',
                  title: 'Open in Cubefarm Office',
                  url: card.actionUrl,
                },
              ]
            : [],
        },
      },
    ],
  };
}
