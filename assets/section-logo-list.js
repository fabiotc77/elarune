/* Elarune logo list: marquee pause control and quote tabs. The grid layout needs no script. */
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

class LogoListSection extends HTMLElement {
  connectedCallback() {
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    if (this.dataset.layout === 'marquee') this.setupMarquee(signal);
    if (this.dataset.layout === 'tabs') this.setupTabs(signal);
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.observer?.disconnect();
    this.observer = null;
  }

  setupMarquee(signal) {
    this.toggle = this.querySelector('[data-marquee-toggle]');
    const syncToggle = () => {
      if (this.toggle) this.toggle.hidden = REDUCED_MOTION.matches;
    };
    syncToggle();
    REDUCED_MOTION.addEventListener('change', syncToggle, { signal });
    this.toggle?.addEventListener('click', () => this.setPaused(!this.hasAttribute('data-paused')), { signal });

    /* Stop animating while the row is off screen. */
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        this.toggleAttribute('data-offscreen', !entries.some((entry) => entry.isIntersecting));
      });
      this.observer.observe(this);
    }

    /* Hold still while a merchant edits a logo in the theme editor. */
    document.addEventListener('shopify:block:select', (event) => {
      if (this.contains(event.target)) this.setAttribute('data-editor-paused', '');
    }, { signal });
    document.addEventListener('shopify:block:deselect', (event) => {
      if (this.contains(event.target)) this.removeAttribute('data-editor-paused');
    }, { signal });
  }

  setPaused(paused) {
    this.toggleAttribute('data-paused', paused);
    if (this.toggle) this.toggle.setAttribute('aria-label', paused ? this.toggle.dataset.labelPlay : this.toggle.dataset.labelPause);
  }

  setupTabs(signal) {
    this.tablist = this.querySelector('[role="tablist"]');
    this.tabs = [...this.querySelectorAll('[role="tab"]')];
    if (!this.tablist || !this.tabs.length) return;
    this.panels = this.tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

    this.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => this.select(index, false), { signal });
    });

    this.tablist.addEventListener('keydown', (event) => {
      const current = this.tabs.indexOf(event.target.closest?.('[role="tab"]'));
      if (current < 0) return;
      const rtl = getComputedStyle(this).direction === 'rtl';
      const last = this.tabs.length - 1;
      let next;
      switch (event.key) {
        case 'ArrowRight': next = rtl ? current - 1 : current + 1; break;
        case 'ArrowLeft': next = rtl ? current + 1 : current - 1; break;
        case 'Home': next = 0; break;
        case 'End': next = last; break;
        default: return;
      }
      event.preventDefault();
      if (next < 0) next = last;
      if (next > last) next = 0;
      this.select(next, true);
    }, { signal });

    document.addEventListener('shopify:block:select', (event) => {
      const index = this.panels.findIndex((panel) => panel && (panel === event.target || panel.contains(event.target)));
      if (index >= 0) this.select(index, false);
    }, { signal });
  }

  select(index, focus) {
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (this.panels[i]) this.panels[i].hidden = !selected;
    });
    const tab = this.tabs[index];
    if (focus) tab.focus({ preventScroll: true });
    this.reveal(tab);
  }

  /* Keep the active logo visible inside a scrolling tab row without moving the page. */
  reveal(tab) {
    const list = this.tablist;
    if (list.scrollWidth <= list.clientWidth + 1) return;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    let delta = 0;
    if (tabRect.left < listRect.left) delta = tabRect.left - listRect.left;
    else if (tabRect.right > listRect.right) delta = tabRect.right - listRect.right;
    if (delta) list.scrollBy({ left: delta, behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth' });
  }
}

if (!customElements.get('logo-list-section')) customElements.define('logo-list-section', LogoListSection);
