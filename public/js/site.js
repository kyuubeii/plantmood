/* Plantmood — shared frontend: header/footer, cart state, helpers */

const PM = {
  money(n) {
    return 'RM ' + Number(n).toFixed(2);
  },

  cart: {
    key: 'pm_cart',
    read() {
      try {
        const v = JSON.parse(localStorage.getItem(this.key));
        return Array.isArray(v) ? v.filter(i => i && Number.isFinite(i.id) && Number.isFinite(i.qty)) : [];
      } catch { return []; }
    },
    write(items) {
      localStorage.setItem(this.key, JSON.stringify(items));
      PM.updateCartBadge();
    },
    add(id, qty = 1) {
      const items = this.read();
      const line = items.find(i => i.id === id);
      if (line) line.qty = Math.min(99, line.qty + qty);
      else items.push({ id, qty });
      this.write(items);
    },
    setQty(id, qty) {
      let items = this.read();
      if (qty <= 0) items = items.filter(i => i.id !== id);
      else items.forEach(i => { if (i.id === id) i.qty = Math.min(99, qty); });
      this.write(items);
    },
    remove(id) {
      this.write(this.read().filter(i => i.id !== id));
    },
    clear() { this.write([]); },
    count() { return this.read().reduce((s, i) => s + i.qty, 0); },
  },

  updateCartBadge() {
    document.querySelectorAll('.cart-count').forEach(el => {
      el.textContent = PM.cart.count();
    });
  },

  toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  async api(path, opts = {}) {
    const { headers, body, ...rest } = opts;
    const res = await fetch(path, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};

/* ---------------- header / footer injection ---------------- */

const NAV_HTML = `
<a href="/shop" class="announcement-bar">Plantmood — soil-free plants &amp; curated greens · Kuala Lumpur · follow @plantmood.my</a>
<header class="site-header">
  <div class="site-header__inner">
    <button class="burger" aria-label="Menu" onclick="document.querySelector('.mobile-menu').classList.toggle('open')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <nav class="site-nav" aria-label="Main">
      <div class="nav-folder">
        <button type="button">Potted Plants ▾</button>
        <div class="nav-folder__menu">
          <a href="/shop/tabletop">Tabletop Potted</a>
          <a href="/shop/floor">Floor-size Potted</a>
        </div>
      </div>
      <div class="nav-folder">
        <button type="button">Soil-free &amp; Hydro ▾</button>
        <div class="nav-folder__menu">
          <a href="/shop/soilfree">Soil-free Series</a>
          <a href="/shop/hydroponic">Hydroponic Series</a>
        </div>
      </div>
      <a href="/shop/airplants">Air Plants</a>
      <a href="/shop/bonsai">Bonsai</a>
      <a href="/shop/gifts">Gifts</a>
    </nav>
    <a class="site-logo" href="/" aria-label="Plantmood home">
      <img src="/images/brand/brand-01.jpg" alt="plant mood logo">
    </a>
    <div class="header-actions">
      <a href="https://www.instagram.com/plantmood.my/" target="_blank" rel="noopener" aria-label="Instagram">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none"/></svg>
      </a>
      <a href="/cart" class="cart-link" aria-label="Cart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 7h12l1.2 12.2a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1L6 7Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>
        <span class="cart-count">0</span>
      </a>
    </div>
  </div>
  <div class="mobile-menu">
    <a href="/shop">Shop All</a>
    <a href="/shop/tabletop" class="sub">Tabletop Potted</a>
    <a href="/shop/floor" class="sub">Floor-size Potted</a>
    <a href="/shop/soilfree" class="sub">Soil-free Series</a>
    <a href="/shop/hydroponic" class="sub">Hydroponic Series</a>
    <a href="/shop/airplants" class="sub">Air Plants</a>
    <a href="/shop/bonsai" class="sub">Bonsai</a>
    <a href="/shop/gifts" class="sub">Gift Series</a>
    <a href="/events">Events &amp; Workshops</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </div>
</header>`;

const FOOTER_HTML = `
<section class="section theme-black newsletter on-dark">
  <div class="section__inner">
    <h2>Stay Updated</h2>
    <p class="muted">Sign up with your email address to receive news, restocks and event invites.</p>
    <form id="newsletter-form">
      <input type="email" name="email" placeholder="Email Address" required aria-label="Email address">
      <button class="btn" type="submit">Sign Up</button>
    </form>
    <p class="form-msg" id="newsletter-msg"></p>

    <div class="footer-cols">
      <div>
        <h3>Info</h3>
        <a href="/about">About</a>
        <a href="/plant-care">Plant Care</a>
        <a href="/events">Events &amp; Workshops</a>
        <a href="/contact">Contact</a>
      </div>
      <div>
        <h3>Follow</h3>
        <a href="https://www.facebook.com/plantmood.my" target="_blank" rel="noopener">Facebook</a>
        <a href="https://www.instagram.com/plantmood.my/" target="_blank" rel="noopener">Instagram</a>
      </div>
      <div>
        <h3>Contact</h3>
        <p>Plantmood Studio</p>
        <p>Kuala Lumpur, Malaysia</p>
        <a href="mailto:hello@plantmood.my">hello@plantmood.my</a>
      </div>
    </div>

    <div class="footer-base">
      <a href="/faq">FAQs and Delivery</a>
      <a href="/privacy">Privacy Policy</a>
      <span>Plantmood © ${new Date().getFullYear()}</span>
    </div>
  </div>
</section>`;

document.addEventListener('DOMContentLoaded', () => {
  const headerMount = document.getElementById('site-header');
  if (headerMount) headerMount.innerHTML = NAV_HTML;

  const footerMount = document.getElementById('site-footer');
  if (footerMount) footerMount.innerHTML = FOOTER_HTML;

  PM.updateCartBadge();

  const nf = document.getElementById('newsletter-form');
  if (nf) {
    nf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('newsletter-msg');
      try {
        await PM.api('/api/subscribe', { method: 'POST', body: { email: nf.email.value } });
        msg.textContent = 'Thank you! You are on the list.';
        msg.className = 'form-msg ok';
        nf.reset();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-msg error';
      }
    });
  }
});

window.PM = PM;
