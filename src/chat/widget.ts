import type {
  CnctChatAvailability,
  CnctChatInbox,
  CnctChatPerson,
  CnctChatWidget,
} from './types.js';

/**
 * What an inbox's chat settings are before the console has said otherwise — the same defaults the
 * server merges over and the hosted chat page starts from, so the three cannot disagree about what
 * an untouched inbox looks like.
 */
export const CNCT_WIDGET_DEFAULTS: CnctChatWidget = Object.freeze({
  brand: Object.freeze({
    color: '#b52d93',
    appearance: 'light',
    businessName: null,
    avatarUrl: null,
    language: 'auto',
    showBranding: true,
  }),
  launcher: Object.freeze({
    side: 'right',
    shape: 'circle',
    size: 'medium',
    label: 'Chat with us',
    offset: 20,
    hideOnMobile: false,
    showReplyPreview: true,
  }),
  home: Object.freeze({
    enabled: true,
    heading: 'Hello.',
    tagline: 'Ask us anything.',
    questions: [] as string[],
    showTeam: true,
  }),
  chat: Object.freeze({
    allowAttachments: true,
    allowEmoji: true,
    allowEndConversation: false,
    start: 'details',
    askForRating: true,
  }),
}) as CnctChatWidget;

/**
 * The server's widget settings over the defaults, **section by section** — never a shallow spread,
 * which would let a response carrying `brand: { color }` and nothing else wipe out every other brand
 * field. A value of the wrong type is dropped for the default rather than passed on, because a UI
 * that reads `appearance` should never have to wonder whether it is a string.
 */
export function mergeWidget(raw: unknown): CnctChatWidget {
  const source = isObject(raw) ? raw : {};
  const section = <K extends keyof CnctChatWidget>(key: K): CnctChatWidget[K] => {
    const defaults = CNCT_WIDGET_DEFAULTS[key] as Record<string, unknown>;
    const given = isObject(source[key]) ? (source[key] as Record<string, unknown>) : {};
    const merged: Record<string, unknown> = { ...defaults };
    for (const [name, value] of Object.entries(given)) {
      const fallback = defaults[name];
      if (fallback === undefined || fallback === null || value === null) merged[name] = value;
      else if (Array.isArray(fallback)) merged[name] = Array.isArray(value) ? value : fallback;
      else if (typeof value === typeof fallback) merged[name] = value;
    }
    return merged as CnctChatWidget[K];
  };
  return {
    brand: section('brand'),
    launcher: section('launcher'),
    home: section('home'),
    chat: section('chat'),
  };
}

/**
 * The inbox as `boot()` publishes it: lenient about what the server sent, strict about what it
 * hands on. Unknown fields are ignored; missing ones become their documented empty value.
 */
export function normaliseInbox(raw: unknown): CnctChatInbox {
  const data = isObject(raw) ? raw : {};
  return {
    business: typeof data.business === 'string' ? data.business : '',
    inbox: typeof data.inbox === 'string' ? data.inbox : '',
    isActive: Boolean(data.isActive),
    greeting: typeof data.greeting === 'string' ? data.greeting : '',
    requirePhone: Boolean(data.requirePhone),
    widget: mergeWidget(data.widget),
    team: Array.isArray(data.team) ? data.team.filter(isObject).map(person) : [],
    availability: isObject(data.availability) ? availability(data.availability) : null,
  };
}

function person(raw: Record<string, unknown>): CnctChatPerson {
  return {
    kind: 'person',
    name: typeof raw.name === 'string' ? raw.name : null,
    avatar: typeof raw.avatar === 'string' ? raw.avatar : null,
  };
}

function availability(raw: Record<string, unknown>): CnctChatAvailability {
  return {
    open: typeof raw.open === 'boolean' ? raw.open : null,
    opensAt: typeof raw.opensAt === 'string' ? raw.opensAt : null,
    assistant: Boolean(raw.assistant),
    replyMinutes:
      typeof raw.replyMinutes === 'number' && Number.isFinite(raw.replyMinutes)
        ? raw.replyMinutes
        : null,
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
