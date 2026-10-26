/* Elarune slideshow: accessible carousel (ARIA APG pattern) with optional, pausable autoplay. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

class SlideshowComponent extends HTMLElement {
  connectedCallback() {
    this.life?.abort();
    this.life = new AbortController();
    const { signal } = this.life;

    this.track = this.querySelector('[data-slideshow-track]');
    this.slides = [...this.querySelectorAll('[data-slideshow-slide]')];
    if (!this.track || this.slides.length < 2) return;

    this.dots = [...this.querySelectorAll('[data-slideshow-dot]')];
    this.controls = this.querySelector('[data-slideshow-controls]');
    this.toggle = this.querySelector('[data-slideshow-toggle]');
    this.counter = this.querySelector('[data-slideshow-current]');
    this.fade = this.dataset.transition === 'fade';
    this.interval = Math.min(10, Math.max(3, Number(this.dataset.interval) || 6)) * 1000;
    this.autoplay = this.dataset.autoplay === 'true';
    this.userPaused = reducedMotion.matches;
    this.hovered = false;
    this.focused = false;
    this.visible = true;
    this.editorHold = false;
    this.index = 0;
    this.remaining = this.interval;
    this.startedAt = 0;
    this.style.setProperty('--slideshow-interval', `${this.interval}ms`);

    this.querySelector('[data-slideshow-prev]')?.addEventListener('click', () => this.go(this.index - 1), { signal });
    this.querySelector('[data-slideshow-next]')?.addEventListener('click', () => this.go(this.index + 1), { signal });
    this.dots.forEach((dot, i) => dot.addEventListener('click', () => this.go(i), { signal }));
    this.toggle?.addEventListener('click', () => {
      this.userPaused = !this.userPaused;
      this.remaining = this.interval;
      this.startedAt = 0;
      if (!this.userPaused) this.restartProgress();
      this.schedule();
    }, { signal });
    this.controls?.addEventListener('keydown', (event) => this.onKeydown(event), { signal });

    // Rotation pauses while a mouse rests on the carousel or keyboard focus is inside it.
    this.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      this.hovered = true;
      this.schedule();
    }, { signal });
    this.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      this.hovered = false;
      this.schedule();
    }, { signal });
    this.addEventListener('focusin', (event) => {
      // The pause/play control is exempt so it can restart rotation.
      this.focused = event.target !== this.toggle && this.isKeyboardFocus(event.target);
      this.schedule();
    }, { signal });
    this.addEventListener('focusout', (event) => {
      if (this.contains(event.relatedTarget)) return;
      this.focused = false;
      this.schedule();
    }, { signal });
    document.addEventListener('visibilitychange', () => this.schedule(), { signal });
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) this.userPaused = true;
      this.schedule();
    }, { signal });

    if (this.fade) {
      // Stacked slides cannot scroll, so touch swipes are read directly (mirrored in RTL).
      this.track.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;
        this.swipe = { x: event.clientX, y: event.clientY };
      }, { signal });
      this.track.addEventListener('pointerup', (event) => {
        if (!this.swipe) return;
        const dx = event.clientX - this.swipe.x;
        const dy = event.clientY - this.swipe.y;
        this.swipe = null;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        this.go(this.index + ((dx < 0) !== this.isRtl() ? 1 : -1));
      }, { signal });
      this.track.addEventListener('pointercancel', () => { this.swipe = null; }, { signal });
    } else {
      this.track.addEventListener('scroll', () => {
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => this.syncFromScroll(), 90);
      }, { passive: true, signal });
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.align(this.index, 'auto'));
        this.resizeObserver.observe(this.track);
      }
    }

    if ('IntersectionObserver' in window) {
      this.intersection = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.schedule();
      }, { threshold: 0.2 });
      this.intersection.observe(this);
    }

    // Theme editor: show the selected slide and hold rotation until it is deselected.
    document.addEventListener('shopify:block:select', (event) => {
      const index = this.slides.indexOf(event.target);
      if (index < 0) return;
      this.editorHold = true;
      this.go(index, 'auto');
    }, { signal });
    document.addEventListener('shopify:block:deselect', (event) => {
      if (!this.slides.includes(event.target)) return;
      this.editorHold = false;
      this.schedule();
    }, { signal });

    this.update(0);
  }

  // Runs on shopify:section:unload and any other removal: every listener shares one AbortSignal.
  disconnectedCallback() {
    this.life?.abort();
    this.life = null;
    clearTimeout(this.timer);
    clearTimeout(this.scrollTimer);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.resizeObserver = null;
    this.intersection = null;
    this.swipe = null;
  }

  isKeyboardFocus(element) {
    try {
      return element.matches(':focus-visible');
    } catch {
      return true;
    }
  }

  isRtl() {
    return getComputedStyle(this).direction === 'rtl';
  }

  motionOff() {
    return reducedMotion.matches || document.documentElement.dataset.motionEnabled === 'false';
  }

  onKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = this.isRtl() ? -1 : 1;
    let target;
    switch (event.key) {
      case 'ArrowRight': target = this.index + step; break;
      case 'ArrowLeft': target = this.index - step; break;
      case 'Home': target = 0; break;
      case 'End': target = this.slides.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const fromDot = this.dots.includes(event.target);
    this.go(target);
    if (fromDot) this.dots[this.index]?.focus();
  }

  go(target, behavior) {
    const count = this.slides.length;
    const index = ((target % count) + count) % count;
    if (!this.fade) this.align(index, behavior || (this.motionOff() ? 'auto' : 'smooth'));
    this.update(index);
  }

  align(index, behavior) {
    const slide = this.slides[index];
    if (!slide || !this.track) return;
    const delta = slide.getBoundingClientRect().left - this.track.getBoundingClientRect().left;
    if (Math.abs(delta) > 1) this.track.scrollBy({ left: delta, behavior });
  }

  syncFromScroll() {
    const width = this.track?.clientWidth;
    if (!width) return;
    const index = Math.min(this.slides.length - 1, Math.round(Math.abs(this.track.scrollLeft) / width));
    if (index !== this.index) this.update(index);
  }

  update(index) {
    this.index = index;
    this.slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle('is-active', active);
      slide.toggleAttribute('inert', !active);
    });
    this.dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (this.counter) this.counter.textContent = String(index + 1).padStart(2, '0');
    this.remaining = this.interval;
    this.startedAt = 0;
    this.restartProgress();
    this.schedule();
  }

  restartProgress() {
    this.dots.forEach((dot) => dot.classList.remove('is-progress'));
    const dot = this.dots[this.index];
    if (!dot) return;
    void dot.offsetWidth;
    dot.classList.add('is-progress');
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.life) return;
    if (this.startedAt) {
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
      this.startedAt = 0;
    }
    const rotating = this.autoplay && !this.userPaused;
    const playing = rotating && !this.hovered && !this.focused && this.visible && !document.hidden && !this.editorHold;
    this.dataset.rotating = String(rotating);
    this.dataset.playing = String(playing);
    // Announce slide changes only when they are not happening automatically.
    this.track.setAttribute('aria-live', playing ? 'off' : 'polite');
    this.toggle?.setAttribute('aria-label', rotating ? this.toggle.dataset.labelPause : this.toggle.dataset.labelPlay);
    if (!playing) return;
    this.startedAt = performance.now();
    this.timer = setTimeout(() => {
      this.startedAt = 0;
      this.go(this.index + 1);
    }, this.remaining);
  }
}

if (!customElements.get('slideshow-component')) customElements.define('slideshow-component', SlideshowComponent);
