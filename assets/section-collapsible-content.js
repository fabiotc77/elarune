(() => {
  if (customElements.get('collapsible-group')) return;

  // Browsers that support <details name> close sibling rows natively; others get this fallback.
  const nativeExclusive = 'name' in HTMLDetailsElement.prototype;

  class CollapsibleGroup extends HTMLElement {
    connectedCallback() {
      this.controller = new AbortController();
      const { signal } = this.controller;

      this.addEventListener('toggle', (event) => {
        const row = event.target;
        if (nativeExclusive || this.dataset.single !== 'true') return;
        if (!(row instanceof HTMLDetailsElement) || !row.open) return;
        this.querySelectorAll('details.collapsible-row[open]').forEach((other) => {
          if (other !== row) other.open = false;
        });
      }, { capture: true, signal });

      // Theme editor: reveal the row a merchant selects in the sidebar.
      this.addEventListener('shopify:block:select', (event) => {
        const row = event.target.closest?.('details.collapsible-row');
        if (row) row.open = true;
      }, { signal });
    }

    disconnectedCallback() {
      this.controller?.abort();
    }
  }

  customElements.define('collapsible-group', CollapsibleGroup);
})();
