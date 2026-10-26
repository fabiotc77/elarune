// Progressive "load more" and infinite loading for the collection grid.
// Without JavaScript the Load more link and numbered pagination remain real page links.
class CollectionPaging extends HTMLElement {
  connectedCallback() {
    this.life?.abort();
    this.life = new AbortController();
    const { signal } = this.life;
    this.live = this.querySelector('[data-paging-live]');
    this.progress = this.querySelector('[data-paging-progress]');
    const numbers = this.numbers();
    if (numbers && this.dataset.firstPage === 'true' && this.querySelector('[data-paging-next]')) numbers.hidden = true;
    this.addEventListener('click', event => {
      const link = event.target.closest('[data-paging-next]');
      if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.load(link, true);
    }, { signal });
    signal.addEventListener('abort', () => this.observer?.disconnect(), { once: true });
    if (this.dataset.mode === 'infinite' && 'IntersectionObserver' in window) this.observe();
  }

  disconnectedCallback() {
    this.life?.abort();
    this.observer?.disconnect();
    this.observer = null;
  }

  grid() {
    return document.getElementById(this.dataset.grid);
  }

  numbers() {
    return this.dataset.numbers ? document.getElementById(this.dataset.numbers) : null;
  }

  observe() {
    this.observer?.disconnect();
    const link = this.querySelector('[data-paging-next]');
    if (!link) return;
    // A fresh observer reports the current intersection, so short pages keep filling the viewport.
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) this.load(link, false);
    }, { rootMargin: '0px 0px 480px 0px' });
    this.observer.observe(link);
  }

  async load(link, fromActivation) {
    if (this.loading) return;
    const href = link.href;
    const grid = this.grid();
    if (!href) return;
    if (!grid) { window.location.assign(href); return; }
    this.loading = true;
    this.observer?.disconnect();
    const label = link.querySelector('[data-paging-label]');
    const idle = label?.textContent;
    if (label && this.dataset.loading) label.textContent = this.dataset.loading;
    this.setAttribute('aria-busy', 'true');
    link.setAttribute('aria-disabled', 'true');
    let succeeded = false;
    try {
      const url = new URL(href, window.location.href);
      if (this.dataset.section) url.searchParams.set('section_id', this.dataset.section);
      const response = await fetch(url, { headers: { Accept: 'text/html' }, credentials: 'same-origin', signal: this.life.signal });
      if (!response.ok) throw new Error(String(response.status));
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const incomingGrid = doc.getElementById(this.dataset.grid);
      if (!incomingGrid) throw new Error('grid');
      // The grid may have been replaced (editor reload or a filter re-render) while the request ran.
      if (!this.isConnected || grid !== this.grid()) return;

      const added = [...incomingGrid.children]
        .filter(node => !node.matches('.empty-state'))
        .map(node => {
          const adopted = grid.appendChild(document.adoptNode(node));
          adopted.setAttribute('data-paging-new', '');
          return adopted;
        });

      const incoming = doc.querySelector(`collection-paging[data-grid="${CSS.escape(this.dataset.grid)}"]`);
      const progress = incoming?.querySelector('[data-paging-progress]')?.textContent;
      if (progress && this.progress) this.progress.textContent = progress;

      const numbers = this.numbers();
      const incomingNumbers = this.dataset.numbers ? doc.getElementById(this.dataset.numbers) : null;
      if (numbers && incomingNumbers) numbers.innerHTML = incomingNumbers.innerHTML;

      const nextHref = incoming?.querySelector('[data-paging-next]')?.getAttribute('href');
      const hadFocus = document.activeElement === link;
      if (nextHref && added.length) {
        link.setAttribute('href', nextHref);
      } else {
        link.remove();
      }

      try {
        if (new URL(href, window.location.href).origin === window.location.origin) history.replaceState(history.state, '', href);
      } catch { /* History updates are optional. */ }

      if (fromActivation || (hadFocus && !link.isConnected)) {
        const first = added.map(node => (node.matches('.product-card') ? node : node.querySelector('.product-card'))).find(Boolean);
        first?.querySelector('a[href]')?.focus({ preventScroll: false });
      }
      this.announce(added.length);
      document.dispatchEvent(new CustomEvent('collection:products-appended', { detail: { nodes: added, grid } }));
      succeeded = true;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      // Button activation falls back to the real next page; infinite loading leaves the visible button in place.
      if (fromActivation) window.location.assign(href);
    } finally {
      this.loading = false;
      this.removeAttribute('aria-busy');
      if (link.isConnected) {
        link.removeAttribute('aria-disabled');
        if (label && idle) label.textContent = idle;
        if (succeeded && this.dataset.mode === 'infinite' && 'IntersectionObserver' in window) this.observe();
      }
    }
  }

  announce(count) {
    if (!this.live || !this.dataset.loaded) return;
    this.live.textContent = '';
    requestAnimationFrame(() => {
      this.live.textContent = this.dataset.loaded.replace('[count]', String(count));
    });
  }
}

if (!customElements.get('collection-paging')) customElements.define('collection-paging', CollectionPaging);
