/* Lightweight event trigger on /app routes. Never reads conversation text or inputs. */
(() => {
  'use strict';
  if (globalThis.__codenotchChatTriggerInstalled) return;
  const href = String(globalThis.location?.href || '');
  if (!/^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app(?:\/|$|\?)/u.test(href)) return;
  globalThis.__codenotchChatTriggerInstalled = true;

  const TURN_DELAY_MS = 8000;
  let turnTimer = null;

  function notify(type) {
    try {
      const currentHref = String(globalThis.location?.href || '');
      if (!/^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app(?:\/|$|\?)/u.test(currentHref)) return;
      const p = chrome.runtime?.sendMessage?.({ type, url: currentHref });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  function scheduleTurnCompleted() {
    if (turnTimer !== null) clearTimeout(turnTimer);
    turnTimer = setTimeout(() => {
      turnTimer = null;
      notify('GEMINI_TURN_COMPLETED');
    }, TURN_DELAY_MS);
  }

  function isPromptInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches?.('textarea,input[type="text"],[contenteditable="true"],[contenteditable=""],[role="textbox"]')) return true;
    return Boolean(el.closest?.('textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"],rich-textarea'));
  }

  function isSendButton(el) {
    if (!el || el.nodeType !== 1) return false;
    const btn = el.closest?.('button,[role="button"]');
    if (!btn) return false;
    return Boolean(
      btn.matches?.(
        'button.send-button,button[type="submit"],button[aria-label*="Enviar" i],button[aria-label*="Send" i],button[data-test-id*="send" i],[role="button"][aria-label*="Enviar" i],[role="button"][aria-label*="Send" i]'
      )
    );
  }

  try {
    document.addEventListener?.('keydown', event => {
      if (!event || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (isPromptInput(event.target)) {
        scheduleTurnCompleted();
      }
    }, true);

    document.addEventListener?.('click', event => {
      if (isSendButton(event?.target)) {
        scheduleTurnCompleted();
      }
    }, true);
  } catch {}

  notify('GEMINI_APP_ACTIVE');
})();
