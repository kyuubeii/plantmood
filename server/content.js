/* Plantmood — registry of admin-editable site content.
   Defaults live HERE (in code), not in the database: the HTML ships the same
   defaults so pages are never blank and stay SEO-friendly, and the
   site_content table stores only values the admin has overridden.
   `hint` is shown to the admin so non-technical users pick suitable photos. */

export const CONTENT_REGISTRY = [
  // ---------------- global (header / footer, injected by site.js) ----------
  {
    key: 'announce.text', type: 'text', section: 'Global — every page',
    label: 'Announcement bar (thin green strip at the very top)',
    def: 'Plantmood — soil-free plants & curated greens · Kuala Lumpur · follow @plantmood.my',
  },
  {
    key: 'newsletter.heading', type: 'text', section: 'Global — every page',
    label: 'Newsletter heading (dark footer section)',
    def: 'Stay Updated',
  },
  {
    key: 'newsletter.body', type: 'text', section: 'Global — every page',
    label: 'Newsletter sub-line',
    def: 'Sign up with your email address to receive news, restocks and event invites.',
  },

  // ---------------- homepage · hero ----------------------------------------
  {
    key: 'home.hero.heading', type: 'text', section: 'Homepage — Hero',
    label: 'Hero headline',
    def: '‘Plant a little\npiece of your mood’',
  },
  {
    key: 'home.hero.button', type: 'text', section: 'Homepage — Hero',
    label: 'Hero button text',
    def: 'Shop Now',
  },
  {
    key: 'home.hero.slide1', type: 'image', section: 'Homepage — Hero',
    label: 'Hero photo 1 (carousel)', hint: 'Wide landscape photo, about 3:2 — keep the plants away from the left edge where the headline sits.',
    def: '/images/hero/plantmood-hero-carousel-01.jpg',
  },
  {
    key: 'home.hero.slide2', type: 'image', section: 'Homepage — Hero',
    label: 'Hero photo 2 (carousel)', hint: 'Wide landscape photo, about 3:2.',
    def: '/images/hero/plantmood-hero-carousel-02.jpg',
  },
  {
    key: 'home.hero.slide3', type: 'image', section: 'Homepage — Hero',
    label: 'Hero photo 3 (carousel)', hint: 'Wide landscape photo, about 3:2.',
    def: '/images/hero/plantmood-hero-carousel-03.jpg',
  },

  // ---------------- homepage · workshop banner -----------------------------
  {
    key: 'home.mission.heading', type: 'text', section: 'Homepage — Workshop banner',
    label: 'Banner heading (dark banner below featured products)',
    def: 'Succulent workshop + Plant Mood\nPlant. Create. Grow Together.',
  },
  {
    key: 'home.mission.button', type: 'text', section: 'Homepage — Workshop banner',
    label: 'Banner button text',
    def: 'Find out more',
  },
  {
    key: 'home.mission.image', type: 'image', section: 'Homepage — Workshop banner',
    label: 'Banner background photo', hint: 'Large photo, any orientation — the top third stays most visible.',
    def: '/images/event/event-01.jpg',
  },

  // ---------------- homepage · soil-free intro ------------------------------
  {
    key: 'home.soilfree.heading', type: 'text', section: 'Homepage — Soil-free intro',
    label: 'Section heading',
    def: 'The Soil-free Series',
  },
  {
    key: 'home.soilfree.body', type: 'text', section: 'Homepage — Soil-free intro',
    label: 'Section text',
    def: 'Real plants raised in a clean, soilless medium — no spills, no repotting, no fuss. Our signature series, arranged by hand in the studio.',
  },
  {
    key: 'home.soilfree.button', type: 'text', section: 'Homepage — Soil-free intro',
    label: 'Section button text',
    def: 'View the series',
  },

  // ---------------- homepage · feature cards -------------------------------
  // (These are the four wide image+text bands down the homepage, in page order.)
  {
    key: 'home.card1.heading', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 1 heading (Landscape / Events band)',
    def: 'Landscape styling that brings life to cafés, homes, offices, and more',
  },
  {
    key: 'home.card1.button', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 1 button text',
    def: 'Book now',
  },
  {
    key: 'home.card1.image', type: 'image', section: 'Homepage — Feature cards',
    label: 'Card 1 photo (Landscape / Events band)', hint: 'Landscape photo — the whole photo is shown, so any clear, in-focus photo works.',
    def: '/images/landscape/landscape-01.jpg',
  },
  {
    key: 'home.card2.heading', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 2 heading (Gifts band)',
    def: 'Thoughtfully curated plant gifts for every occasion',
  },
  {
    key: 'home.card2.button', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 2 button text',
    def: 'Shop now',
  },
  {
    key: 'home.card2.image', type: 'image', section: 'Homepage — Feature cards',
    label: 'Card 2 photo (Gifts band)', hint: 'Landscape photo — the whole photo is shown, so any clear, in-focus photo works.',
    def: '/images/gifts/gifts-03.jpg',
  },
  {
    key: 'home.card3.heading', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 3 heading (Floor plants band)',
    def: 'Statement plants for every space',
  },
  {
    key: 'home.card3.button', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 3 button text',
    def: 'Shop now',
  },
  {
    key: 'home.card3.image', type: 'image', section: 'Homepage — Feature cards',
    label: 'Card 3 photo (Floor plants band)', hint: 'Landscape photo — the whole photo is shown, so any clear, in-focus photo works.',
    def: '/images/floor/floor-05.jpg',
  },
  {
    key: 'home.card4.heading', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 4 heading (Plant care band)',
    def: 'Most plants need less from you than you think.',
  },
  {
    key: 'home.card4.button', type: 'text', section: 'Homepage — Feature cards',
    label: 'Card 4 button text',
    def: 'Learn More',
  },
  {
    key: 'home.card4.image', type: 'image', section: 'Homepage — Feature cards',
    label: 'Card 4 photo (Plant care band)', hint: 'Landscape photo — the whole photo is shown, so any clear, in-focus photo works.',
    def: '/images/tabletop/tabletop-06.jpg',
  },

  // ---------------- homepage · instagram grid ------------------------------
  {
    key: 'home.insta.1', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 1', hint: 'Shown as a square tile — square-ish photos look best.',
    def: '/images/event/event-04.jpg',
  },
  {
    key: 'home.insta.2', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 2', hint: 'Shown as a square tile.',
    def: '/images/gifts/gifts-01.jpg',
  },
  {
    key: 'home.insta.3', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 3', hint: 'Shown as a square tile.',
    def: '/images/airplants/airplants-03.jpg',
  },
  {
    key: 'home.insta.4', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 4', hint: 'Shown as a square tile.',
    def: '/images/bonsai/bonsai-02.jpg',
  },
  {
    key: 'home.insta.5', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 5', hint: 'Shown as a square tile.',
    def: '/images/hydroponic/hydroponic-01.jpg',
  },
  {
    key: 'home.insta.6', type: 'image', section: 'Homepage — Instagram grid',
    label: 'Instagram photo 6', hint: 'Shown as a square tile.',
    def: '/images/soilfree/soilfree-01.jpg',
  },

  // ---------------- other pages --------------------------------------------
  {
    key: 'about.intro', type: 'text', section: 'About page',
    label: 'Opening paragraph',
    def: 'Plantmood is a Kuala Lumpur plant studio built around one idea: every plant has a mood, and so does every home. Our job is to match the two — the right green for your light, your schedule, and the way you actually live.',
  },
  {
    key: 'about.image', type: 'image', section: 'About page',
    label: 'About photo (below the opening paragraph)', hint: 'Landscape or portrait — shown at its natural shape, never cropped.',
    def: '/images/landscape/landscape-01.jpg',
  },
  {
    key: 'events.banner.image', type: 'image', section: 'Events page',
    label: 'Events banner photo (top of page)', hint: 'Wide landscape photo — the middle of the photo stays most visible.',
    def: '/images/landscape/landscape-02.jpg',
  },
  {
    key: 'contact.image', type: 'image', section: 'Contact page',
    label: 'Contact photo (right column)', hint: 'Shown at its natural shape, never cropped.',
    def: '/images/event/event-02.jpg',
  },
];

export const contentByKey = new Map(CONTENT_REGISTRY.map(c => [c.key, c]));
