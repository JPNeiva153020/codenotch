/* Experimental DOM reader. No network, credentials, storage or page mutations. */
(() => {
  'use strict';
  const normalize = value => String(value).replace(/\s+/gu, ' ').trim();
  const ownText = el => {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) {
      if (text.length + node.nodeValue.length > 256) return '';
      text += ' ' + node.nodeValue;
    }
    return normalize(text);
  };
  const selector = 'h1,h2,h3,h4,p,span,div,strong,section';
  function visible(el) {
    if (el.closest('[hidden],[aria-hidden="true"],script,style,template,nav,aside,[contenteditable],textarea,input,[role="log"],[data-message-id],user-query,model-response,message-content')) return false;
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return el.getClientRects().length > 0;
  }
  function entries(root) {
    // No body.innerText, ancestor.textContent, attributes, inputs or HTML dumps.
    return [...root.querySelectorAll(selector)].filter(visible).map(el => ({ el, text: ownText(el) }));
  }
  function rowText(root) {
    // Reconstruct only small, visible rows of supported elements, never a card dump.
    let count = 0, size = 0;
    const parts = [];
    function visit(node, depth) {
      if (++count > 32 || depth > 4) return false;
      if (node.nodeType === 3) {
        size += node.nodeValue.length;
        if (size > 256) return false;
        parts.push(node.nodeValue); return true;
      }
      if (node.nodeType !== 1) return true;
      if (!visible(node)) return true;
      if (!node.matches('div,p,span,strong,time')) return false;
      for (const child of node.childNodes) if (!visit(child, depth+1)) return false;
      return true;
    }
    return visit(root, 0) ? normalize(parts.join(' ')) : '';
  }
  function fieldRows(card, predicate) {
    const candidates = [card, ...card.querySelectorAll('div,p,span,strong,time')];
    if (candidates.length > 128) return null;
    const rows = candidates.filter(visible).map(el => ({ el, text: rowText(el) })).filter(row => predicate(row.text));
    // Nested wrappers of one row are not duplicate observations. Disjoint rows are.
    const labelOnly = text => /^Quantidade usada\s*:$/u.test(text);
    return rows.filter(row =>
      !rows.some(other => row.el !== other.el && row.el.contains(other.el) && !labelOnly(other.text))
      && !(labelOnly(row.text) && rows.some(other => other.el !== row.el && other.el.contains(row.el) && !labelOnly(other.text))));
  }
  const isPercentage = text => /^Quantidade usada\s*:/u.test(text);
  const isReset = text => /^\d/u.test(text) && /o limite de uso é redefinido[.]?$/iu.test(text);
  function resetParts(text) {
    const match = text.match(/^(?:(\d{1,2}) de ([a-zç]+)\s*\.?\s*,?\s*)?(\d{1,2})\s*:\s*(\d{2})\s*:\s*o limite de uso é redefinido\.?$/iu);
    if (!match) return null;
    const hour = Number(match[3]), minute = Number(match[4]);
    if (hour > 23 || minute > 59) return null;
    let month = null, day = null;
    if (match[1]) {
      const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      month = months.indexOf(match[2].toLowerCase()) + 1;
      day = Number(match[1]);
      if (!month || day < 1 || day > [31,29,31,30,31,30,31,31,30,31,30,31][month-1]) return null;
    }
    // The screenshots omit year/date/zone. Preserve components; never guess epoch.
    return { day, month, year: null, hour, minute, timezone: null, epoch_ms: null, needs_confirmation: true };
  }
  function readWindow(label, id, scope, allLabels) {
    const empty = { id, used_percent: null, remaining_percent: null, reset: null, status: 'unavailable', issues: [] };
    if (label.length !== 1) return { ...empty, issues: [label.length ? 'duplicate_label' : 'missing_label'] };
    let card = label[0].el.parentElement;
    let percentages = [], resets = [];
    // A label's inner header may have only one field. Expand within the same card,
    // stopping before any other quota label; never stop on the first field alone.
    for (let depth = 0; card && card !== scope && depth < 6 && scope.contains(card); depth++, card = card.parentElement) {
      if (allLabels.some(x => x.el !== label[0].el && card.contains(x.el))) break;
      const p = fieldRows(card, isPercentage), r = fieldRows(card, isReset);
      if (!p || !r) return { ...empty, issues: ['card_too_large'] };
      percentages = p; resets = r;
    }
    if (!percentages.length && !resets.length) return { ...empty, issues: ['missing_fields'] };
    const result = { ...empty };
    if (percentages.length === 1) {
      const match = percentages[0].text.match(/^Quantidade usada\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/u);
      const value = match ? Number(match[1].replace(',', '.')) : NaN;
      if (Number.isFinite(value) && value >= 0 && value <= 100) {
        result.used_percent = value;
        result.remaining_percent = Number((100-value).toFixed(6));
      } else result.issues.push('invalid_percentage');
    } else result.issues.push(percentages.length ? 'duplicate_percentage' : 'missing_percentage');
    if (resets.length === 1) {
      result.reset = resetParts(resets[0].text);
      if (!result.reset) result.issues.push('invalid_reset');
    } else result.issues.push(resets.length ? 'duplicate_reset' : 'missing_reset');
    result.status = result.used_percent !== null ? (result.issues.length ? 'partial' : 'observed') : 'unavailable';
    return result;
  }
  function extract(doc = document, now = Date.now()) {
    const base = { schema_version: 1, provider: 'gemini_web', model: null, scope: 'Gemini Web — escopo do modelo não confirmado', origin: 'visible_ui', collection: 'dom_on_user_action', observed_at_ms: now, browser_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'unavailable', plan: null, freshness_label: null, windows: [], issues: [] };
    if (!Number.isFinite(now) || now < 0) return { ...base, observed_at_ms: null, issues: ['invalid_observation_time'] };
    const titles = [...doc.querySelectorAll('main h1,main h2,[role="main"] h1,[role="main"] h2')].filter(el => visible(el) && ownText(el) === 'Limites de uso');
    if (titles.length !== 1) return { ...base, issues: [titles.length ? 'duplicate_title' : 'limits_page_not_recognized'] };
    const main = titles[0].closest('main,[role="main"]');
    if (main.querySelector('[role="log"],[data-message-id],[contenteditable="true"],user-query,model-response,message-content')) return { ...base, issues: ['conversation_surface_detected'] };
    if (main.querySelectorAll(selector).length > 2000) return { ...base, issues: ['layout_too_large'] };
    let scope = titles[0].parentElement, fields = [];
    while (scope && main.contains(scope)) {
      fields = entries(scope);
      if (fields.some(x => x.text === 'Uso atual' || x.text === 'Limite semanal')) break;
      if (scope === main) break;
      scope = scope.parentElement;
    }
    if (!fields.some(x => x.text === 'Uso atual' || x.text === 'Limite semanal')) return { ...base, issues: ['missing_quota_labels'] };
    const labels = fields.filter(x => ['Uso atual','Limite semanal'].includes(x.text));
    const plans = fields.filter(x => x.text === 'PRO');
    base.plan = plans.length === 1 ? 'PRO' : null;
    base.freshness_label = fields.some(x => x.text === 'Atualizado agora') ? 'Atualizado agora' : null;
    base.windows = [readWindow(labels.filter(x => x.text === 'Uso atual'), 'current', scope, labels), readWindow(labels.filter(x => x.text === 'Limite semanal'), 'weekly', scope, labels)];
    base.status = base.windows.every(w => w.status === 'observed') ? 'observed' : base.windows.some(w => w.used_percent !== null) ? 'partial' : 'unavailable';
    return base;
  }
  function getContainer(doc = document) {
    const titles = [...doc.querySelectorAll('main h1,main h2,[role="main"] h1,[role="main"] h2')].filter(el => visible(el) && ownText(el) === 'Limites de uso');
    if (titles.length !== 1) return null;
    const main = titles[0].closest('main,[role="main"]');
    if (main.querySelector('[role="log"],[data-message-id],[contenteditable="true"],user-query,model-response,message-content')) return null;
    if (main.querySelectorAll(selector).length > 2000) return null;
    for (let scope=titles[0].parentElement;scope && main.contains(scope);scope=scope.parentElement) {
      const labels=entries(scope).filter(x=>['Uso atual','Limite semanal'].includes(x.text));
      if (labels.length===2 && labels.some(x=>x.text==='Uso atual') && labels.some(x=>x.text==='Limite semanal')) return scope;
      if (scope===main) break;
    }
    return null;
  }
  globalThis.CodenotchGeminiQuotaPrototype = Object.freeze({ extract, getContainer });
})();
