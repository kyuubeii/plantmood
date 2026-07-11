/* Plantmood — User Tutorial content.
   This is the single source of truth for the PDF: scripts/build-tutorial-pdf.js
   renders this data into docs/tutorial/source/tutorial.html, then prints that
   HTML to docs/tutorial/PlantMood_User_Tutorial.pdf with Playwright.

   Every fact in here was checked against the actual code in server/index.js,
   server/content.js and public/admin.html before writing — nothing here
   describes a feature that doesn't exist. Where the current version has a
   real limitation (e.g. product photos use a text path, not an upload
   button), it is stated plainly rather than glossed over.

   Screenshot filenames referenced below (`img:` fields) must exist in
   docs/tutorial/screenshots/ — the build script fails loudly if one is
   missing, so this list and the capture script stay in sync. */

export const GENERATED_ON = null; // stamped by the build script at run time

export const SECTIONS = [
  {
    id: 'introduction',
    number: 1,
    title: 'Introduction',
    blocks: [
      { type: 'subheading', text: 'What this website is for' },
      { type: 'p', text: 'PlantMood is your online plant shop. Customers can browse your plants, view details and prices, and place an order that is sent to you on WhatsApp for payment and delivery. Behind the scenes, you have a private Admin Panel where you manage your products, see incoming orders, and update the words and photos on your website — all without needing a developer for everyday changes.' },
      { type: 'subheading', text: 'Who should use this tutorial' },
      { type: 'p', text: 'This guide is written for the shop owner or staff member who will manage the PlantMood website day to day. No coding or technical background is needed. If you can use email and WhatsApp, you can use this admin panel.' },
      { type: 'callout', kind: 'tip', title: 'How to use this guide', text: 'You do not need to read this tutorial from start to finish. Use the section titles below to jump straight to what you need — for example, go directly to Section 6 if you just want to add a new plant.' },
    ],
  },

  {
    id: 'overview',
    number: 2,
    title: 'Website Overview',
    blocks: [
      { type: 'p', text: 'The PlantMood website has two sides:' },
      { type: 'list', items: [
        '**The public website** — this is what your customers see when they visit your site: the homepage, the shop, plant detail pages, and the checkout.',
        '**The Admin Panel** — a private area only you (and anyone you share the password with) can access, at the web address /admin. This is where you manage everything on the public website.',
      ] },
      { type: 'image', src: '01-homepage-hero.png', caption: 'The public homepage — the first thing a customer sees.' },
      { type: 'p', text: 'Every product, price, photo and block of text a customer sees on the public website is controlled from the Admin Panel. Think of the Admin Panel as the “backstage” of your shop, and the public website as the “shop floor.”' },
    ],
  },

  {
    id: 'customer-guide',
    number: 3,
    title: 'Customer Side Guide',
    blocks: [
      { type: 'p', text: 'This section explains what your customers experience, so you understand the journey they go through before an order reaches your WhatsApp.' },

      { type: 'subheading', text: 'How visitors browse the website' },
      { type: 'p', text: 'A visitor can browse plants from the homepage (scrolling down shows a “Featured Products” section, plus photo sections for different plant styles), or open “Shop” in the top menu to see the full catalogue. On the Shop page, they can tap a category button (for example “Air Plants” or “Bonsai”) to filter to just that type of plant.' },
      { type: 'row', items: [
        { type: 'image', src: '02-homepage-featured.png', caption: 'The “Featured Products” section on the homepage.' },
        { type: 'image', src: '03-shop-listing.png', caption: 'The Shop page, with category filter buttons.' },
      ] },

      { type: 'subheading', text: 'How visitors view a plant' },
      { type: 'p', text: 'Tapping any plant photo opens its detail page: a larger photo, the price, a description, a care tip, and an “Add to Cart” button. If a plant is sold out, the button is replaced with a “Sold out” label and customers cannot add it to their cart.' },
      { type: 'image', src: '04-product-detail.png', caption: 'A plant detail page, with description, care tip and Add to Cart.' },

      { type: 'subheading', text: 'How visitors order through WhatsApp' },
      { type: 'p', text: 'PlantMood does not take payment on the website itself. Instead, an order is confirmed with the customer directly on WhatsApp. The steps a customer follows are:' },
      { type: 'steps', items: [
        'Add one or more plants to their Cart.',
        'Open the Cart and tap “Checkout.”',
        'Fill in their name, phone, email and delivery address.',
        'Tap “Place Order & Send on WhatsApp.”',
        'The website saves their order and shows a confirmation page with a green “Send my order on WhatsApp” button, already filled in with their order number, items and total.',
        'The customer taps that button, which opens WhatsApp with the message ready — they just tap Send.',
      ] },
      { type: 'image', src: '05-cart.png', caption: 'The Cart page — plants added, with the Checkout button.' },
      { type: 'image', src: '06-checkout-form.png', caption: 'Checkout — the customer fills in delivery details, then places the order.' },
      { type: 'image', src: '07-order-whatsapp.png', caption: 'The order confirmation page, with the “Send my order on WhatsApp” button.' },
      { type: 'callout', kind: 'note', title: 'Where this WhatsApp message goes', text: 'The order message is sent to the WhatsApp number you set in Admin → Settings. Double-check this number is correct and that you (or your team) actively check it — see the Final Checklist in Section 10.' },
      { type: 'p', text: 'At the same time, the order is automatically recorded in your Admin Panel under the Orders tab — so even if a customer forgets to tap Send in WhatsApp, you still have a record of what they tried to order.' },
      { type: 'image', src: '16-admin-orders-tab.png', caption: 'The Orders tab — every order is recorded here automatically.' },
      { type: 'p', text: 'Customers can also reach you without placing an order, using the Contact page for general questions — for example about bulk orders or plant care.' },
      { type: 'image', src: '08-contact-page.png', caption: 'The Contact page, for general enquiries that are not tied to an order.' },
    ],
  },

  {
    id: 'admin-login',
    number: 4,
    title: 'Admin Login Guide',
    blocks: [
      { type: 'subheading', text: 'How to access the admin login page' },
      { type: 'p', text: 'Go to your website address and add /admin at the end — for example, yourwebsite.com/admin. You can also tap “Back to site” from inside the admin panel to return to the public website at any time.' },
      { type: 'image', src: '09-admin-login.png', caption: 'The admin login screen.' },
      { type: 'subheading', text: 'How to log in' },
      { type: 'steps', items: [
        'Open the /admin page.',
        'Type your admin password into the password box.',
        'Click “Log in.”',
      ] },
      { type: 'p', text: 'Once logged in, you stay logged in for several hours, even if you close and reopen your browser tab. A “Log out” button appears at the top right whenever you are logged in.' },
      { type: 'subheading', text: 'What to do if login fails' },
      { type: 'list', items: [
        'Check that Caps Lock is not on — passwords are case-sensitive.',
        'Check for extra spaces before or after the password.',
        'If you are sure the password is correct and it still fails, the password may have been changed by someone else on your team.',
      ] },
      { type: 'callout', kind: 'warning', title: 'There is no “Forgot password” link', text: 'This version of the admin panel does not have a self-service password reset. If you have lost the password and cannot log in at all, you will need your website developer to reset it for you. For this reason, keep your admin password somewhere safe (such as a password manager), and share it only with people who should be able to edit the website.' },
    ],
  },

  {
    id: 'admin-dashboard',
    number: 5,
    title: 'Admin Dashboard Guide',
    blocks: [
      { type: 'subheading', text: 'What the dashboard is for' },
      { type: 'p', text: 'After logging in, you land on the Products tab. Across the top of the admin panel are six tabs — click any tab to switch to that section. Your changes in one tab are saved independently of the others, so you can move between tabs freely.' },
      { type: 'image', src: '10-admin-products-tab.png', caption: 'The admin panel, showing the tab bar and the Products tab.' },
      { type: 'subheading', text: 'How to navigate the admin panel' },
      { type: 'table', headers: ['Tab', 'What it is for'], rows: [
        ['Products', 'Add, edit, delete plants, and manage prices, stock and photos (by path).'],
        ['Content', 'Edit the text and photos that appear on your homepage and other pages.'],
        ['Orders', 'See every order placed on the website and update its status.'],
        ['Subscribers', 'See everyone who signed up to your newsletter.'],
        ['Messages', 'See messages sent through the Contact page.'],
        ['Settings', 'Set your delivery fee, WhatsApp number, and change your admin password.'],
      ] },
    ],
  },

  {
    id: 'managing-products',
    number: 6,
    title: 'Managing Products / Plants',
    blocks: [
      { type: 'subheading', text: 'How to add a new plant/product' },
      { type: 'steps', items: [
        'Go to the Products tab.',
        'Click “+ New product.”',
        'Fill in the fields: Name, Species, Price, Stock, Category, Image path, Description, Care hint, and Alt text (a short description of the photo, used for accessibility).',
        'Tick “Featured on homepage” if you want this plant to appear in the Featured Products section of the homepage.',
        'Click “Create product.”',
      ] },
      { type: 'image', src: '11-admin-add-product.png', caption: 'The “New product” form.' },
      { type: 'subheading', text: 'How to edit a plant/product' },
      { type: 'steps', items: [
        'Go to the Products tab.',
        'Find the plant in the list and click “Edit” next to it.',
        'Change any field — name, description, price, stock, category and so on.',
        'Click “Save changes.”',
      ] },
      { type: 'image', src: '12-admin-edit-product.png', caption: 'Editing an existing plant — the same form, pre-filled.' },

      { type: 'subheading', text: 'How to set or replace a product photo' },
      { type: 'callout', kind: 'warning', title: 'Important: product photos use a “path,” not a file upload button', text: 'In the current version, the Products tab does not have an “upload from my computer” button. Instead, you type the location (called a “path”) of a photo that is already stored on the website, into the “Image path” field — for example /images/tabletop/tabletop-04.jpg. As you type, a preview appears so you can confirm it is the right photo before saving.' },
      { type: 'p', text: 'To use a brand-new photo (one that has never been uploaded to the website before) for a product, ask your website developer to add the photo file to the website and give you its path to paste in. This is different from the Content tab in Section 7, where you can upload photos yourself directly from your device.' },

      { type: 'subheading', text: 'How to delete old/replaced images' },
      { type: 'callout', kind: 'note', title: 'This feature is not available in the current version', text: 'There is no button to delete an individual product photo file. Changing a product’s “Image path” simply points that product to a different photo — it does not delete anything.' },

      { type: 'subheading', text: 'How to remove a plant/product' },
      { type: 'steps', items: [
        'Go to the Products tab.',
        'Click “Delete” next to the plant you want to remove.',
        'Confirm when asked — this cannot be undone.',
      ] },
    ],
  },

  {
    id: 'managing-content',
    number: 7,
    title: 'Managing Website Text and Images',
    blocks: [
      { type: 'p', text: 'The Content tab is where you edit the words and photos that make up your homepage and a few other pages — the hero banner, the feature cards, the About page photo, and more. Everything is grouped into sections, matching the order they appear on the actual page.' },
      { type: 'image', src: '13-admin-content-tab.png', caption: 'The Content tab, grouped by page section.' },

      { type: 'subheading', text: 'How to update a photo' },
      { type: 'steps', items: [
        'Find the photo you want to change (each one is labelled, e.g. “Hero photo 1”).',
        'Read the grey hint text under the label — it tells you the best shape/size of photo for that spot.',
        'Click “Choose File” and pick a JPG, PNG or WebP photo from your device (maximum 6 MB).',
        'Click “Upload new photo.”',
      ] },
      { type: 'subheading', text: 'How to edit text' },
      { type: 'steps', items: [
        'Find the text field you want to change.',
        'Click into the box and type your new text, replacing what is there.',
        'Click “Save.”',
      ] },
      { type: 'row', items: [
        { type: 'image', src: '14-admin-content-image-field.png', caption: 'A photo field — upload, reset, and status label.' },
        { type: 'image', src: '15-admin-content-text-field.png', caption: 'A text field — save, reset, and status label.' },
      ] },

      { type: 'subheading', text: 'How to save changes' },
      { type: 'p', text: 'Every field saves on its own — click “Save” for text, or “Upload new photo” for images. There is no separate “Publish” step: the moment you click Save or Upload, the change is live on your website.' },

      { type: 'subheading', text: '“Using default” vs. “Custom”' },
      { type: 'p', text: 'Next to each field you will see a small label: “Using default” means the website is showing its original built-in text or photo. “Custom” (shown in orange) means you have changed it. Click “Reset to default” at any time to undo your change and return to the original — this also works as the way to remove a photo you uploaded, since it puts the original photo back in its place.' },
      { type: 'callout', kind: 'tip', title: 'Old photos are cleaned up automatically', text: 'When you upload a new photo over an existing custom one, or click “Reset to default,” the website automatically deletes the old uploaded photo file for you. You do not need to manage or delete files yourself.' },

      { type: 'subheading', text: 'How to check the result on the live website' },
      { type: 'steps', items: [
        'Open a new browser tab.',
        'Go to your website’s normal address (not /admin) and visit the page you changed.',
        'If you don’t see your change immediately, refresh the page (see Troubleshooting in Section 8).',
      ] },
    ],
  },

  {
    id: 'troubleshooting',
    number: 8,
    title: 'Common Mistakes and Troubleshooting',
    blocks: [
      { type: 'table', headers: ['Problem', 'Likely cause', 'What to do'], rows: [
        ['Image not changing', 'Your browser has an old copy of the page saved (“cached”).', 'Hard-refresh the page: Cmd+Shift+R on Mac, or Ctrl+F5 on Windows.'],
        ['Image not changing (product)', 'The “Image path” was typed incorrectly.', 'Re-open the product in Edit mode and check the preview image appears — if it looks blank/broken, the path is wrong.'],
        ['Wrong text displayed', 'The wrong field was edited, or the text was edited on a different tab/section than expected.', 'Go back to the Content tab and check you are editing the field under the correct section heading.'],
        ['Login failed', 'Wrong password, Caps Lock on, or extra spaces typed.', 'Retype carefully. If it still fails, see Section 4 — there is no self-service password reset.'],
        ['Changes not showing immediately', 'You typed a change but did not click Save/Upload/Create.', 'Go back and confirm you clicked the button — a small confirmation message appears briefly at the bottom of the screen when a save works.'],
        ['Website layout looks odd after uploading a photo', 'The photo’s shape (landscape vs. square vs. portrait) does not match what that spot expects.', 'Re-read the grey hint text under that photo field, and upload a photo closer to the suggested shape.'],
      ] },
    ],
  },

  {
    id: 'best-practices',
    number: 9,
    title: 'Best Practices',
    blocks: [
      { type: 'list', items: [
        '**Recommended image size** — keep uploaded photos under 6 MB (the website will reject anything larger). For faster loading, aim well below 1 MB per photo where possible, and always check the shape hint shown under each photo field.',
        '**Use clear product names** — write names the way a customer would search for them, e.g. “Monstera Deliciosa — Medium” rather than an internal code.',
        '**Keep descriptions short and readable** — two to three short sentences work better than a long paragraph. Mention the one or two things that matter most (light needs, size, or what makes it special).',
        '**Check the mobile view after updates** — most customers browse on their phone. After changing a photo or text, open the website on your own phone (or resize your browser window narrower) to make sure it still looks good.',
        '**You do not need to “clean up” unused photos** — as explained in Section 7, the website automatically removes an old uploaded Content photo when you replace or reset it.',
      ] },
      { type: 'image', src: '18-mobile-homepage.png', caption: 'The homepage on a phone-sized screen.' },
    ],
  },

  {
    id: 'checklist',
    number: 10,
    title: 'Final Checklist',
    blocks: [
      { type: 'p', text: 'Before you consider a website update finished, run through this quick list:' },
      { type: 'checklist', items: [
        'I opened the actual website (not just the admin panel) and confirmed the change looks right.',
        'I checked how the change looks on a phone-sized screen.',
        'For a product change: the price and stock number are correct.',
        'For a product change: the photo shown is the correct plant.',
        'For a text/photo change: the “Custom” label is showing (confirming it saved).',
        'My WhatsApp number in Admin → Settings is correct and I am actively checking that number for new orders.',
        'My admin password is only shared with people who should be editing the website.',
      ] },
      { type: 'image', src: '17-admin-settings-tab.png', caption: 'Settings — delivery fee, WhatsApp number and admin password.' },
      { type: 'p', text: 'That’s it — you now know everything needed to run your PlantMood website day to day. If you ever hit something this guide doesn’t cover, that likely means it needs a developer’s help rather than something in the admin panel.' },
    ],
  },
];

/* Extra reference screenshots woven into the sections above, kept here as a
   flat list so the capture script and this file are easy to cross-check. */
export const ALL_SCREENSHOTS = [
  '01-homepage-hero.png',
  '02-homepage-featured.png',
  '03-shop-listing.png',
  '04-product-detail.png',
  '05-cart.png',
  '06-checkout-form.png',
  '07-order-whatsapp.png',
  '08-contact-page.png',
  '09-admin-login.png',
  '10-admin-products-tab.png',
  '11-admin-add-product.png',
  '12-admin-edit-product.png',
  '13-admin-content-tab.png',
  '14-admin-content-image-field.png',
  '15-admin-content-text-field.png',
  '16-admin-orders-tab.png',
  '17-admin-settings-tab.png',
  '18-mobile-homepage.png',
];
