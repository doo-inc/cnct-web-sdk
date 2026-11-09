/**
 * The interface's stylesheet, inside its shadow root — so the page's CSS cannot reach in and this
 * cannot leak out.
 *
 * Two rules run through it:
 *
 * **Every colour, the radius and the font are a token.** Each `--_x` reads the public
 * `--cnct-x` first — a stylesheet on the page theming the element without JavaScript — and falls
 * back to `--_d-x`, which the element writes from the app's theme, the inbox's settings and the
 * defaults, in that order.
 *
 * **Direction is never hand-swapped.** Every margin, padding, border and position is a logical
 * property (`inline-start`, `inline-end`), so `dir="rtl"` on the root mirrors the whole interface;
 * the only explicit flips are the icons that point somewhere.
 */
export const CNCT_CHAT_CSS = `
:host{display:block;position:relative;height:100%;min-height:320px;contain:content}
:host([hidden]){display:none}
*,*::before,*::after{box-sizing:border-box}
.cnct{
--_primary:var(--cnct-primary,var(--_d-primary));
--_on-primary:var(--cnct-on-primary,var(--_d-on-primary));
--_background:var(--cnct-background,var(--_d-background));
--_surface:var(--cnct-surface,var(--_d-surface));
--_text:var(--cnct-text,var(--_d-text));
--_muted:var(--cnct-text-muted,var(--_d-text-muted));
--_border:var(--cnct-border,var(--_d-border));
--_you:var(--cnct-visitor-bubble,var(--_d-visitor-bubble));
--_on-you:var(--cnct-on-visitor-bubble,var(--_d-on-visitor-bubble));
--_them:var(--cnct-agent-bubble,var(--_d-agent-bubble));
--_on-them:var(--cnct-on-agent-bubble,var(--_d-on-agent-bubble));
--_radius:var(--cnct-corner-radius,var(--_d-corner-radius));
--_font:var(--cnct-font,var(--_d-font));
--_tuck:calc(var(--_radius) * .28);
--_danger:#c5221f;
/* The brand colour as text on the background: mixed towards the text colour, so it reads at 4.5:1 in either appearance. */
--_accent:color-mix(in srgb,var(--_primary) 70%,var(--_text));
position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;
background:var(--_background);color:var(--_text);font-family:var(--_font);
font-size:.9375rem;line-height:1.45;-webkit-text-size-adjust:100%;
}
.cnct[data-appearance=dark]{--_danger:#f28b82;color-scheme:dark}
.cnct[data-appearance=light]{color-scheme:light}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:0;padding:0}
button:disabled{cursor:default}
:focus-visible{outline:2px solid var(--_primary);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.icon{width:1.25em;height:1.25em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
[dir=rtl] .flip{transform:scaleX(-1)}
.hidden{display:none!important}

/* Header */
.head{display:flex;align-items:center;gap:.75em;padding:.75em 1em;padding-top:max(.75em,env(safe-area-inset-top));background:var(--_surface);border-block-end:1px solid var(--_border);flex:none}
.logo{width:2.5em;height:2.5em;border-radius:50%;flex:none;display:grid;place-items:center;overflow:hidden;background:var(--_primary);color:var(--_on-primary);font-weight:700;font-size:1em}
.logo img{width:100%;height:100%;object-fit:cover}
.who{flex:1;min-width:0;display:flex;flex-direction:column}
.title{font-weight:650;font-size:1.0625em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line{min-width:0}
.status{color:var(--_muted);font-size:.8125em;display:flex;align-items:center;gap:.4em}
.dot{width:.5em;height:.5em;border-radius:50%;background:#1e8e3e;flex:none}
.dot.away{background:var(--_muted)}
.ghost{min-height:44px;padding:0 .9em;border-radius:999px;border:1px solid var(--_border);color:var(--_text);font-size:.875em;font-weight:550;white-space:nowrap}
.ghost:hover{background:color-mix(in srgb,var(--_text) 6%,transparent)}
.close{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:var(--_muted);flex:none}
.close:hover{background:color-mix(in srgb,var(--_text) 8%,transparent);color:var(--_text)}

.banner{display:flex;align-items:center;justify-content:center;gap:.5em;padding:.4em 1em;font-size:.8125em;background:color-mix(in srgb,var(--_text) 8%,var(--_background));color:var(--_text);flex:none}

/* Screens */
.body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:.5em;padding:2em}
.center h2{margin:0;font-size:1.125em}
.center p{margin:0;color:var(--_muted);max-width:28em}
.glyph{width:3.5em;height:3.5em;border-radius:50%;display:grid;place-items:center;background:var(--_surface);color:var(--_muted);margin-block-end:.5em}
.glyph .icon{width:1.6em;height:1.6em}
.spinner{width:1.75em;height:1.75em;border-radius:50%;border:3px solid var(--_border);border-block-start-color:var(--_primary);animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}

.intro{flex:1;overflow-y:auto;padding:1.5em 1.25em;display:flex;flex-direction:column;gap:1em}
.intro h2{margin:0;font-size:1.25em}
.intro .greet{margin:0;color:var(--_muted)}
.form{display:flex;flex-direction:column;gap:.9em}
.field{display:flex;flex-direction:column;gap:.35em;font-size:.875em;font-weight:550}
.field em{font-style:normal;font-weight:400;color:var(--_muted)}
.field small{font-weight:400;color:var(--_muted)}
.input{width:100%;min-height:2.9em;padding:.6em .8em;border-radius:calc(var(--_radius) * .6);border:1px solid var(--_border);background:var(--_background);font-size:1rem;font-weight:400}
.input:focus{outline:none;border-color:var(--_primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--_primary) 22%,transparent)}
.primary{min-height:44px;padding:0 1.2em;border-radius:999px;background:var(--_primary);color:var(--_on-primary);font-weight:650;display:inline-flex;align-items:center;justify-content:center;gap:.5em}
.primary:disabled{opacity:.55}
.primary.small{min-height:44px;font-size:.875em}
.legal{margin:0;font-size:.75em;color:var(--_muted)}
.error{margin:0;color:var(--_danger);font-size:.8125em}

/* The thread */
.chat{flex:1;min-height:0;display:flex;flex-direction:column}
.thread{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.75em 1em 1em;display:flex;flex-direction:column}
.messages,.cards{display:flex;flex-direction:column}
.stamp{align-self:center;margin:1em 0 .25em;font-size:.75em;color:var(--_muted)}
.system{align-self:center;max-width:88%;text-align:center;margin:.75em 0 .25em;padding:.45em .9em;border-radius:12px;background:var(--_surface);color:var(--_muted);font-size:.8125em}
.group{display:flex;flex-direction:column;gap:3px;max-width:82%;margin-block-start:.75em}
.group.you{align-self:flex-end;align-items:flex-end}
.group.them{align-self:flex-start;align-items:flex-start}
.msg{position:relative;max-width:100%;padding:.55em .9em;border-radius:var(--_radius);overflow-wrap:anywhere;word-break:normal}
.them .msg{background:var(--_them);color:var(--_on-them);border-start-start-radius:var(--_tuck);border-end-start-radius:var(--_tuck)}
.them .msg.first{border-start-start-radius:var(--_radius)}
.you .msg{background:var(--_you);color:var(--_on-you);border-start-end-radius:var(--_tuck);border-end-end-radius:var(--_tuck)}
.you .msg.first{border-start-end-radius:var(--_radius)}
.msg .link{color:inherit;text-decoration:underline;text-underline-offset:2px}
bdi.ltr{unicode-bidi:isolate;white-space:nowrap}
.msg.pending{opacity:.6}
/* A ring with a gap, so it shows on any bubble colour — a red brand's included. */
.msg.failed{box-shadow:0 0 0 2px var(--_background),0 0 0 4px var(--_danger)}
.msg.files{padding:4px}
.msg.files .line{padding:.3em .55em .1em}
.msg.bare{padding:0;background:none}
.retry{display:block;margin-block-start:.35em;font-size:.8125em;font-weight:600;color:var(--_danger);text-align:start;min-height:44px}
.you .retry{align-self:flex-end}
.byline{display:flex;align-items:center;gap:.4em;font-size:.75em;color:var(--_muted);margin-block-start:.2em;padding-inline:.3em}
.byline .name{font-weight:600;color:var(--_text)}
.byline .icon{width:1.1em;height:1.1em}
.chip{font-size:.6875em;font-weight:700;letter-spacing:.04em;padding:.05em .45em;border-radius:4px;background:color-mix(in srgb,var(--_primary) 16%,transparent);color:var(--_text)}
.face{width:1.6em;height:1.6em;border-radius:50%;display:grid;place-items:center;flex:none;font-size:.95em;font-weight:700;background:color-mix(in srgb,var(--_primary) 18%,var(--_surface));color:var(--_text);overflow:hidden}
.face.ai{background:var(--_primary);color:var(--_on-primary)}
.face.ai .icon{width:1em;height:1em;stroke-width:1.6}
.face img{width:100%;height:100%;object-fit:cover}

.quote{display:flex;flex-direction:column;gap:.1em;width:100%;margin:0 0 .35em;padding:.3em .6em;border-inline-start:3px solid currentColor;border-radius:calc(var(--_tuck) + 2px);background:color-mix(in srgb,currentColor 10%,transparent);font-size:.8125em;text-align:start;opacity:.9}
.quote b{font-weight:650}
.quote span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.footer{margin-block-start:.4em;font-size:.75em;opacity:.75}
.media img,.media video{display:block;max-width:100%;border-radius:calc(var(--_radius) - 4px);margin-block-end:.4em}

.choices{display:flex;flex-wrap:wrap;gap:.4em;margin-block-start:.4em;max-width:100%}
.choices.rows{flex-direction:column;flex-wrap:nowrap;width:100%;min-width:16em}
.choice{min-height:44px;padding:.45em 1em;border-radius:999px;border:1.5px solid var(--_primary);color:var(--_accent);background:var(--_background);font-weight:600;font-size:.875em;text-align:start}
.choice:hover:not(:disabled){background:color-mix(in srgb,var(--_primary) 10%,var(--_background))}
.choice:disabled{border-color:var(--_border);color:var(--_muted)}
.rows .choice{border-radius:calc(var(--_radius) * .6);display:flex;align-items:center;gap:.5em;width:100%}
.rows .choice span{flex:1;display:flex;flex-direction:column}
.rows .choice small{font-weight:400;color:var(--_muted)}
.suggestions{display:flex;flex-wrap:wrap;gap:.4em;margin-block-start:.6em;align-self:flex-end;justify-content:flex-end;max-width:90%}

.typing{display:inline-flex;gap:4px;padding:.75em .95em;border-radius:var(--_radius);border-start-start-radius:var(--_tuck);background:var(--_them)}
.typing i{width:7px;height:7px;border-radius:50%;background:var(--_muted);animation:blink 1.2s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes blink{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}

/* Files in a message */
.att{display:block;margin-block-start:4px}
.att:first-child{margin-block-start:0}
.photo{display:block;max-width:100%;border-radius:calc(var(--_radius) - 4px);overflow:hidden;background:color-mix(in srgb,currentColor 12%,transparent)}
.photo img{display:block;max-width:15em;max-height:18em;width:auto;height:auto}
.photo.loading{width:15em;aspect-ratio:4/3}
.photo.loading img{visibility:hidden}
.card{display:flex;align-items:center;gap:.65em;width:15em;max-width:100%;min-height:3.25em;padding:.5em .75em;border-radius:calc(var(--_radius) - 4px);background:color-mix(in srgb,var(--_background) 88%,transparent);color:var(--_text);text-align:start;border:1px solid color-mix(in srgb,var(--_border) 70%,transparent)}
.card .kind{width:2.25em;height:2.25em;border-radius:8px;display:grid;place-items:center;flex:none;background:color-mix(in srgb,var(--_primary) 14%,transparent);color:var(--_accent)}
.card .meta{display:flex;flex-direction:column;min-width:0}
.card .fname{font-weight:600;font-size:.875em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card .size{font-size:.75em;color:var(--_muted)}
.missing{font-size:.8125em;opacity:.8;padding:.3em .55em}

/* Cards under the thread */
.ended{align-self:stretch;display:flex;align-items:center;gap:.75em;margin:1.25em 0 .5em;color:var(--_muted);font-size:.8125em}
.ended::before,.ended::after{content:"";flex:1;height:1px;background:var(--_border)}
.panel{align-self:stretch;margin-block-start:.75em;padding:1em;border-radius:var(--_radius);background:var(--_surface);border:1px solid var(--_border);display:flex;flex-direction:column;gap:.6em}
.panel strong{font-size:.9375em}
.panel p{margin:0;color:var(--_muted);font-size:.875em}
.faces{display:flex;justify-content:space-between;gap:.25em}
.rate{flex:1;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:.2em;border-radius:12px;padding:.25em 0;font-size:.6875em;color:var(--_muted)}
.rate svg{width:2.4em;height:2.4em;font-size:1rem}
.rate:hover:not(:disabled),.rate[aria-pressed=true]{background:color-mix(in srgb,var(--_primary) 12%,transparent);color:var(--_text)}
.rate[aria-pressed=false].chosen-other{opacity:.45}
.skin{fill:#f6c343}.face-1 .skin{fill:#ef8a7c}.face-2 .skin{fill:#f4a96a}.face-5 .skin{fill:#9ed36a}.face-4 .skin{fill:#c8d96a}
.ink{fill:#3a2a1a}.mouth{fill:none;stroke:#3a2a1a;stroke-width:2.2;stroke-linecap:round}
.actions{display:flex;justify-content:flex-end;gap:.5em}
.quiet{min-height:44px;padding:0 .75em;color:var(--_muted);font-size:.875em}
.thanks{display:flex;align-items:center;gap:.5em;color:var(--_text)}

/* The composer */
.foot{flex:none;background:var(--_surface);border-block-start:1px solid var(--_border);padding:.6em .75em;padding-bottom:max(.6em,env(safe-area-inset-bottom))}
.foot .error{padding:0 .25em .5em}
.row{display:flex;align-items:flex-end;gap:.4em}
.tool{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:var(--_muted);flex:none}
.tool:hover:not(:disabled){color:var(--_text);background:color-mix(in srgb,var(--_text) 8%,transparent)}
.text{flex:1;min-width:0;resize:none;border:1px solid var(--_border);background:var(--_background);border-radius:calc(var(--_radius) * .8 + 2px);padding:.62em .9em;line-height:1.4;min-height:44px;max-height:8.6em;overflow-y:auto;font-size:1rem}
.text:focus{outline:none;border-color:var(--_primary)}
.text::placeholder{color:var(--_muted);opacity:1}
.send{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--_primary);color:var(--_on-primary);flex:none}
.send:disabled{opacity:.4}
.uploads{display:flex;gap:.5em;overflow-x:auto;padding:0 .1em .6em;scrollbar-width:thin}
.upload{position:relative;display:flex;align-items:center;gap:.55em;flex:none;max-width:15em;padding:.4em;padding-inline-end:46px;border-radius:calc(var(--_radius) * .6);background:var(--_background);border:1px solid var(--_border)}
.upload.failed{border-color:var(--_danger)}
.thumb{position:relative;width:2.75em;height:2.75em;border-radius:8px;flex:none;overflow:hidden;display:grid;place-items:center;background:color-mix(in srgb,var(--_primary) 14%,transparent);color:var(--_accent);font-size:.6875em;font-weight:700;text-transform:uppercase}
.thumb img{width:100%;height:100%;object-fit:cover}
.thumb .ring{position:absolute;inset:0;width:100%;height:100%;background:rgba(0,0,0,.5);padding:5px}
.ring circle{fill:none;stroke-width:4.5}
.ring .track{stroke:rgba(255,255,255,.3)}
.ring .bar{stroke:#fff;stroke-linecap:round;transform:rotate(-90deg);transform-origin:center;transition:stroke-dasharray .2s}
[dir=rtl] .ring{transform:scaleX(-1)}
.upload .meta{display:flex;flex-direction:column;min-width:0}
.upload .fname{font-size:.8125em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:8.5em}
.upload .size{font-size:.75em;color:var(--_muted)}
.remove{position:absolute;inset-inline-end:2px;top:50%;transform:translateY(-50%);width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:var(--_muted)}
.remove:hover{color:var(--_text);background:color-mix(in srgb,var(--_text) 8%,transparent)}
.confirm{display:flex;flex-wrap:wrap;align-items:center;gap:.5em;justify-content:flex-end}
.confirm span{flex:1 1 12em;font-size:.875em}
.closed{display:flex;justify-content:center}
.powered{flex:none;text-align:center;font-size:.6875em;color:var(--_muted);padding:.35em 0 .5em;background:var(--_surface)}
.powered b{font-weight:700;letter-spacing:.02em}

/* Over everything */
.drop{position:absolute;inset:.5em;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5em;border:2px dashed var(--_primary);border-radius:var(--_radius);background:color-mix(in srgb,var(--_background) 92%,transparent);color:var(--_primary);font-weight:600;pointer-events:none}
.drop .icon{width:2em;height:2em}
.viewer{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88);padding:max(1em,env(safe-area-inset-top)) 1em}
.viewer img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;touch-action:pinch-zoom}
.viewer .close{position:absolute;top:max(.75em,env(safe-area-inset-top));inset-inline-end:.75em;color:#fff;background:rgba(255,255,255,.12)}

@media (prefers-reduced-motion:reduce){*{animation-duration:.001s!important;transition:none!important}}
`;
