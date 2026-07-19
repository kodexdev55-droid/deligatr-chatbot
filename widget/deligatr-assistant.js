/**
 * Deligatr Assistant — full-screen chatbot for DeliHub (GHL) clients.
 * Renders a ChatGPT/Claude-style full-page chat UI into the host page.
 * Vanilla JS, no dependencies, everything namespaced `dgtr-`.
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
  var HUMAN_MSG = "I'd like to speak to someone from the team.";
  var HISTORY_CAP = 20; // last ~10 user/assistant turns

  var state = { busy: false, history: [] };
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

  // ── UI ─────────────────────────────────────────────────────────────────────
  var CSS =
    '.dgtr-app{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#fff;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:15px;color:#111;line-height:1.55}' +
    '.dgtr-head{display:flex;align-items:center;gap:10px;padding:0 20px;height:58px;flex:none;' +
    'border-bottom:1px solid #e7e7e9;background:#fff}' +
    '.dgtr-logo{width:30px;height:30px;border-radius:8px;background:#1f2937;color:#fff;display:flex;' +
    'align-items:center;justify-content:center;font-size:16px;flex:none}' +
    '.dgtr-head-title{flex:1;font-weight:600;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.dgtr-human{background:#f3f4f6;color:#111;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;' +
    'font-size:13px;padding:8px 14px;font-family:inherit;flex:none}' +
    '.dgtr-human:hover{background:#e5e7eb}' +
    '.dgtr-msgs{flex:1;overflow-y:auto;background:#fff}' +
    '.dgtr-col{max-width:768px;margin:0 auto;padding:28px 20px 12px;display:flex;flex-direction:column;gap:18px}' +
    '.dgtr-msg{white-space:pre-wrap;word-wrap:break-word}' +
    '.dgtr-msg-user{align-self:flex-end;max-width:80%;background:#f3f4f6;border-radius:16px;' +
    'border-bottom-right-radius:6px;padding:11px 16px}' +
    '.dgtr-msg-bot{align-self:stretch;display:flex;gap:12px}' +
    '.dgtr-avatar{width:28px;height:28px;border-radius:8px;background:#1f2937;color:#fff;display:flex;' +
    'align-items:center;justify-content:center;font-size:14px;flex:none;margin-top:2px}' +
    '.dgtr-bot-text{flex:1;padding-top:3px;min-width:0}' +
    '.dgtr-typing{display:flex;gap:5px;padding:10px 0 4px}' +
    '.dgtr-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:dgtr-blink 1.2s infinite}' +
    '.dgtr-typing span:nth-child(2){animation-delay:.2s}.dgtr-typing span:nth-child(3){animation-delay:.4s}' +
    '@keyframes dgtr-blink{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
    '.dgtr-inputwrap{flex:none;padding:8px 20px 22px;background:#fff}' +
    '.dgtr-form{max-width:768px;margin:0 auto;display:flex;align-items:flex-end;gap:10px;' +
    'border:1px solid #d1d5db;border-radius:16px;padding:10px 10px 10px 16px;background:#fff;' +
    'box-shadow:0 2px 12px rgba(0,0,0,.06)}' +
    '.dgtr-form:focus-within{border-color:#1f2937}' +
    '.dgtr-input{flex:1;border:none;outline:none;resize:none;font:inherit;background:transparent;' +
    'max-height:170px;min-width:0;padding:4px 0}' +
    '.dgtr-send{border:none;border-radius:10px;background:#1f2937;color:#fff;width:38px;height:38px;' +
    'cursor:pointer;font-size:16px;flex:none;display:flex;align-items:center;justify-content:center}' +
    '.dgtr-send:disabled{opacity:.4;cursor:default}' +
    '.dgtr-hint{max-width:768px;margin:8px auto 0;text-align:center;color:#9ca3af;font-size:12px}';

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    els.app = document.createElement('div');
    els.app.className = 'dgtr-app';

    var head = document.createElement('div');
    head.className = 'dgtr-head';
    var logo = document.createElement('div');
    logo.className = 'dgtr-logo';
    logo.textContent = '💬';
    var title = document.createElement('div');
    title.className = 'dgtr-head-title';
    title.textContent = 'Deligatr Assistant';
    els.human = document.createElement('button');
    els.human.className = 'dgtr-human';
    els.human.type = 'button';
    els.human.textContent = 'Talk to a human';
    els.human.addEventListener('click', function () { send(HUMAN_MSG); });
    head.appendChild(logo); head.appendChild(title); head.appendChild(els.human);

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
    els.input.placeholder = 'Ask anything about your account…';
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
    var hint = document.createElement('div');
    hint.className = 'dgtr-hint';
    hint.textContent = 'Enter to send · Shift+Enter for a new line';
    wrap.appendChild(form); wrap.appendChild(hint);

    els.form = form;
    els.app.appendChild(head);
    els.app.appendChild(els.msgs);
    els.app.appendChild(wrap);
    document.body.appendChild(els.app);

    addMsg('assistant', GREETING, /*skipHistory*/ true);
    els.input.focus();
  }

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 170) + 'px';
  }

  function submit() {
    var q = els.input.value.trim();
    if (!q || state.busy) return;
    els.input.value = '';
    autosize();
    send(q);
  }

  function addMsg(role, text, skipHistory) {
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
      av.textContent = '💬';
      var body = document.createElement('div');
      body.className = 'dgtr-bot-text';
      body.textContent = text;
      node.appendChild(av); node.appendChild(body);
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
        '<div class="dgtr-avatar">💬</div><div class="dgtr-typing"><span></span><span></span><span></span></div>';
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
        setTyping(false);
        addMsg('assistant', reply);
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
