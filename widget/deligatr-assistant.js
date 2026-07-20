/**
 * Deligatr Assistant — floating chat widget for DeliHub (GHL) clients.
 * Injects a bubble (bottom-right) that opens a chat panel, ChatGPT/Claude-style
 * formatting inside. Vanilla JS, no dependencies, everything namespaced `dgtr-`.
 * History is in-memory only (resets on reload — intentional, see README).
 *
 * locationId resolution order (re-checked on every send):
 *   1. window.DGTR_CONFIG.locationId          (test harness override)
 *   2. ?locationId= / ?location_id= query     (GHL custom menu link passes it)
 *   3. /location/<id>/ in the page URL path
 *   4. /location/<id>/ in document.referrer   (when iframed inside GHL)
 *
 * Optional overrides (set BEFORE this script runs; used by test.html):
 *   window.DGTR_CONFIG = { endpoint, locationId, contactId, debug }
 */
(function () {
  'use strict';
  if (window.__dgtrLoaded) return;
  window.__dgtrLoaded = true;

  var cfg = {
    endpoint: 'https://deligatr.app.n8n.cloud/webhook/deligatr-assistant',
    locationId: null,
    contactId: null,
    debug: false,
  };
  var user = window.DGTR_CONFIG || {};
  for (var k in cfg) if (user[k] !== undefined) cfg[k] = user[k];

  var GREETING = "Hi 👋 I'm your Deligatr assistant. Ask me anything about your account.";
  var ERROR_MSG = "I've hit a snag — please try again in a moment.";
  var HISTORY_CAP = 20; // last ~10 user/assistant turns

  var state = { open: false, busy: false, history: [] };
  var els = {};

  function log() {
    if (cfg.debug && window.console) {
      try { console.debug.apply(console, ['[dgtr]'].concat([].slice.call(arguments))); } catch (e) {}
    }
  }

  // ── GHL context ────────────────────────────────────────────────────────────
  function locFrom(str) {
    var m = /location\/([^/?#]+)/.exec(str || '');
    return m ? m[1] : null;
  }
  function getLocationId() {
    if (cfg.locationId) return cfg.locationId;
    try {
      var qs = window.location.search;
      var qm = /[?&]location(?:_i|I)d=([^&#]+)/.exec(qs);
      if (qm) return decodeURIComponent(qm[1]);
    } catch (e) {}
    return locFrom(window.location.pathname) || locFrom(document.referrer);
  }

  var probedUser = false;
  function getContactId() {
    if (cfg.contactId) return cfg.contactId;
    try {
      var qm = /[?&]contact(?:_i|I)d=([^&#]+)/.exec(window.location.search);
      if (qm) return decodeURIComponent(qm[1]);
    } catch (e) {}
    // GHL doesn't document a stable user global; probe likely candidates and
    // log what exists so we can pin this down from a real sub-account.
    var candidates = ['ghlUser', 'user', 'currentUser', '_currentUser', 'leadConnectorUser', '__ghl'];
    var found = null;
    for (var i = 0; i < candidates.length; i++) {
      var v = window[candidates[i]];
      if (v && typeof v === 'object') {
        var id = v.id || v.userId || v._id || (v.user && (v.user.id || v.user._id));
        if (typeof id === 'string' && id) { found = id; break; }
      }
    }
    if (!probedUser) {
      probedUser = true;
      try {
        var userish = Object.keys(window).filter(function (key) { return /user/i.test(key); });
        log('user-global probe — window keys matching /user/i:', userish, '— resolved contactId:', found);
      } catch (e) {}
    }
    return found; // null is fine; the workflow tolerates it
  }

  // ── minimal safe formatting (assistant replies only) ────────────────────────
  // Escape ALL HTML first, then whitelist exactly: **bold**, *italic*, <u>underline</u>,
  // and newlines → <br>. Nothing else from the backend can inject markup.
  function renderMd(s) {
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>'); // re-allow <u>
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');        // **bold**
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');                    // *italic*
    s = s.replace(/\n/g, '<br>');                                     // newlines; "• " lines pass through as-is
    return s;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  // Deligatr brand: dark purple → teal gradient (from the sidebar/logo), bright
  // green accent (the lightning-bolt chip), alligator mascot.
  var FONT = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
  var GRADIENT = 'linear-gradient(165deg,#140a22 0%,#4a2a72 45%,#2f9e82 100%)';
  var PURPLE = '#4a2a72';
  var GREEN = '#3ddc84';
  var CSS =
    '.dgtr-bubble{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:58px;height:58px;' +
    'border-radius:50%;border:none;cursor:pointer;background:' + GRADIENT + ';color:#fff;font-size:26px;' +
    'box-shadow:0 4px 18px rgba(20,10,34,.45);display:flex;align-items:center;justify-content:center;' +
    'transition:transform .15s ease}' +
    '.dgtr-bubble:hover{transform:scale(1.06)}' +
    '.dgtr-panel{position:fixed;right:20px;bottom:90px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);' +
    'height:600px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;overflow:hidden;' +
    'box-shadow:0 12px 44px rgba(20,10,34,.35);display:none;flex-direction:column;' +
    FONT + 'font-size:14.5px;color:#111;line-height:1.5}' +
    '.dgtr-panel.dgtr-open{display:flex}' +
    '.dgtr-head{display:flex;align-items:center;gap:10px;padding:0 14px;height:56px;flex:none;' +
    'background:' + GRADIENT + ';color:#fff}' +
    '.dgtr-logo{width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.15);color:#fff;' +
    'display:flex;align-items:center;justify-content:center;font-size:15px;flex:none}' +
    '.dgtr-head-title{flex:1;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.dgtr-close{background:rgba(255,255,255,.14);color:#fff;border:none;border-radius:8px;' +
    'cursor:pointer;font-size:14px;line-height:1;padding:7px 9px;flex:none}' +
    '.dgtr-close:hover{background:rgba(255,255,255,.26)}' +
    '.dgtr-msgs{flex:1;overflow-y:auto;background:#f8f6fb}' +
    '.dgtr-col{padding:16px 14px;display:flex;flex-direction:column;gap:14px}' +
    '.dgtr-msg{white-space:pre-wrap;word-wrap:break-word}' +
    '.dgtr-msg-user{align-self:flex-end;max-width:85%;background:' + PURPLE + ';color:#fff;border-radius:14px;' +
    'border-bottom-right-radius:4px;padding:9px 13px}' +
    '.dgtr-msg-bot{align-self:stretch;display:flex;gap:8px}' +
    '.dgtr-avatar{width:24px;height:24px;border-radius:7px;background:' + PURPLE + ';color:#fff;display:flex;' +
    'align-items:center;justify-content:center;font-size:12px;flex:none;margin-top:2px}' +
    '.dgtr-bot-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:7px}' +
    '.dgtr-bot-text{background:#fff;border:1px solid #e6def2;border-radius:14px;border-top-left-radius:4px;' +
    'padding:9px 13px;min-width:0;align-self:stretch}' +
    '.dgtr-talk-btn{background:#fff;color:' + PURPLE + ';border:1px solid #d3c2e8;border-radius:8px;' +
    'cursor:pointer;font-size:12px;padding:6px 12px;font-family:inherit;flex:none}' +
    '.dgtr-talk-btn:hover{background:#f3edfb}' +
    '.dgtr-typing{display:flex;gap:5px;background:#fff;border:1px solid #e6def2;border-radius:14px;' +
    'border-top-left-radius:4px;padding:11px 14px}' +
    '.dgtr-typing span{width:6px;height:6px;border-radius:50%;background:#a892c4;animation:dgtr-blink 1.2s infinite}' +
    '.dgtr-typing span:nth-child(2){animation-delay:.2s}.dgtr-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes dgtr-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
    '.dgtr-inputwrap{flex:none;padding:10px;background:#fff;border-top:1px solid #e6def2}' +
    '.dgtr-form{display:flex;align-items:flex-end;gap:8px;border:1px solid #d3c2e8;border-radius:14px;' +
    'padding:8px 8px 8px 13px;background:#fff}' +
    '.dgtr-form:focus-within{border-color:' + PURPLE + '}' +
    '.dgtr-input{flex:1;border:none;outline:none;resize:none;font:inherit;background:transparent;' +
    'max-height:120px;min-width:0;padding:3px 0}' +
    '.dgtr-send{border:none;border-radius:9px;background:#1c1030;color:' + GREEN + ';width:34px;height:34px;' +
    'cursor:pointer;font-size:16px;font-weight:700;flex:none;display:flex;align-items:center;justify-content:center}' +
    '.dgtr-send:disabled{opacity:.4;cursor:default}';

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    els.bubble = document.createElement('button');
    els.bubble.className = 'dgtr-bubble';
    els.bubble.type = 'button';
    els.bubble.setAttribute('aria-label', 'Open Deligatr assistant');
    els.bubble.textContent = '🐊';
    els.bubble.addEventListener('click', toggle);

    els.panel = document.createElement('div');
    els.panel.className = 'dgtr-panel';

    var head = document.createElement('div');
    head.className = 'dgtr-head';
    var logo = document.createElement('div');
    logo.className = 'dgtr-logo';
    logo.textContent = '🐊';
    var title = document.createElement('div');
    title.className = 'dgtr-head-title';
    title.textContent = 'Deligatr Assistant';
    var close = document.createElement('button');
    close.className = 'dgtr-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    close.addEventListener('click', toggle);
    head.appendChild(logo); head.appendChild(title); head.appendChild(close);

    els.msgs = document.createElement('div');
    els.msgs.className = 'dgtr-msgs';
    els.col = document.createElement('div');
    els.col.className = 'dgtr-col';
    els.msgs.appendChild(els.col);

    var wrap = document.createElement('div');
    wrap.className = 'dgtr-inputwrap';
    var form = document.createElement('form');
    form.className = 'dgtr-form';
    els.input = document.createElement('textarea');
    els.input.className = 'dgtr-input';
    els.input.rows = 1;
    els.input.placeholder = 'Type your question…';
    els.input.setAttribute('maxlength', '2000');
    els.input.addEventListener('input', autosize);
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    els.sendBtn = document.createElement('button');
    els.sendBtn.className = 'dgtr-send';
    els.sendBtn.type = 'submit';
    els.sendBtn.setAttribute('aria-label', 'Send');
    els.sendBtn.textContent = '↑';
    form.appendChild(els.input); form.appendChild(els.sendBtn);
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    wrap.appendChild(form);

    els.form = form;
    els.panel.appendChild(head);
    els.panel.appendChild(els.msgs);
    els.panel.appendChild(wrap);
    document.body.appendChild(els.bubble);
    document.body.appendChild(els.panel);

    addMsg('assistant', GREETING, /*skipHistory*/ true);
  }

  function toggle() {
    state.open = !state.open;
    els.panel.className = 'dgtr-panel' + (state.open ? ' dgtr-open' : '');
    if (state.open) els.input.focus();
  }

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
  }

  function submit() {
    var q = els.input.value.trim();
    if (!q || state.busy) return;
    els.input.value = '';
    autosize();
    send(q);
  }

  function addMsg(role, text, skipHistory, offerCall, bookingUrl) {
    var node;
    if (role === 'user') {
      node = document.createElement('div');
      node.className = 'dgtr-msg dgtr-msg-user';
      node.textContent = text; // textContent only — never inject HTML
    } else {
      node = document.createElement('div');
      node.className = 'dgtr-msg dgtr-msg-bot';
      var av = document.createElement('div');
      av.className = 'dgtr-avatar';
      av.textContent = '🐊';
      var col = document.createElement('div');
      col.className = 'dgtr-bot-col';
      var body = document.createElement('div');
      body.className = 'dgtr-bot-text';
      body.innerHTML = renderMd(text); // safe: renderMd escapes all HTML first
      col.appendChild(body);
      if (offerCall && typeof bookingUrl === 'string' && bookingUrl) {
        var talkBtn = document.createElement('button');
        talkBtn.type = 'button';
        talkBtn.className = 'dgtr-talk-btn';
        talkBtn.textContent = 'Talk to a human';
        talkBtn.addEventListener('click', function () { window.open(bookingUrl, '_blank'); });
        col.appendChild(talkBtn);
      }
      node.appendChild(av); node.appendChild(col);
    }
    els.col.appendChild(node);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    if (!skipHistory) {
      state.history.push({ role: role, content: text });
      if (state.history.length > HISTORY_CAP) state.history = state.history.slice(-HISTORY_CAP);
    }
  }

  function setTyping(on) {
    if (on && !els.typing) {
      els.typing = document.createElement('div');
      els.typing.className = 'dgtr-msg dgtr-msg-bot';
      els.typing.innerHTML =
        '<div class="dgtr-avatar">🐊</div><div class="dgtr-typing"><span></span><span></span><span></span></div>';
      els.col.appendChild(els.typing);
      els.msgs.scrollTop = els.msgs.scrollHeight;
    } else if (!on && els.typing) {
      els.col.removeChild(els.typing);
      els.typing = null;
    }
  }

  function send(question) {
    if (state.busy) return;
    state.busy = true;
    els.sendBtn.disabled = true;

    // history snapshot BEFORE this question (the question rides separately)
    var history = state.history.slice(-HISTORY_CAP);
    addMsg('user', question);
    setTyping(true);

    var payload = {
      question: question,
      locationId: getLocationId(), // re-read every send: URL can change under a SPA
      contactId: getContactId(),
      history: history,
    };
    log('send', payload);

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller && setTimeout(function () { controller.abort(); }, 30000);

    fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var reply = data && typeof data.reply === 'string' && data.reply ? data.reply : ERROR_MSG;
        var offerCall = !!(data && data.offer_call === true);
        var bookingUrl = data && data.booking_url;
        setTyping(false);
        addMsg('assistant', reply, false, offerCall, bookingUrl);
      })
      .catch(function (err) {
        log('request failed', err && err.message);
        setTyping(false);
        addMsg('assistant', ERROR_MSG, /*skipHistory*/ true);
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        state.busy = false;
        els.sendBtn.disabled = false;
        els.input.focus();
      });
  }

  // ── boot (never throw into the host page) ──────────────────────────────────
  function init() {
    try { build(); } catch (e) { log('init failed', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
