/**
 * The chat bubble, for somebody else's website.
 *
 * This is the file the install snippet actually points at, and until it existed the snippet pointed
 * at `/chat/<key>` — an HTML document — inside a `<script>` tag. Browsers refuse that outright
 * (`nosniff` makes the MIME mismatch fatal), so every site that pasted the line got a console error
 * and no bubble. The settings panel meanwhile promised "the bubble appears on every page it is on".
 * There was no bubble anywhere in the product.
 *
 * **Everything a customer sees lives in an iframe.** Not for tidiness — for containment. This script
 * runs on a stranger's page, next to their CSS, their reset, their `* { box-sizing }`, their
 * `z-index: 9999`, and whatever framework is re-rendering the DOM underneath it. An iframe is the
 * only boundary the platform actually enforces: their styles cannot reach the conversation, and the
 * conversation cannot reach their page. What is left outside is the launcher, which is one button,
 * styled inline so no stylesheet of theirs can touch it either.
 *
 * The launcher is deliberately *not* in the iframe. A fixed-position iframe big enough to hold a
 * 60px button has to be 60px, and then it has to grow to hold the panel — and an iframe that
 * changes size is an iframe that reflows the page it is on. One button and one panel-sized frame
 * that is simply hidden costs nothing and moves nothing.
 */
(function () {
  'use strict';

  // Already here. A second copy of the snippet — two tag managers, a partial re-render — must not
  // mean two bubbles.
  if (window.__cnctChatWidget) return;
  window.__cnctChatWidget = true;

  /**
   * `document.currentScript` is defined during synchronous *and* async classic script execution,
   * which is what the snippet uses. The query fallback is for a host that copies this file onto
   * their own CDN and loses the attribute in the process.
   */
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i -= 1) {
        if (/cnct-widget\.js/.test(all[i].src)) return all[i];
      }
      return null;
    })();
  if (!script) return;

  var key = script.getAttribute('data-inbox') || '';
  var origin = new URL(script.src, location.href).origin;
  if (!key) {
    // Loud, once, and only in the console — a visitor must never be shown our configuration errors.
    console.error('[cnct] The chat snippet is missing its data-inbox attribute.');
    return;
  }

  var position = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var brand = script.getAttribute('data-color') || '#b52d93';

  /**
   * One below the 32-bit signed maximum, which is where every other widget on the page will also be
   * sitting. Named rather than sprinkled, because the only thing worse than a magic z-index is four
   * of them that disagree.
   */
  var LAYER = 2147483000;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ease = reduced ? 'none' : 'cubic-bezier(0.16, 1, 0.3, 1)';
  var ms = reduced ? 0 : 260;

  var open = false;
  var unread = 0;

  // ── The launcher ────────────────────────────────────────────────────────────────────────────

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-expanded', 'false');
  /**
   * Styled inline, every property spelled out. A host page's `button { ... }` rule is not a
   * hypothetical — resets that set `all: unset` or a global `border-radius: 0` are everywhere, and
   * a launcher that inherits one of them looks broken in a way the client blames on us.
   */
  launcher.style.cssText = [
    'position:fixed',
    'bottom:20px',
    position + ':20px',
    'width:60px',
    'height:60px',
    'padding:0',
    'margin:0',
    'border:0',
    'border-radius:50%',
    'background:' + brand,
    'color:#fff',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    // Tinted rather than black: a black shadow under a magenta button reads as dirt.
    'box-shadow:0 4px 14px rgba(181,45,147,.32),0 1px 3px rgba(0,0,0,.12)',
    'z-index:' + LAYER,
    'transition:transform ' + ms + 'ms ' + ease + ',box-shadow ' + ms + 'ms ' + ease,
    '-webkit-tap-highlight-color:transparent',
  ].join(';');

  // Two icons, cross-faded, so the button does not visibly swap its contents mid-animation.
  var iconChat = svg(
    '<path d="M2.99 16.34a2 2 0 0 1 .1 1.17l-1.07 3.29a1 1 0 0 0 1.24 1.17l3.41-1a2 2 0 0 1 1.1.09 10 10 0 1 0-4.78-4.72"/>',
  );
  var iconClose = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  iconClose.style.position = 'absolute';
  iconClose.style.opacity = '0';
  iconChat.style.transition = iconClose.style.transition = 'opacity ' + ms + 'ms ' + ease;
  launcher.appendChild(iconChat);
  launcher.appendChild(iconClose);

  function svg(paths) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '2');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('width', '26');
    node.setAttribute('height', '26');
    node.setAttribute('aria-hidden', 'true');
    // Static strings defined in this file, never anything that came off the network.
    node.innerHTML = paths;
    return node;
  }

  var badge = document.createElement('span');
  badge.style.cssText = [
    'position:absolute',
    'top:-2px',
    (position === 'left' ? 'left' : 'right') + ':-2px',
    'min-width:20px',
    'height:20px',
    'padding:0 5px',
    'box-sizing:border-box',
    'border-radius:10px',
    'background:#e5484d',
    'color:#fff',
    'font:600 11px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'text-align:center',
    'display:none',
    'box-shadow:0 0 0 2px #fff',
  ].join(';');
  launcher.appendChild(badge);

  launcher.addEventListener('mouseenter', function () {
    if (!reduced) launcher.style.transform = 'scale(1.06)';
  });
  launcher.addEventListener('mouseleave', function () {
    launcher.style.transform = 'scale(1)';
  });
  // A pressed button should feel pressed. 80ms is below the threshold where it reads as lag.
  launcher.addEventListener('pointerdown', function () {
    if (!reduced) launcher.style.transform = 'scale(0.94)';
  });
  launcher.addEventListener('pointerup', function () {
    if (!reduced) launcher.style.transform = 'scale(1.06)';
  });

  // ── The panel ───────────────────────────────────────────────────────────────────────────────

  var frame = document.createElement('iframe');
  frame.title = 'Chat';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = origin + '/chat/' + encodeURIComponent(key) + '?embed=1';
  frame.style.cssText = [
    'position:fixed',
    'bottom:96px',
    position + ':20px',
    'width:400px',
    'height:min(620px, calc(100dvh - 132px))',
    'max-width:calc(100vw - 40px)',
    'border:0',
    'border-radius:16px',
    // Layered rather than one big blur: the tight shadow reads as an edge, the wide one as lift.
    'box-shadow:0 12px 48px rgba(16,16,16,.18),0 2px 8px rgba(16,16,16,.08)',
    'background:#fff',
    'z-index:' + LAYER,
    'opacity:0',
    'transform:translateY(12px) scale(.98)',
    // Grows from the corner it is anchored to, which is where the click came from.
    'transform-origin:' + (position === 'left' ? 'left' : 'right') + ' bottom',
    'pointer-events:none',
    'transition:opacity ' + ms + 'ms ' + ease + ',transform ' + ms + 'ms ' + ease,
    'color-scheme:light',
  ].join(';');

  /** Under 640px the panel is the page. A 400px card on a 390px phone is a card with no room. */
  function fit() {
    var small = window.innerWidth < 640;
    frame.style.width = small ? '100%' : '400px';
    frame.style.height = small ? '100%' : 'min(620px, calc(100dvh - 132px))';
    frame.style.bottom = small ? '0' : '96px';
    frame.style[position] = small ? '0' : '20px';
    frame.style.maxWidth = small ? '100%' : 'calc(100vw - 40px)';
    frame.style.borderRadius = small ? '0' : '16px';
    // The launcher would sit on top of a full-screen conversation.
    launcher.style.display = small && open ? 'none' : 'flex';
  }
  window.addEventListener('resize', fit);

  function show(next) {
    open = next;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
    iconChat.style.opacity = open ? '0' : '1';
    iconClose.style.opacity = open ? '1' : '0';
    frame.style.opacity = open ? '1' : '0';
    frame.style.transform = open ? 'translateY(0) scale(1)' : 'translateY(12px) scale(.98)';
    frame.style.pointerEvents = open ? 'auto' : 'none';
    frame.setAttribute('aria-hidden', String(!open));
    if (open) {
      unread = 0;
      badge.style.display = 'none';
      post({ type: 'cnct:opened' });
    }
    fit();
  }

  function post(message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, origin);
  }

  launcher.addEventListener('click', function () {
    show(!open);
  });

  /** Escape closes it, which is the one keyboard convention every panel on the web shares. */
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && open) {
      show(false);
      launcher.focus();
    }
  });

  /**
   * **Origin-checked before anything is read.** This listener is on the host's page, where every
   * script on it can post a message; without the check, any of them could drive the widget.
   */
  window.addEventListener('message', function (event) {
    if (event.origin !== origin || !event.data || typeof event.data !== 'object') return;
    var data = event.data;
    if (data.type === 'cnct:close') {
      show(false);
      launcher.focus();
      return;
    }
    if (data.type === 'cnct:unread') {
      unread = Math.max(0, Number(data.count) || 0);
      if (open || !unread) {
        badge.style.display = 'none';
      } else {
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.style.display = 'block';
      }
    }
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(launcher);
    fit();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /** A small, deliberate surface for a host that wants to drive it from their own button. */
  window.CnctChat = {
    open: function () {
      show(true);
    },
    close: function () {
      show(false);
    },
    toggle: function () {
      show(!open);
    },
  };
})();
