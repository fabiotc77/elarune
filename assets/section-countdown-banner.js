/* Elarune countdown banner. The server renders the starting values; this keeps them current. */
const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const pad = (value) => String(value).padStart(2, '0');

/* Strictly parses YYYY-MM-DD, HH:MM and ±HH:MM. Returns NaN when anything is invalid. */
const parseEnd = (date = '', time = '', offset = '') => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim() || '00:00');
  const o = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!d || !t || !o) return NaN;
  const [year, month, day, hour, minute] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return NaN;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return NaN;
  const offsetMinutes = (o[1] === '-' ? -1 : 1) * (+o[2] * 60 + +o[3]);
  return Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * MINUTE;
};

class CountdownBanner extends HTMLElement {
  connectedCallback() {
    this.abort?.abort();
    this.abort = new AbortController();
    this.editor = Boolean(window.Shopify?.designMode);
    this.units = Object.fromEntries([...this.querySelectorAll('[data-unit]')].map((el) => [el.dataset.unit, el]));
    this.timer = this.querySelector('[data-timer]');
    this.ended = this.querySelector('[data-ended]');
    this.live = this.querySelector('[data-live]');
    this.deadlineRow = this.querySelector('[data-deadline-row]');
    this.end = parseEnd(this.dataset.date, this.dataset.time, this.dataset.offset);

    if (Number.isNaN(this.end)) {
      const note = this.querySelector('[data-invalid-note]');
      if (note) note.hidden = false;
      return;
    }

    this.localiseDeadline();
    this.expiredOnLoad = Date.now() >= this.end;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(this.timeout);
      else this.tick();
    }, { signal: this.abort.signal });
    this.tick();
  }

  disconnectedCallback() {
    clearTimeout(this.timeout);
    this.abort?.abort();
  }

  /* Show the deadline in the visitor's language and time zone. */
  localiseDeadline() {
    const time = this.querySelector('[data-deadline]');
    if (!time) return;
    try {
      time.textContent = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
        dateStyle: 'long',
        timeStyle: 'short'
      }).format(new Date(this.end));
    } catch (error) {
      /* Keep the server-rendered deadline. */
    }
  }

  write(key, value) {
    const el = this.units[key];
    if (el && el.textContent !== value) el.textContent = value;
  }

  tick() {
    clearTimeout(this.timeout);
    const remaining = this.end - Date.now();
    if (remaining <= 0) {
      this.expire();
      return;
    }
    const showSeconds = Boolean(this.units.seconds);
    /* Without seconds, round up so the display never reads zero while time remains. */
    const total = showSeconds ? Math.floor(remaining / 1000) * 1000 : Math.ceil(remaining / MINUTE) * MINUTE;
    this.write('days', pad(Math.floor(total / DAY)));
    this.write('hours', pad(Math.floor((total % DAY) / HOUR)));
    this.write('minutes', pad(Math.floor((total % HOUR) / MINUTE)));
    this.write('seconds', pad(Math.floor((total % MINUTE) / 1000)));
    this.dataset.state = 'running';
    const delay = showSeconds ? remaining % 1000 : remaining % MINUTE;
    this.timeout = setTimeout(() => this.tick(), delay + 30);
  }

  expire() {
    ['days', 'hours', 'minutes', 'seconds'].forEach((key) => this.write(key, '00'));
    if (this.handledExpiry) return;
    this.handledExpiry = true;
    this.dataset.state = 'ended';
    if (this.deadlineRow) this.deadlineRow.hidden = true;

    if (this.dataset.expiry === 'hide' && !this.editor) {
      (this.closest('.shopify-section') || this).hidden = true;
      return;
    }
    if (this.dataset.expiry === 'message') {
      if (this.timer) this.timer.hidden = true;
      if (this.ended) this.ended.hidden = false;
    }
    /* Announce once, only when the deadline passes while the visitor is on the page. */
    if (!this.expiredOnLoad && this.live && this.ended) this.live.textContent = this.ended.textContent;
  }
}

if (!customElements.get('countdown-banner')) customElements.define('countdown-banner', CountdownBanner);
