import { describe, expect, it } from 'vitest';
import { CNCT_WIDGET_DEFAULTS, mergeWidget } from '../src/index.js';
import {
  CNCT_SYSTEM_FONT,
  CNCT_THEME_VARIABLES,
  cssVariableName,
  readableInk,
  resolveAppearance,
  resolveTheme,
  themeVariables,
} from '../src/ui/index.js';

/**
 * How the chat looks, and who decides: what the app passes, then the inbox's settings in the CNCT
 * console, then the defaults — token by token.
 */

const serverWidget = mergeWidget({
  brand: {
    color: '#123456',
    appearance: 'dark',
    avatarUrl: 'https://cdn.example.com/logo.png',
    showBranding: false,
  },
});

describe('precedence', () => {
  it('is the defaults when nobody said anything', () => {
    const theme = resolveTheme({ widget: CNCT_WIDGET_DEFAULTS, business: 'Harbour Café' });
    expect(theme).toMatchObject({
      appearance: 'light',
      primary: '#b52d93',
      onPrimary: '#ffffff',
      background: '#ffffff',
      surface: '#f6f7f9',
      text: '#111418',
      textMuted: '#5b6573',
      border: '#e3e6ea',
      visitorBubble: '#b52d93',
      onVisitorBubble: '#ffffff',
      agentBubble: '#f6f7f9',
      onAgentBubble: '#111418',
      cornerRadius: 18,
      font: CNCT_SYSTEM_FONT,
      logo: null,
      title: 'Harbour Café',
      showPoweredBy: true,
    });
  });

  it('is the inbox’s settings over the defaults', () => {
    const theme = resolveTheme({ widget: serverWidget, business: 'Harbour Café' });
    expect(theme).toMatchObject({
      appearance: 'dark',
      primary: '#123456',
      background: '#0f1115',
      surface: '#171a21',
      text: '#eef0f3',
      logo: 'https://cdn.example.com/logo.png',
      showPoweredBy: false,
    });
  });

  it('is the app’s over the inbox’s, token by token', () => {
    const theme = resolveTheme({
      widget: serverWidget,
      business: 'Harbour Café',
      theme: {
        primary: '#D7262E',
        cornerRadius: 8,
        font: 'Cairo, sans-serif',
        title: 'Help',
        appearance: 'light',
        showPoweredBy: true,
      },
    });
    expect(theme).toMatchObject({
      appearance: 'light',
      primary: '#D7262E',
      cornerRadius: 8,
      font: 'Cairo, sans-serif',
      title: 'Help',
      showPoweredBy: true,
      // Not set by the app, so still the inbox's.
      logo: 'https://cdn.example.com/logo.png',
      // Not set by anyone, so the default of the appearance in force.
      background: '#ffffff',
    });
  });

  it('gives light and dark their own colours, the app able to set either or both', () => {
    const app = {
      primary: '#D7262E',
      light: { background: '#fffaf5' },
      dark: { background: '#1a0f0f', primary: '#ff6b6b' },
    };
    const light = resolveTheme({ theme: { ...app, appearance: 'light' } });
    const dark = resolveTheme({ theme: { ...app, appearance: 'dark' } });
    expect([light.primary, light.background]).toEqual(['#D7262E', '#fffaf5']);
    expect([dark.primary, dark.background]).toEqual(['#ff6b6b', '#1a0f0f']);
    expect(dark.surface).toBe('#171a21');
  });

  it('follows the system when the inbox says auto, or the app says system', () => {
    const auto = mergeWidget({ brand: { appearance: 'auto' } });
    expect(resolveTheme({ widget: auto, systemPrefersDark: true }).appearance).toBe('dark');
    expect(resolveTheme({ widget: auto, systemPrefersDark: false }).appearance).toBe('light');
    expect(resolveTheme({ widget: serverWidget, theme: { appearance: 'system' } }).appearance).toBe(
      'light',
    );
    expect(resolveAppearance('system', true)).toBe('dark');
  });

  it('ignores a server colour that is not a colour', () => {
    const odd = mergeWidget({ brand: { color: 'red; background:url(x)' } });
    expect(resolveTheme({ widget: odd }).primary).toBe('#b52d93');
  });
});

describe('the ink on the brand colour', () => {
  /** The widget's rule: sRGB luminance over 0.55 takes near-black, anything darker takes white. */
  it('is black or white, whichever reads', () => {
    expect(readableInk('#b52d93')).toBe('#ffffff');
    expect(readableInk('#D7262E')).toBe('#ffffff');
    expect(readableInk('#123456')).toBe('#ffffff');
    expect(readableInk('#f6c343')).toBe('#141414');
    expect(readableInk('#ffffff')).toBe('#141414');
    expect(readableInk('#7fdbff')).toBe('#141414');
    expect(readableInk('#abc')).toBe('#ffffff');
    expect(readableInk('#ddd')).toBe('#141414');
  });

  it('switches where the luminance crosses 0.55', () => {
    // #c8c8c8 is 0.578; #bdbdbd is 0.509.
    expect(readableInk('#c8c8c8')).toBe('#141414');
    expect(readableInk('#bdbdbd')).toBe('#ffffff');
  });

  it('follows a primary the app set, unless the app set the ink too', () => {
    expect(resolveTheme({ theme: { primary: '#f6c343' } }).onPrimary).toBe('#141414');
    expect(resolveTheme({ theme: { primary: '#f6c343', onPrimary: '#000080' } }).onPrimary).toBe(
      '#000080',
    );
    // A visitor bubble recoloured on its own gets ink of its own.
    expect(resolveTheme({ theme: { visitorBubble: '#ffffff' } }).onVisitorBubble).toBe('#141414');
  });
});

describe('the default colours', () => {
  /** WCAG's contrast ratio, for checking the defaults read at 4.5:1 or better. */
  const contrast = (a: string, b: string) => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, bl] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };

  it.each(['light', 'dark'] as const)('read at 4.5:1 or better in %s', (appearance) => {
    const theme = resolveTheme({ theme: { appearance } });
    for (const [fg, bg] of [
      [theme.text, theme.background],
      [theme.text, theme.surface],
      [theme.textMuted, theme.background],
      [theme.textMuted, theme.surface],
      [theme.onPrimary, theme.primary],
      [theme.onAgentBubble, theme.agentBubble],
    ] as const) {
      expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the CSS custom properties', () => {
  it('are the token names, kebab case, under --cnct-', () => {
    expect(cssVariableName('primary')).toBe('--cnct-primary');
    expect(cssVariableName('onPrimary')).toBe('--cnct-on-primary');
    expect(cssVariableName('textMuted')).toBe('--cnct-text-muted');
    expect(cssVariableName('onVisitorBubble')).toBe('--cnct-on-visitor-bubble');
    expect(cssVariableName('cornerRadius')).toBe('--cnct-corner-radius');
    expect(CNCT_THEME_VARIABLES).toEqual([
      '--cnct-primary',
      '--cnct-on-primary',
      '--cnct-background',
      '--cnct-surface',
      '--cnct-text',
      '--cnct-text-muted',
      '--cnct-border',
      '--cnct-visitor-bubble',
      '--cnct-on-visitor-bubble',
      '--cnct-agent-bubble',
      '--cnct-on-agent-bubble',
      '--cnct-corner-radius',
      '--cnct-font',
    ]);
  });

  it('leave the derived colours as references, so a stylesheet’s primary recolours the bubbles too', () => {
    const vars = themeVariables(resolveTheme({}), {});
    expect(vars['--_d-visitor-bubble']).toBe('var(--_primary)');
    expect(vars['--_d-on-visitor-bubble']).toBe('var(--_on-primary)');
    expect(vars['--_d-agent-bubble']).toBe('var(--_surface)');
    expect(vars['--_d-corner-radius']).toBe('18px');
  });

  it('work the ink out from a primary a stylesheet set', () => {
    const vars = themeVariables(resolveTheme({}), {}, '#f6c343');
    expect(vars['--_d-on-primary']).toBe('#141414');
  });

  it('write what the app set in code as values', () => {
    const app = { visitorBubble: '#222222', agentBubble: '#eeeeee', onAgentBubble: '#000000' };
    const vars = themeVariables(resolveTheme({ theme: app }), app);
    expect(vars['--_d-visitor-bubble']).toBe('#222222');
    expect(vars['--_d-on-visitor-bubble']).toBe('#ffffff');
    expect(vars['--_d-agent-bubble']).toBe('#eeeeee');
    expect(vars['--_d-on-agent-bubble']).toBe('#000000');
  });
});
