// Cookie consent banner for Shopify's Customer Privacy API.
// While a decision is pending, <html data-consent-pending> is set; `consent:resolved` fires on document
// once the banner is not required, the API is unavailable, or a choice has been recorded.
const API_TIMEOUT = 8000;
let privacyRequest;

const loadPrivacy = () => {
  privacyRequest ??= new Promise(resolve => {
    const shopify = window.Shopify;
    if (shopify?.customerPrivacy) { resolve(shopify.customerPrivacy); return; }
    if (typeof shopify?.loadFeatures !== 'function') { resolve(null); return; }
    const timer = setTimeout(() => resolve(window.Shopify?.customerPrivacy || null), API_TIMEOUT);
    try {
      shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], error => {
        clearTimeout(timer);
        resolve(error ? null : window.Shopify?.customerPrivacy || null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
  return privacyRequest;
};

class CookieConsent extends HTMLElement {
  connectedCallback() {
    this.life?.abort();
    this.life = new AbortController();
    const { signal } = this.life;
    this.surface = this.querySelector('[data-consent-surface]');
    this.panel = this.querySelector('[data-consent-panel]');
    this.manage = this.querySelector('[data-consent-action="manage"]');
    this.saveButton = this.querySelector('[data-consent-action="save"]');
    this.status = this.querySelector('[data-consent-status]');
    this.editor = this.dataset.designMode === 'true' || Boolean(window.Shopify?.designMode);
    if (!this.surface) return;

    this.addEventListener('click', event => {
      const button = event.target.closest('[data-consent-action]');
      if (button && this.contains(button)) this.act(button.dataset.consentAction);
    }, { signal });

    // Escape closes the preferences panel only; it never records a choice.
    this.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.panel || this.panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      this.togglePanel(false);
      this.manage?.focus();
    }, { signal });

    // Links to #cookie-preferences (or [data-consent-open]) reopen the choices, e.g. from the footer.
    document.addEventListener('click', event => {
      const opener = event.target.closest?.('[data-consent-open], a[href$="#cookie-preferences"]');
      if (!opener || this.contains(opener)) return;
      event.preventDefault();
      if (this.editor) { this.show({ panel: true, focus: true, opener }); return; }
      loadPrivacy().then(privacy => {
        if (privacy && this.isConnected) this.show({ panel: true, focus: true, opener });
      });
    }, { signal });

    if (this.editor) {
      const id = this.dataset.sectionId;
      const matches = event => event.detail?.sectionId === id;
      document.addEventListener('shopify:section:select', event => { if (matches(event)) this.show(); }, { signal });
      document.addEventListener('shopify:section:load', event => { if (matches(event)) this.show(); }, { signal });
      document.addEventListener('shopify:section:deselect', event => { if (matches(event)) this.hide({ restore: false }); }, { signal });
      return;
    }

    if (this.dataset.enabled !== 'true') return;
    this.pending = true;
    document.documentElement.dataset.consentPending = '';
    loadPrivacy().then(privacy => {
      if (!this.isConnected) return;
      let required = false;
      try { required = Boolean(privacy?.shouldShowBanner?.()); } catch { required = false; }
      if (required) this.show({ focus: this.dataset.position === 'dialog' });
      else this.resolve({ required: false, available: Boolean(privacy) });
    });
  }

  disconnectedCallback() {
    this.life?.abort();
    clearTimeout(this.timer);
    if (this.pending) {
      this.pending = false;
      delete document.documentElement.dataset.consentPending;
    }
    if (this.surface?.localName === 'dialog' && this.surface.open) this.surface.close();
  }

  resolve(detail) {
    this.pending = false;
    delete document.documentElement.dataset.consentPending;
    document.dispatchEvent(new CustomEvent('consent:resolved', { detail }));
  }

  show({ panel = false, focus = false, opener = null } = {}) {
    const active = document.activeElement;
    this.opener = opener || (active && active !== document.body && !this.contains(active) ? active : this.opener);
    this.syncFields();
    if (this.surface.localName === 'dialog') {
      if (!this.surface.open) this.surface.show();
    } else {
      this.surface.hidden = false;
    }
    this.setAttribute('data-visible', '');
    this.togglePanel(panel, false);
    if (!focus) return;
    const target = panel ? this.panel?.querySelector('input:not(:disabled)') : this.querySelector('.cookie-consent__heading');
    target?.focus({ preventScroll: true });
  }

  hide({ restore = true } = {}) {
    const hadFocus = this.surface.contains(document.activeElement);
    this.removeAttribute('data-visible');
    this.togglePanel(false, false);
    if (this.surface.localName === 'dialog') {
      if (this.surface.open) this.surface.close();
    } else {
      this.surface.hidden = true;
    }
    if (!hadFocus || !restore) return;
    const target = this.opener?.isConnected && this.opener.getClientRects().length ? this.opener : document.getElementById('MainContent');
    target?.focus({ preventScroll: true });
  }

  syncFields() {
    let current = {};
    try { current = window.Shopify?.customerPrivacy?.currentVisitorConsent?.() || {}; } catch { current = {}; }
    this.querySelectorAll('[data-consent-field]').forEach(input => {
      input.checked = current[input.dataset.consentField] === 'yes';
    });
  }

  togglePanel(open, moveFocus = true) {
    if (!this.panel) return;
    this.panel.hidden = !open;
    this.manage?.setAttribute('aria-expanded', String(open));
    if (this.saveButton) this.saveButton.hidden = !open;
    if (open && moveFocus) this.panel.querySelector('input:not(:disabled)')?.focus();
  }

  choice(action) {
    const all = value => ({ analytics: value, marketing: value, preferences: value, sale_of_data: value });
    if (action === 'accept') return all(true);
    if (action === 'decline') return all(false);
    if (action !== 'save') return null;
    const field = name => Boolean(this.querySelector(`[data-consent-field="${name}"]`)?.checked);
    return { analytics: field('analytics'), marketing: field('marketing'), preferences: field('preferences'), sale_of_data: field('marketing') };
  }

  async act(action) {
    if (action === 'manage') { this.togglePanel(Boolean(this.panel?.hidden)); return; }
    const consent = this.choice(action);
    if (!consent || this.busy) return;
    if (this.editor) { this.hide(); return; }
    const privacy = await loadPrivacy();
    if (!this.isConnected) return;
    if (typeof privacy?.setTrackingConsent !== 'function') { this.announce(this.dataset.error); return; }
    this.setBusy(true);
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(this.timer);
      this.setBusy(false);
      if (result?.error) { this.announce(this.dataset.error); return; }
      this.hide();
      this.announce(this.dataset.saved);
      this.resolve({ required: true, consent });
    };
    this.timer = setTimeout(() => done({ error: 'timeout' }), API_TIMEOUT);
    try {
      privacy.setTrackingConsent(consent, done);
    } catch (error) {
      done({ error });
    }
  }

  setBusy(state) {
    this.busy = state;
    if (state) this.surface.setAttribute('aria-busy', 'true');
    else this.surface.removeAttribute('aria-busy');
    this.querySelectorAll('[data-consent-action]').forEach(button => { button.disabled = state; });
  }

  announce(message) {
    if (!this.status || !message) return;
    this.status.textContent = '';
    requestAnimationFrame(() => { this.status.textContent = message; });
  }
}

if (!customElements.get('cookie-consent')) customElements.define('cookie-consent', CookieConsent);
