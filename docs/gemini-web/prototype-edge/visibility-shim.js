/* MAIN world visibility and requestAnimationFrame shim for hidden /usage tabs. */
(() => {
  'use strict';
  if (globalThis.__codenotchVisibilityShimApplied) return;
  const pathname = String(globalThis.location?.pathname || '');
  if (pathname && !/^\/(?:u\/\d+\/)?usage\/?$/u.test(pathname)) return;
  globalThis.__codenotchVisibilityShimApplied = true;

  try {
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true
    });
  } catch {}

  try {
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true
    });
  } catch {}

  try {
    Object.defineProperty(document, 'webkitHidden', {
      get: () => false,
      configurable: true
    });
  } catch {}

  try {
    Object.defineProperty(document, 'webkitVisibilityState', {
      get: () => 'visible',
      configurable: true
    });
  } catch {}

  const blockVisibilityChange = event => {
    try {
      event?.stopImmediatePropagation?.();
      event?.stopPropagation?.();
    } catch {}
  };
  try {
    document.addEventListener?.('visibilitychange', blockVisibilityChange, true);
    globalThis.addEventListener?.('visibilitychange', blockVisibilityChange, true);
  } catch {}

  const nativeRaf = typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : null;
  const nativeCancelRaf = typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : null;
  const activeCallbacks = new Map();
  let nextShimId = 1000000;

  const nowTimestamp = () => {
    try {
      return typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now();
    } catch {
      return Date.now();
    }
  };

  globalThis.requestAnimationFrame = function shimmedRequestAnimationFrame(callback) {
    if (typeof callback !== 'function') return 0;
    const id = ++nextShimId;
    let done = false;
    const run = timestamp => {
      if (done) return;
      done = true;
      const entry = activeCallbacks.get(id);
      activeCallbacks.delete(id);
      if (entry?.timerId !== null && entry?.timerId !== undefined) {
        clearTimeout(entry.timerId);
      }
      callback(Number.isFinite(timestamp) ? timestamp : nowTimestamp());
    };
    const timerId = setTimeout(() => run(nowTimestamp()), 16);
    let nativeId = null;
    if (nativeRaf) {
      try {
        nativeId = nativeRaf(ts => run(ts));
      } catch {}
    }
    activeCallbacks.set(id, { timerId, nativeId });
    return id;
  };

  globalThis.cancelAnimationFrame = function shimmedCancelAnimationFrame(id) {
    const entry = activeCallbacks.get(id);
    if (entry) {
      activeCallbacks.delete(id);
      if (entry.timerId !== null && entry.timerId !== undefined) {
        clearTimeout(entry.timerId);
      }
      if (entry.nativeId !== null && entry.nativeId !== undefined && nativeCancelRaf) {
        try { nativeCancelRaf(entry.nativeId); } catch {}
      }
    } else if (nativeCancelRaf) {
      try { nativeCancelRaf(id); } catch {}
    }
  };
})();
