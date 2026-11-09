import type { CnctChatWidget } from '../chat/types.js';

/** The colours of one appearance. Every one is a CSS colour; a hex is what the contrast rule reads. */
export interface CnctChatColors {
  /** Brand colour: the send button, links, the header's mark. */
  primary: string;
  /** Text and icons on `primary`. Black or white, whichever reads, unless set. */
  onPrimary: string;
  /** The screen. */
  background: string;
  /** The header, the composer, cards. */
  surface: string;
  /** Main text. */
  text: string;
  /** Timestamps and hints. */
  textMuted: string;
  /** Dividers and outlines. */
  border: string;
  /** The visitor's own messages. `primary` unless set. */
  visitorBubble: string;
  onVisitorBubble: string;
  /** The team's and the assistant's messages. `surface` unless set. */
  agentBubble: string;
  onAgentBubble: string;
}

/**
 * How the chat looks. The same token names on every CNCT platform.
 *
 * **Precedence: what the app passes > the inbox's widget settings in the CNCT console > the built-in
 * defaults.** So a business can brand the chat from the console with no code, or pin it in code.
 *
 * Colours set at the top level apply to both appearances; `light` and `dark` set them for one. The
 * same tokens are CSS custom properties on the element — `--cnct-primary`, `--cnct-on-primary`, …,
 * `--cnct-corner-radius`, `--cnct-font` — so a stylesheet can theme it without any JavaScript.
 */
export interface CnctChatTheme extends Partial<CnctChatColors> {
  light?: Partial<CnctChatColors>;
  dark?: Partial<CnctChatColors>;
  /** Bubbles and cards, in CSS pixels. Default 18. */
  cornerRadius?: number;
  /** A CSS `font-family`. Default: the system's. */
  font?: string;
  /** The header image's URL. Default: the inbox's logo, else the business's first letter. */
  logo?: string;
  /** The header title. Default: the business's name. */
  title?: string;
  /** Default: the inbox's appearance, where `auto` is `system`. */
  appearance?: 'light' | 'dark' | 'system';
  /** The "Powered by CNCT" line. Default: the inbox's setting. */
  showPoweredBy?: boolean;
}

/** Everything decided: one appearance's colours, and the rest. */
export interface CnctResolvedTheme extends CnctChatColors {
  appearance: 'light' | 'dark';
  cornerRadius: number;
  font: string;
  logo: string | null;
  title: string;
  showPoweredBy: boolean;
}

export const CNCT_DEFAULT_PRIMARY = '#b52d93';

/** The built-in colours of each appearance, before brand colour. */
export const CNCT_BASE_COLORS = Object.freeze({
  light: Object.freeze({
    background: '#ffffff',
    surface: '#f6f7f9',
    text: '#111418',
    textMuted: '#5b6573',
    border: '#e3e6ea',
  }),
  dark: Object.freeze({
    background: '#0f1115',
    surface: '#171a21',
    text: '#eef0f3',
    textMuted: '#9aa3af',
    border: '#2a2f38',
  }),
});

export const CNCT_DEFAULT_RADIUS = 18;

/**
 * The system's own interface font, with the faces that carry Arabic well on each platform named
 * before the generic fallback — so an Arabic interface never falls through to whichever font
 * happens to have the glyphs.
 */
export const CNCT_SYSTEM_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", "Geeza Pro", Tahoma, "DejaVu Sans", sans-serif';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Which ink reads on a colour — the same sRGB luminance rule the CNCT server and its hosted widget
 * use, so a brand colour reads the same everywhere. Half the palette a non-designer reaches for
 * makes white text unreadable; this means nobody has to solve contrast by eye.
 */
export function readableInk(color: string): '#141414' | '#ffffff' {
  const hex = expandHex(color);
  if (!hex) return '#ffffff';
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.55 ? '#141414' : '#ffffff';
}

/** `#abc` and `#aabbcc` as `#aabbcc`; anything else as null. */
export function expandHex(color: string | null | undefined): string | null {
  const value = String(color ?? '').trim();
  if (HEX.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  return null;
}

/** Light or dark for an appearance setting, where `system` (or the inbox's `auto`) asks the OS. */
export function resolveAppearance(
  setting: 'light' | 'dark' | 'system' | 'auto' | null | undefined,
  systemPrefersDark: boolean,
): 'light' | 'dark' {
  if (setting === 'light' || setting === 'dark') return setting;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * The theme, decided. App first, then the inbox's widget settings, then the defaults — token by
 * token, so an app that sets only `primary` still gets the console's logo and the default surfaces.
 */
export function resolveTheme(input: {
  theme?: CnctChatTheme | null;
  widget?: CnctChatWidget | null;
  business?: string;
  systemPrefersDark?: boolean;
}): CnctResolvedTheme {
  const app = input.theme ?? {};
  const brand = input.widget?.brand;
  const appearance = resolveAppearance(
    app.appearance ?? (brand?.appearance === 'auto' ? 'system' : brand?.appearance),
    Boolean(input.systemPrefersDark),
  );
  const scoped: Partial<CnctChatColors> = {
    ...pickColors(app),
    ...pickColors(app[appearance] ?? {}),
  };
  const base = CNCT_BASE_COLORS[appearance];

  const serverPrimary = expandHex(brand?.color);
  const primary = scoped.primary ?? serverPrimary ?? CNCT_DEFAULT_PRIMARY;
  const onPrimary = scoped.onPrimary ?? readableInk(primary);
  const background = scoped.background ?? base.background;
  const surface = scoped.surface ?? base.surface;
  const text = scoped.text ?? base.text;
  const visitorBubble = scoped.visitorBubble ?? primary;

  return {
    appearance,
    primary,
    onPrimary,
    background,
    surface,
    text,
    textMuted: scoped.textMuted ?? base.textMuted,
    border: scoped.border ?? base.border,
    visitorBubble,
    // An app that recolours the visitor's bubble without saying its ink still gets readable text.
    onVisitorBubble:
      scoped.onVisitorBubble ?? (scoped.visitorBubble ? readableInk(visitorBubble) : onPrimary),
    agentBubble: scoped.agentBubble ?? surface,
    onAgentBubble: scoped.onAgentBubble ?? text,
    cornerRadius:
      typeof app.cornerRadius === 'number' &&
      Number.isFinite(app.cornerRadius) &&
      app.cornerRadius >= 0
        ? app.cornerRadius
        : CNCT_DEFAULT_RADIUS,
    font: app.font?.trim() || CNCT_SYSTEM_FONT,
    logo: app.logo ?? brand?.avatarUrl ?? null,
    title: app.title ?? input.business ?? '',
    showPoweredBy: app.showPoweredBy ?? brand?.showBranding ?? true,
  };
}

const COLOR_KEYS: (keyof CnctChatColors)[] = [
  'primary',
  'onPrimary',
  'background',
  'surface',
  'text',
  'textMuted',
  'border',
  'visitorBubble',
  'onVisitorBubble',
  'agentBubble',
  'onAgentBubble',
];

function pickColors(source: Partial<CnctChatColors>): Partial<CnctChatColors> {
  const out: Partial<CnctChatColors> = {};
  for (const key of COLOR_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** `onPrimary` as `on-primary`: the token's CSS custom property is `--cnct-on-primary`. */
export function cssVariableName(token: keyof CnctChatColors | 'cornerRadius' | 'font'): string {
  return `--cnct-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** The custom properties a theme sets, by their public names. */
export const CNCT_THEME_VARIABLES: readonly string[] = [
  ...COLOR_KEYS,
  'cornerRadius' as const,
  'font' as const,
].map((key) => cssVariableName(key));

/**
 * The element's private defaults (`--_d-*`), which every public `--cnct-*` property overrides.
 *
 * Where the app set a colour in code it is written here as a value. Where it did not, the derived
 * ones are written as references — the visitor's bubble is `var(--_primary)` rather than today's
 * primary — so a stylesheet that sets only `--cnct-primary` recolours the bubbles with it.
 * `cssPrimary` is a primary set by such a stylesheet, which is what the readable ink is worked out
 * from when the app did not choose one.
 */
export function themeVariables(
  resolved: CnctResolvedTheme,
  app: CnctChatTheme | null | undefined,
  cssPrimary?: string | null,
): Record<string, string> {
  const explicit = { ...pickColors(app ?? {}), ...pickColors(app?.[resolved.appearance] ?? {}) };
  const inkFrom = expandHex(cssPrimary) ?? resolved.primary;
  return {
    '--_d-primary': resolved.primary,
    '--_d-on-primary': explicit.onPrimary ?? readableInk(inkFrom),
    '--_d-background': resolved.background,
    '--_d-surface': resolved.surface,
    '--_d-text': resolved.text,
    '--_d-text-muted': resolved.textMuted,
    '--_d-border': resolved.border,
    '--_d-visitor-bubble': explicit.visitorBubble ?? 'var(--_primary)',
    '--_d-on-visitor-bubble':
      explicit.onVisitorBubble ??
      (explicit.visitorBubble ? readableInk(explicit.visitorBubble) : 'var(--_on-primary)'),
    '--_d-agent-bubble': explicit.agentBubble ?? 'var(--_surface)',
    '--_d-on-agent-bubble': explicit.onAgentBubble ?? 'var(--_text)',
    '--_d-corner-radius': `${resolved.cornerRadius}px`,
    '--_d-font': resolved.font,
  };
}
