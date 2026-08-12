# Keychain Factory — Web Edition

A browser-based version of `CustomNameKeychainGenerator_100Fonts.scad`. No
backend, no build step — every visitor's browser does the modeling and
STL export locally. Free to host on GitHub Pages (optionally fronted by
Cloudflare).

**Live tool:** open `index.html` (via GitHub Pages once deployed).

## How it works

This does **not** run OpenSCAD in the browser. Instead it re-implements the
same geometry pipeline your `.scad` file uses, natively in JS, which turned
out to be the more reliable and much faster path for 100 custom Google
Fonts + a live rotating preview:

| SCAD concept | Web equivalent |
|---|---|
| `text()` + font system | [`opentype.js`](https://github.com/opentypejs/opentype.js) parses the actual Google Font file and returns real letterform outlines |
| `offset(r=...)` | [`clipper-lib`](https://github.com/junmer/clipper-lib) — a JS port of the *same* Clipper polygon-offset library OpenSCAD's `offset()` uses internally |
| `union()` / `difference()` (2D) | `clipper-lib` boolean ops |
| `linear_extrude()` | `THREE.ExtrudeGeometry` |
| STL export | `THREE.STLExporter`, run client-side, downloaded as a `Blob` |
| Live rotate/zoom preview | `three.js` + `OrbitControls`, WebGL |

Fonts are fetched on demand straight from Google Fonts as WOFF2 (using the
`text=` parameter so each visitor only downloads the handful of glyphs
they actually typed — fast, and respects Google's font licensing/hosting),
decompressed to TTF in-browser (`woff2-encoder`), and parsed by
`opentype.js`. Nothing is bundled or pre-downloaded, so the whole site is
just a handful of small files.

All three libraries (three.js, opentype.js, clipper-lib) are MIT/BSL
licensed and loaded from jsDelivr — no npm install, no bundler, plain
`<script>`/`<script type="module">` tags. That's what makes plain GitHub
Pages hosting work.

## File structure

```
index.html        the whole UI (controls + <canvas> viewer)
css/style.css      styling
js/fonts.js        the 300-font table (100 ported from the .scad, +200 more picked for print-friendliness) + the 300-icon library + Google Fonts URL builder
js/colors.js       the shared 28-color palette used by plate color, text color, and Paint Mode
js/geometry.js     the actual geometry pipeline (text/icon→per-letter outlines→offset→extrude)
js/license.js      Gumroad license-key gate (see "Free tier + paid unlock" below)
js/main.js         UI wiring, three.js scene, STL/3MF export
assets/            logo files used in the header + favicon
legal/             the actual Personal/Commercial license PDFs, linked from the export modal
```

## Deploying to GitHub Pages (free)

1. Copy these files into the root of `picasso3dprints/keychain-generator`
   (or a `/docs` folder if you prefer — just update the Pages source to
   match).
2. Commit and push to `main`.
3. In the repo: **Settings → Pages → Source → Deploy from a branch →
   `main` / `(root)`** → Save.
4. GitHub gives you a URL like
   `https://picasso3dprints.github.io/keychain-generator/` within a
   minute or two.

## Adding Cloudflare in front (optional, still free)

This is purely for a custom domain / extra caching+DDoS protection — the
site works fine on the raw `github.io` URL without it.

1. Add your domain to Cloudflare (free plan).
2. In your DNS, add a `CNAME` record pointing your subdomain (e.g.
   `make.yourdomain.com`) to `picasso3dprints.github.io`, proxied
   (orange cloud) through Cloudflare.
3. In GitHub: **Settings → Pages → Custom domain** → enter that
   subdomain → Save (GitHub will verify + issue an HTTPS cert).
4. In Cloudflare, set SSL/TLS mode to **Full**.

## Testing before your MakerWorld launch

I built and syntax-checked all the JS in this response, but I don't have
live internet access in this environment, so I could not click-test the
actual page in a browser. Before you link this from a crowdfunding page,
please do a real pass:

- [ ] Open `index.html` locally (`python3 -m http.server` in this folder,
      then visit `localhost:8000`) or via GitHub Pages, and confirm the
      viewer loads and a keychain renders.
- [ ] Try a handful of fonts from different parts of the 300-entry list
      (script, display, monospace, condensed, and several from the
      newer 200) — font shapes vary the most in edge cases, and this
      also catches any font name Google Fonts no longer recognizes.
- [ ] Try 1 and 2 lines of text, both styles (raised/engraved), and
      boldness at 0 and near max.
- [ ] Confirm **Download STL** produces a file that opens cleanly in your
      slicer and looks right (no inverted normals / flipped text).
- [ ] Test on mobile Safari/Chrome — WebGL performance and touch-drag
      orbit controls are usually fine but worth a check.
- [ ] Pick an icon and toggle it between left/right of the text, try it
      with 1-2 lines of text, and confirm no stray box/rectangle shows up
      near the icon. Also confirm the keyring hole sits at the far left
      of the whole shape (past the icon, when the icon is on the left)
      and doesn't land in the gap between icon and text.
- [ ] Switch to Icon Keychain type, confirm the text fieldset disappears
      and the icon fieldset appears, try a few different icons and icon
      sizes, and confirm the keyring hole sits centered directly above
      the icon and never visibly cuts into the icon's solid shape, even
      at the smallest ring-thickness setting.
- [ ] Click the model in the viewer and confirm the dimensions overlay
      shows sensible numbers.
- [ ] Click Export — confirm a centered popup appears (not a small
      dropdown) with STL and 3MF buttons. While unlicensed/free-tier,
      confirm it shows a note linking to the Personal License
      Agreement; unlock a Commercial license and confirm the note
      switches to link the Commercial one instead, without needing a
      page reload. Confirm both PDF links actually open the right
      document.
- [ ] In dev tools, use the Network tab's "Offline" throttling (or
      actually disconnect Wi-Fi) and reload the page — confirm the
      offline banner appears at the top. Try changing a font/icon while
      offline and confirm the status line gives a clear "you're
      offline" message rather than a raw fetch error. If you have a
      saved license, confirm it shows "Offline — couldn't verify saved
      license" rather than silently reporting "Free tier."
- [ ] Unlock with a real Personal or Commercial key, confirm the
      top-right button now says "Change license" instead of
      disappearing. Open it, confirm it shows the current tier and a
      "Remove license & return to free tier" button. Click Remove —
      confirm it goes back to "Free tier" / locked fonts and icons
      immediately. Unlock again with the other tier's key and confirm
      switching works cleanly.
- [ ] Try each of the 9 keyring position presets on a Text Keychain and
      on an Icon Keychain — confirm the ring snaps to the named
      position and stays fused to the plate (no floating disconnected
      ring) in every case, including with an icon attached on both the
      left and right side of text.
- [ ] Attach an icon to text, then try Icon offset X (confirm it nudges
      the icon further from the text without breaking the connection)
      and Icon plate margin set very different from the main Outline
      margin (confirm the plate around the icon and around the text
      visibly differ in width, while still forming one connected
      plate). Test with the icon on both Left and Right — confirm the
      keyring still fuses cleanly into the plate either way.
- [ ] Type text into both lines with very different lengths (e.g. a long
      line 1 and a short line 2) — confirm the shorter line is
      horizontally centered under the longer one, not left-aligned.
      Confirm the two lines look visually connected (no gap in the
      flat plate) at the new 100% default spacing, and — this is the
      important part — confirm there's no separate raised or engraved
      box floating between the lines; the plate should just look like
      one continuous connected piece. Try Paint Mode and confirm the
      bridge isn't listed as a separately-paintable letter.
- [ ] Default settings, Text Keychain: confirm the keyring hole sits
      flush against the left edge of the text with no visible gap.
      Nudge Offset X positive/negative and confirm it moves the ring
      further in/out from that touching position rather than starting
      from a gap.
- [ ] Set 3 different fonts and 3 different sizes across the three
      lines and confirm each line actually renders in its own font at
      its own size, the lines stay readably stacked/centered as a
      group, and Paint Mode still lets you color individual letters
      correctly across lines with different fonts.
- [ ] Change a bunch of settings (font, colors, icon, keyring offsets,
      Paint Mode letters, switch to Icon Keychain type), then click
      **Reset to Defaults** — confirm everything visually snaps back
      (including custom pickers like the color swatches and icon
      selections, not just the sliders) and the 3D model matches a
      fresh page load.
- [ ] Confirm both icon pickers show only 3 rows initially with a
      "Show More ▾" link below; click it and confirm the rest of the
      300 icons appear and the button switches to "Show Less ▴";
      click again and confirm it collapses back to 3 rows. Switch to
      Icon Keychain type and confirm its picker is also collapsed to 3
      rows correctly (not collapsed to zero height).
- [ ] Click the Plate color and Text color swatch buttons — confirm the
      panel opens with a colored square next to every option, and that
      picking one updates both the swatch preview and the 3D model.
- [ ] Turn on Paint Mode with Raised style — confirm a swatch button
      appears for every letter (and the icon, if attached), that
      clicking one lets you give that single letter its own color
      distinct from the rest, and that a "Reset to default" option
      appears once a letter has been painted. Switch to Engraved and
      confirm the Paint Mode section disappears. Export as 3MF and
      confirm the per-letter colors carry into the file.
- [ ] While unlicensed: confirm the font dropdown shows only Anton,
      Baloo 2 Bold, and Bree Serif as selectable (the rest show a 🔒
      prefix and can't be picked), and confirm only Heart/Star/Paw/
      Anchor/Fire are clickable in both icon pickers (the rest look
      dimmed with a lock badge and clicking one opens the unlock modal
      instead of selecting it). Confirm Export still works fine using
      only free content.
- [ ] Click "Unlock all fonts & icons" — confirm the modal shows both
      Personal and Commercial buy links working. Buy (or test-buy) one
      of each tier, confirm each unlocks with the correct label
      ("Licensed (Personal) ✓" / "Licensed (Commercial) ✓"), confirm
      every font and icon becomes selectable (lock hints disappear,
      🔒 prefixes go away), and confirm Export still works. Reload the
      page after each and confirm it stays unlocked without re-entering
      the key.

If a particular font ever fails to load (Google occasionally renames a
family), the status line will show an error naming that font — that's
the one thing to watch for across all 100.

## What's new since the first version

- **Smoother curves** — offset/round-join arc tolerance and bezier
  flattening resolution were both increased, so letterforms and offset
  outlines render with far less facetting.
- **Icons** — a 300-icon picker (`js/fonts.js`'s `ICON_PALETTE`, expanded
  from an initial 100), one per keychain, placed automatically to the
  left or right of the whole text block (your choice) rather than typed
  inline. Rendered through Google's monochrome **Noto Emoji** vector
  font (not the color bitmap one) through the same outline pipeline as
  the text, so it extrudes/prints as a solid shape like any letter. An
  earlier version let you type emoji directly into the text fields;
  that caused a stray box to render after some icons (a leftover
  "variation selector" character the font has no glyph for) and made
  multi-icon placement messy, so it was replaced with this single-icon,
  position-controlled approach — the variation-selector stripping fix
  is also what made the icon font usable in the first place.
- **New look** — dark grey + green theme, a print-bed grid under the
  model, and clicking the keychain shows its exact printed dimensions
  (width × depth × height) in the top-left overlay.

Plate shapes beyond outline/rectangle were tried and pulled back out —
they weren't rendering correctly, so `js/shapes.js` was removed and
the plate-shape dropdown went back to just Outline and Rectangle.
Rectangle has since been removed too (the Plate Shape dropdown is
gone entirely) — the plate is always the "hugs the letters/icon"
outline shape now, matching the original `.scad` file's core design.

The accounts + paid-subscription layer (Firebase Auth, Firestore, and
a Cloudflare Worker talking to Stripe) that was built at one point has
been removed again — **Download STL** is free and unrestricted for
everyone, no sign-in required. That auth/billing system can be added
back later once the rest of the site is finished and you're ready to
turn on payments; it's a self-contained addition that doesn't require
restructuring anything else here.

The Export button moved to the top-right of the header and is now a
dropdown offering both **STL** and **3MF**. 3MF export uses a
dedicated `three-3mf-exporter` library (loaded only when picked) and
carries the plate/text colors into the file, unlike STL.

An additional 200 fonts were added on top of the original 100 (300
total), picked for print-friendly bold/blocky/rounded/geometric
letterforms rather than fine hairline scripts, which tend to snap or
vanish at small print scale. A handful use the `:style=Bold` descriptor
suffix (same mechanism the original list already used for a few
entries) to force a heavier weight on families whose default is thin.
These 200 were picked from Anthropic's general knowledge of the Google
Fonts catalog rather than individually verified one by one — if a
specific name has since been renamed or removed from Google Fonts,
that one entry will show a clear error in the status line rather than
break the app (the font-loading code already handles that gracefully).
Worth a spot-check across a few dozen entries before launch.

## Free tier + paid unlock (Gumroad license key, two tiers)

Keychain Factory works fully for free, forever, no sign-in and no
Gumroad setup required to use it — it ships with **3 starter fonts**
(Anton, Baloo 2 Bold, Bree Serif — always the first three in the font
dropdown) and **5 starter icons** (Heart, Star, Paw, Anchor, Fire —
always first in both icon pickers), and **export (STL/3MF) works with
those for free**, no purchase needed.

The other 297 fonts and 295 icons are shown but shaded dark and
disabled — you can see them, you just can't select them without a
license. A one-time purchase unlocks all of them, offered as two
tiers: **Personal Use** and **Commercial Use** (the right to sell
physical items you print). Click the **"Unlock all fonts & icons"**
button (or click any locked icon) to open a modal with both options to
buy on Gumroad, plus a single field to enter whichever license key
you're emailed after purchase — the app checks the key against both
products to figure out which tier it belongs to. No accounts, no
database (much simpler than the Firebase/Stripe/Cloudflare Worker
system an earlier version of this project used, which has been fully
removed).

**Changing or removing a license:** once licensed, the top-right
button changes from "Unlock all fonts & icons" to **"Change license"**
— it stays clickable rather than disappearing. Opening it while
licensed shows which tier is currently active, a field to enter a
*different* key to switch to (e.g. upgrading Personal → Commercial),
and a **"Remove license & return to free tier"** button that clears
the stored key and drops back to the free tier immediately, no
confirmation dialog (it's non-destructive — the key still works if
they enter it again, same as it did the first time).

Both Gumroad products are live and connected (`TIERS.personal` and
`TIERS.commercial` in `js/license.js`), tested end-to-end with real
purchases, and the local-testing bypass key that used to live here has
been removed — every unlock now goes through Gumroad's real
verification API. The one-time setup walkthrough (`LICENSE_SETUP.md`)
has been removed now that setup is actually done — if you ever need to
redo this from scratch (new Gumroad products, a different platform),
the short version is: create a product with per-sale license keys
enabled, grab its Product ID + purchase URL from the Share tab, and
drop both into `TIERS.personal` / `TIERS.commercial` in `js/license.js`.

Note this is a different model from an earlier version of this app,
which gated *export itself* regardless of what you'd designed with.
Now export always works — the paywall is which fonts/icons you're
*allowed to design with* in the first place, not whether you can get
the file out afterward.

## Legal: license agreements linked at export

`legal/personal-license.pdf` and `legal/commercial-license.pdf` are
the actual signed-off license agreements (Licensor: Picasso 3D,
governed by the laws of Canada) — these are the exact final files
provided, not regenerated, so don't touch them without meaning to.

**Export is now a popup, not a dropdown.** Clicking **Export** opens a
modal with two big buttons — **STL** and **3MF** — instead of the old
small dropdown menu. Underneath the two buttons, the modal shows a
one-line notice with a link to whichever license agreement actually
applies to the person clicking: **Personal License Agreement** for
free-tier and Personal-licensed visitors, **Commercial License
Agreement** for anyone with an active Commercial license — determined
live from `window.entitlement.tier`, so it's always showing the right
one without needing a page reload after unlocking.

## Support contact

The footer has a support email (`picasso3dprints@gmail.com`) as a
`mailto:` link with the subject line **"Keychain Factory Support
Request"** pre-filled, since that's a requirement for it to get a
response — clicking it opens the visitor's email client with that
subject already set, though they could still edit it away, so the
footer text also spells out the requirement in words next to the link.

## Offline / dependency error handling

This app leans on the network for a lot — Google Fonts per character
typed, the Noto Emoji font for icons, three-3mf-exporter loaded on
demand for 3MF export, Gumroad's API for license checks, and a couple
of CDN-hosted libraries (three.js, opentype.js, clipper-lib,
woff2-encoder) it can't work without at all. None of that was handled
gracefully before — a dropped connection mid-session, or one CDN
having a bad day, just produced a raw "Failed to fetch" error or a
silent break with no visible explanation. A few things now catch that:

- **A banner appears automatically** (`#offlineBanner`) whenever the
  browser goes offline (via the standard `online`/`offline` events),
  and a separate one (`#depsErrorBanner`) if a required library failed
  to load at all — both go away on their own once things recover.
- **Every network-dependent error message was rewritten** to say what
  actually happened and what to do about it — "you're offline, check
  your connection" vs. "the server returned an error" vs. a genuine
  bug — instead of a generic "Error: Failed to fetch" that requires
  opening dev tools to understand.
- **A saved license that can't be re-verified because you're offline
  no longer silently reports "Free tier."** It says "Offline — couldn't
  verify saved license" instead, since those are very different
  situations for a paying customer to see, and the saved key is never
  deleted just because a single check failed to reach the network.

None of this requires any setup — it's automatic. Worth knowing if
you're troubleshooting a support report: ask what the status line or
banner actually said, since it should now point at the real cause
most of the time.

## Keyring position presets

A 3×3 grid of buttons in the Keyring hole section lets you snap the
keyring to a named position — Top, Bottom, Left, Right, or any of the
four corners — instead of only ever fine-tuning it with the Offset X/Y
sliders around one fixed anchor point. The center button is **Auto**
(the default, selected out of the box) — it's exactly the original
behavior: far-left for Text Keychain, top-center for Icon Keychain.
Picking an explicit preset works the same way for either keychain
type now, so e.g. you could put the keyring on the right side of a
Text Keychain, or on the left of an Icon Keychain — that wasn't
possible before. The Offset X/Y sliders still layer on top of
whichever preset (or Auto) is active, for fine adjustment.

This also had to make the icon/text separate-plate-margin logic (see
below) smarter — it used to just assume the keyring was always on the
text's left side, which stops being true once you can put it anywhere.
It now measures which side (text or icon) the keyring actually ended
up closest to and groups it with that one, whatever preset is active.

## Independent icon position + plate margin

When an icon is attached to text (Text Keychain type), two more
controls appear under the icon picker:

- **Icon offset X** nudges the icon further left/right from its
  auto-computed snug position next to the text — same "auto-position,
  then let the slider fine-tune it" pattern as the keyring offsets.
- **Icon plate margin** controls how much plate extends around the
  icon specifically, independent of the **Outline margin** slider
  (which now governs the text side). Want a tight plate hugging the
  icon but a roomier one around the text, or vice versa? This is what
  makes that possible — previously one shared margin applied to
  everything at once.

Under the hood this meant offsetting the text side and the icon side
separately and unioning the two results together, rather than one
offset over the whole combined shape. The keyring is grouped into
whichever side (text or icon) it's actually adjacent to — that depends
on whether the icon is positioned left or right of the text — so it
still fuses cleanly into the plate no matter which side it ends up on.

## Multi-line layout: centered lines + auto-bridging

Two changes to how multiple lines relate to each other:

- **Lines are centered on a shared vertical axis**, not left-aligned.
  Each line used to start at the same left edge (x=0) regardless of its
  own width; now each line is independently centered horizontally after
  layout, so a short line 2 sits centered under a longer line 1 instead
  of hugging its left edge.
- **A filled bridge connects consecutive lines automatically** whenever
  there's a real gap between them — a solid strip spanning the shorter
  of the two lines' widths, extended slightly (0.3mm) into each line so
  the union is clean. This means line spacing no longer has to be
  pushed all the way down to make multi-line text read/print as one
  connected piece; the bridge does that regardless of spacing. Default
  **Line spacing dropped from 130% to 100%** accordingly. The bridge
  only fills the flat *plate* underneath — it's deliberately excluded
  from the raised colored layer and from engraved pockets, so it never
  shows up as its own visible box between the lines, and it's never
  listed as a paintable "letter" in Paint Mode.

## Per-line font & size

Each of the 2 text lines now has its own Font dropdown and Size slider
(right under that line's text field), instead of one font/size shared
across the whole name — useful for things like a first name in a bold
display font with a smaller tagline underneath in a different style.

Under the hood this needed a real layout change, not just a UI one:
`buildTextUnits()` in `js/geometry.js` now loads a font per line (was
one font for everything) and stacks lines using each line's own height
based on its own size, then centers the whole stack — which
mathematically reduces to the exact same result as before when every
line happens to share one size, so nothing changed visually for
existing single-font designs.

## Colors + Paint Mode

Plate color and text color now share one 28-color palette
(`js/colors.js`), shown as swatch buttons rather than native
dropdowns — each option shows an actual color square, not just a name.

**Paint Mode** (in the Style section, hidden automatically for
Engraved since a single-color recess has nothing separate to paint)
lets you color each letter — and the icon, if one's attached —
individually instead of using one flat text color. Toggle it on and a
row of small swatch buttons appears, one per character currently in
your name (plus the icon, if present); click any of them to open the
same color panel and assign that one letter its own color. Anything
left unpainted just uses the regular Text color as its default.

Under the hood, `js/geometry.js` builds each letter as its own
separate mesh (`buildTextUnits()`) rather than fusing the whole name
into one shape the way it used to — that's what makes individual
coloring possible, and it also means 3MF exports carry the exact same
per-letter colors (STL has no color data, so that part is
STL-format-agnostic either way).

## Keychain Type

A **Keychain Type** dropdown sits at the top of the sidebar:

- **Text Keychain** — everything from the original build (lines of
  text, font, an optional attached icon left/right of the text). The
  keyring sits at the far-left edge of the whole shape.
- **Icon Keychain** — the design is just one big icon from the same
  300-icon library, no text at all. Pick it from the dedicated picker,
  size it with the "Icon size" slider (defaults larger than text-mode's
  icon, since it's carrying the whole design on its own), and the
  keyring automatically centers itself above the icon rather than to
  its left.

An **Image to Keychain** type (upload a photo, quantize it to a few
colors, print it as a pixel mosaic) was tried and removed — the output
didn't look good enough to ship, so it was pulled back out entirely
rather than left half-working. The dropdown is back to just the two
types above.

Both types share the same Style/Plate/Keyring-hole controls and the
same raised/engraved, outline-plate, and export logic underneath —
`js/geometry.js`'s `buildKeychainModel()` just builds a different base
shape (lines of text vs. one glyph) before handing off to the same
plate/extrude/keyring pipeline.

## Known intentional differences from the .scad file

- The keyring hole is positioned dynamically off the actual rendered
  shape rather than a fixed offset, and is guaranteed to never overlap
  into the text/icon's solid material — only the ring around it does,
  by whatever margin is left over from the ring-thickness slider. The
  original SCAD file didn't need this since its `est_text_width`-based
  math made a fixed offset good enough for text; the icon-only mode
  here made a real-geometry-aware placement necessary. Default **Offset
  X is 0** (was -2) — 0 is exactly the auto-computed "just touching"
  position, so the old -2 default was pushing the ring an extra 2mm
  away from the keychain by default instead of leaving it flush; the
  slider still lets you nudge it further in or out manually.
- Curves (letterforms, offsets, hole) are polygon-approximated for
  speed; segment counts are tuned high enough that this is not visible
  at print resolution.
- Plate shape is outline-only (hugs the letters/icon) — Rectangle was
  offered for a while and has been removed.
