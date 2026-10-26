/* Elarune video section. Nothing from YouTube or Vimeo is requested before the visitor presses play. */
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

const HOSTS = {
  youtube: {
    origin: 'https://www.youtube-nocookie.com',
    id: /^[\w-]{6,20}$/,
    src: (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&enablejsapi=1`,
    pause: JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] })
  },
  vimeo: {
    origin: 'https://player.vimeo.com',
    id: /^\d{1,12}$/,
    src: (id) => `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`,
    pause: JSON.stringify({ method: 'pause' })
  }
};

class VideoFeature extends HTMLElement {
  connectedCallback() {
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.visible = false;
    this.userPaused = false;
    this.userStarted = false;
    this.slot = this.querySelector('[data-video-player]');
    this.playControl = this.querySelector('[data-video-play]');
    this.toggle = this.querySelector('[data-video-toggle]');

    if (this.dataset.mode === 'background') this.setupBackground(signal);
    else if (this.playControl) this.setupFacade(signal);

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        this.update();
      }, { rootMargin: '80px 0px' });
      this.observer.observe(this);
    } else {
      this.visible = true;
      this.update();
    }
  }

  disconnectedCallback() {
    this.pausePlayer();
    this.abort?.abort();
    this.observer?.disconnect();
    this.observer = null;
  }

  /* Click-to-load facade. */
  setupFacade(signal) {
    const control = this.playControl;
    control.hidden = false;
    if (control.tagName === 'A') {
      control.setAttribute('role', 'button');
      control.addEventListener('keydown', (event) => {
        if (event.key !== ' ') return;
        event.preventDefault();
        this.load();
      }, { signal });
    }
    control.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (this.load()) event.preventDefault();
    }, { signal });
  }

  createPlayer() {
    if (this.dataset.host === 'shopify') {
      return this.querySelector('template[data-video-template]')?.content.querySelector('video')?.cloneNode(true) || null;
    }
    const host = HOSTS[this.dataset.host];
    const id = this.dataset.videoId || '';
    if (!host || !host.id.test(id)) return null;
    const frame = document.createElement('iframe');
    frame.src = host.src(encodeURIComponent(id));
    frame.title = this.dataset.title || '';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    return frame;
  }

  /* Returns true when a player was mounted, so a link fallback can navigate otherwise. */
  load() {
    if (this.dataset.state !== 'idle') return true;
    if (!this.slot) return false;
    const player = this.createPlayer();
    if (!player) return false;
    this.player = player;
    this.slot.append(player);
    this.dataset.state = 'playing';
    if (player.tagName === 'VIDEO') {
      player.play()?.catch(() => {});
    }
    player.focus({ preventScroll: true });
    return true;
  }

  /* Muted background loop. */
  setupBackground(signal) {
    this.video = this.querySelector('video.video-feature__video');
    if (!this.video) return;
    this.video.muted = true;
    this.video.addEventListener('playing', () => {
      this.setAttribute('data-started', '');
      this.sync();
    }, { signal });
    this.video.addEventListener('pause', () => this.sync(), { signal });
    REDUCED_MOTION.addEventListener('change', () => this.update(), { signal });
    if (this.toggle) {
      this.toggle.hidden = false;
      this.toggle.addEventListener('click', () => {
        if (this.video.paused) {
          this.userPaused = false;
          this.userStarted = true;
          this.playBackground();
        } else {
          this.userPaused = true;
          this.video.pause();
        }
      }, { signal });
    }
    this.sync();
  }

  update() {
    if (this.dataset.mode === 'background') {
      if (!this.video) return;
      /* Reduced motion never autoplays; the visitor can still start it with the toggle. */
      const allowed = !this.userPaused && (this.userStarted || !REDUCED_MOTION.matches);
      if (this.visible && allowed) this.playBackground();
      else if (!this.video.paused) this.video.pause();
      return;
    }
    if (!this.visible) this.pausePlayer();
  }

  playBackground() {
    if (!this.video.paused) return;
    this.video.play()?.catch(() => this.sync());
  }

  sync() {
    const paused = !this.video || this.video.paused;
    this.toggleAttribute('data-paused', paused);
    if (this.toggle) this.toggle.setAttribute('aria-label', paused ? this.toggle.dataset.labelPlay : this.toggle.dataset.labelPause);
  }

  pausePlayer() {
    const player = this.dataset.mode === 'background' ? this.video : this.player;
    if (!player) return;
    if (player.tagName === 'VIDEO') {
      if (!player.paused) player.pause();
      return;
    }
    const host = HOSTS[this.dataset.host];
    if (host && player.contentWindow) player.contentWindow.postMessage(host.pause, host.origin);
  }
}

if (!customElements.get('video-feature')) customElements.define('video-feature', VideoFeature);
