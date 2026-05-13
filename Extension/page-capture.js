// page-capture.js
// Capture layer with login/logout detection and cart-status logic.
// Injected into page MAIN world.

(function () {
  const MIDDLEWARE_URL = window.__MIDDLEWARE_URL__ || null;
  const LAST_SENT_KEY = "__WHOLA_LAST_SENT__";
  const LAST_KNOWN_EMAIL_KEY = "__WHOLA_LAST_KNOWN_EMAIL__";

  // --- Utilities ---
  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      const cache = new WeakSet();
      return JSON.stringify(obj, (k, v) => {
        if (typeof v === "object" && v !== null) {
          if (cache.has(v)) return "[Circular]";
          cache.add(v);
        }
        return v;
      });
    }
  }

  function simpleHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
  }

  // --- Data extraction helpers (minimal, robust) ---
  async function getCartStatusAndItems() {
    try {
      const res = await fetch('/api/checkout/pub/orderForm', { credentials: 'include' });
      if (!res.ok) return { cartStatus: 'No cart', items: [] };
      const orderForm = await res.json();
      const items = (orderForm.items || []).map(i => ({
        sku: i.id,
        name: i.name,
        qty: i.quantity,
        price: i.sellingPrice
      }));
      return { cartStatus: items.length > 0 ? 'Active cart' : 'No cart', items };
    } catch (e) {
      return { cartStatus: 'No cart', items: [] };
    }
  }

  function getProductFromJsonLd() {
    try {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || '{}');
          const arr = Array.isArray(data) ? data : [data];
          for (const item of arr) {
            if (item && (item['@type'] === 'Product' || item.name)) {
              return {
                productName: item.name || '',
                brandName: typeof item.brand === 'string' ? item.brand : item.brand?.name || '',
                categoryName: item.category || '',
                productId: item.sku || item.productID || item['@id'] || ''
              };
            }
          }
        } catch (e) { /* ignore parse errors */ }
      }
    } catch (e) {}
    return null;
  }

  async function getSessionEmailAndIds() {
    try {
      const res = await fetch('/api/sessions?items=profile.id,profile.email,authentication.storeUserEmail', { credentials: 'include' });
      if (!res.ok) return { email: null, id: null, sessionId: null };
      const data = await res.json();
      const email = data?.namespaces?.authentication?.storeUserEmail?.value || data?.namespaces?.profile?.email?.value || null;
      const id = data?.namespaces?.profile?.id?.value || null;
      return { email, id, sessionId: data?.id || null };
    } catch (e) {
      return { email: null, id: null, sessionId: null };
    }
  }

  // --- Forwarding bridge to extension background (via window events) ---
  function forwardToExtension(payload) {
    try {
      const ev = new CustomEvent('WHOLA_SEND_TO_MW', { detail: payload });
      window.dispatchEvent(ev);
    } catch (e) {
      console.warn('[WholaCapture] forwardToExtension failed', e);
    }
  }

  // --- Core: build payload and forward ---
  function buildPayload({ email, vtexCustomerId, sessionId, lastActivityType, product, cart }) {
    return {
      customerProperties: {
        email: email || null,
        vtexCustomerId: vtexCustomerId || null,
        sessionId: sessionId || null,
        lastActivityType: lastActivityType || 'Product view'
      },
      productProperties: {
        productName: product.productName || '',
        brandName: product.brandName || '',
        categoryName: product.categoryName || '',
        productId: product.productId || ''
      },
      cartProperties: {
        cartStatus: cart.cartStatus || '',
        items: cart.items || []
      }
    };
  }

  // --- Login / Logout detection and forced send logic ---
  async function captureAndForwardIfChanged() {
    const session = await getSessionEmailAndIds();
    const fallbackEmail = localStorage.getItem('whola_email') || null;
    const email = session.email || fallbackEmail;
    const vtexCustomerId = session.id || null;
    const sessionId = session.sessionId || null;

    const product = getProductFromJsonLd() || { productName: document.title || '', brandName: '', categoryName: '', productId: '' };
    const cart = await getCartStatusAndItems();

    // Detect login/logout by comparing with last known email stored in sessionStorage
    let lastKnownEmail = null;
    try {
      lastKnownEmail = sessionStorage.getItem(LAST_KNOWN_EMAIL_KEY) || null;
    } catch (e) {
      lastKnownEmail = null;
    }

    // Normalize cart status string for decision-making
    const hasItems = Array.isArray(cart.items) && cart.items.length > 0;

    // If email appeared (login)
    if (!lastKnownEmail && email) {
      // Login detected
      const cartStatus = hasItems ? 'Active Cart' : 'No Cart';
      const payload = buildPayload({
        email,
        vtexCustomerId,
        sessionId,
        lastActivityType: 'Login',
        product,
        cart: { cartStatus, items: cart.items || [] }
      });
      forwardToExtension(payload);
      // update last-known email
      try { sessionStorage.setItem(LAST_KNOWN_EMAIL_KEY, email); } catch (e) {}
      // Also persist last-sent hash so dedupe doesn't block immediate subsequent snapshots
      try { localStorage.setItem(LAST_SENT_KEY, simpleHash(safeStringify({ type: 'login', email, cartStatus }))); } catch (e) {}
      return;
    }

    // If email disappeared (logout)
    if (lastKnownEmail && !email) {
      // Logout detected
      const cartStatus = hasItems ? 'Abandoned Cart' : 'No Cart';
      const payload = buildPayload({
        email: lastKnownEmail, // use last known email to associate note
        vtexCustomerId,
        sessionId,
        lastActivityType: 'Logout',
        product,
        cart: { cartStatus, items: cart.items || [] }
      });
      forwardToExtension(payload);
      // clear last-known email
      try { sessionStorage.removeItem(LAST_KNOWN_EMAIL_KEY); } catch (e) {}
      try { localStorage.setItem(LAST_SENT_KEY, simpleHash(safeStringify({ type: 'logout', email: lastKnownEmail, cartStatus }))); } catch (e) {}
      return;
    }

    // No login/logout transition — proceed with normal snapshot dedupe for product/cart
    const snapshot = {
      email: email || null,
      product: {
        productName: product.productName || '',
        brandName: product.brandName || '',
        categoryName: product.categoryName || '',
        productId: product.productId || ''
      },
      cart: {
        cartStatus: cart.cartStatus,
        items: cart.items || []
      }
    };

    const snapshotStr = safeStringify(snapshot);
    const hash = simpleHash(snapshotStr);

    const last = localStorage.getItem(LAST_SENT_KEY);

    // If unchanged, do nothing
    if (last === hash) {
      return;
    }

    // Build payload (product view by default)
    const payload = buildPayload({
      email,
      vtexCustomerId,
      sessionId,
      lastActivityType: 'Product view',
      product,
      cart
    });

    forwardToExtension(payload);

    // Persist last-sent hash and last-known email
    try { localStorage.setItem(LAST_SENT_KEY, hash); } catch (e) {}
    try {
      if (email) sessionStorage.setItem(LAST_KNOWN_EMAIL_KEY, email);
      else sessionStorage.removeItem(LAST_KNOWN_EMAIL_KEY);
    } catch (e) {}
  }

  // --- Public helpers for manual triggers (exposed to page API) ---
  async function captureLoginManual() {
    const session = await getSessionEmailAndIds();
    const email = session.email || localStorage.getItem('whola_email') || null;
    const vtexCustomerId = session.id || null;
    const sessionId = session.sessionId || null;
    const cart = await getCartStatusAndItems();
    const hasItems = Array.isArray(cart.items) && cart.items.length > 0;
    const cartStatus = hasItems ? 'Active Cart' : 'No Cart';
    const product = getProductFromJsonLd() || { productName: document.title || '', brandName: '', categoryName: '', productId: '' };

    if (!email) {
      // nothing to do if no email known
      return { status: 0, error: 'no-email' };
    }

    const payload = buildPayload({
      email,
      vtexCustomerId,
      sessionId,
      lastActivityType: 'Login',
      product,
      cart: { cartStatus, items: cart.items || [] }
    });

    forwardToExtension(payload);
    try { sessionStorage.setItem(LAST_KNOWN_EMAIL_KEY, email); } catch (e) {}
    return { status: 1 };
  }

  async function captureLogoutManual() {
    const session = await getSessionEmailAndIds();
    const email = sessionStorage.getItem(LAST_KNOWN_EMAIL_KEY) || localStorage.getItem('whola_email') || null;
    const vtexCustomerId = session.id || null;
    const sessionId = session.sessionId || null;
    const cart = await getCartStatusAndItems();
    const hasItems = Array.isArray(cart.items) && cart.items.length > 0;
    const cartStatus = hasItems ? 'Abandoned Cart' : 'No Cart';
    const product = getProductFromJsonLd() || { productName: document.title || '', brandName: '', categoryName: '', productId: '' };

    if (!email) {
      return { status: 0, error: 'no-email' };
    }

    const payload = buildPayload({
      email,
      vtexCustomerId,
      sessionId,
      lastActivityType: 'Logout',
      product,
      cart: { cartStatus, items: cart.items || [] }
    });

    forwardToExtension(payload);
    try { sessionStorage.removeItem(LAST_KNOWN_EMAIL_KEY); } catch (e) {}
    return { status: 1 };
  }

  // --- Init and periodic checks ---
  (function init() {
    // Run once immediately
    captureAndForwardIfChanged();

    // Periodic check (5s)
    setInterval(captureAndForwardIfChanged, 5000);

    // Expose manual triggers for debugging/testing
    try {
      window.__WHOLA_CAPTURE_LOGIN__ = captureLoginManual;
      window.__WHOLA_CAPTURE_LOGOUT__ = captureLogoutManual;
    } catch (e) {}
  })();

  console.log("[WholaCapture] page-capture loaded (login/logout detection enabled)");
})();
