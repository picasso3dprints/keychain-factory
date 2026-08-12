import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/exporters/STLExporter.js";
import { FONT_TABLE, findDescriptor, ICON_PALETTE, FREE_FONT_NAMES, FREE_ICONS, LOGO_ICON_KEY } from "./fonts.js";
import { buildKeychainModel } from "./geometry.js";
import { COLOR_PALETTE, colorName } from "./colors.js";

// ---------------- connectivity + dependency error handling ----------------
// opentype.js and clipper-lib are loaded as classic <script> tags in
// index.html (geometry.js needs them as plain globals, not ES modules).
// If either failed to load — blocked by an ad blocker, a flaky network,
// jsdelivr being briefly down — every keychain render would fail with a
// confusing "window.opentype is not defined"-style error deep in
// geometry.js. Catching it here, once, up front, means one clear
// message instead of a cascade of cryptic ones.
const depsErrorBanner = document.getElementById("depsErrorBanner");
if (!window.opentype || !window.ClipperLib) {
  depsErrorBanner.classList.remove("hidden");
  throw new Error("Required libraries (opentype.js / clipper-lib) failed to load — stopping app init.");
}

const offlineBanner = document.getElementById("offlineBanner");
function updateOnlineStatus() {
  offlineBanner.classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ---------------- state (mirrors the .scad customizer variables) ----------------
// Single source of truth for "factory settings" — the Reset button
// restores exactly this. Kept separate from `state` (not just read
// from it) so it can never drift from the real defaults as the user
// changes things.
const DEFAULT_STATE = {
  keychainType: "text",
  line1: "TEXT", line2: "",
  lineSpacingPct: 100,
  lineFonts: ["Anton", "Anton"],
  lineSizes: [17, 17],
  boldX10: 0,
  style: "raised",
  textDepthX10: 14,
  plateColorHex: "#1a1a1a",
  textColorHex: "#2ecc71",
  plateThick: 3,
  outlineMarginX10: 25,
  holeDiameterX10: 30,
  ringThicknessX10: 5,
  keyringPreset: "auto",
  keyringOffsetX: 0,
  keyringOffsetY: 0,
  iconChar: null,
  iconPosition: "right",
  iconOffsetX: 0,
  iconOutlineMarginX10: 25,
  soloIconChar: ICON_PALETTE[0],
  soloIconSize: 30,
};

const state = {
  ...DEFAULT_STATE,
  lineFonts: [...DEFAULT_STATE.lineFonts],
  lineSizes: [...DEFAULT_STATE.lineSizes],
  letterColors: {}, // key (e.g. "0-3" or "icon") -> hex override, from Paint Mode
  paintMode: false,
};

// ---------------- populate the 3 per-line font dropdowns ----------------
const lineFontSelects = [1, 2].map((n) => document.getElementById(`line${n}Font`));
for (const select of lineFontSelects) {
  for (const [name] of FONT_TABLE) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}
lineFontSelects.forEach((select, i) => (select.value = state.lineFonts[i]));

const fontLockHint = document.getElementById("fontLockHint");

function updateFontLockUI() {
  const unlocked = window.entitlement && window.entitlement.active;
  for (const select of lineFontSelects) {
    for (const opt of select.options) {
      const isFree = FREE_FONT_NAMES.includes(opt.value);
      const showLocked = !isFree && !unlocked;
      opt.disabled = showLocked;
      opt.textContent = showLocked ? `\uD83D\uDD12 ${opt.value}` : opt.value;
    }
  }
  fontLockHint.style.display = unlocked ? "none" : "";
}
window.addEventListener("entitlement-changed", updateFontLockUI);
updateFontLockUI();

// ---------------- wire up every control generically ----------------
function bindNumber(id, key, transform = (v) => v) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    state[key] = transform(el.value);
    syncLabel(id, el.value);
    scheduleRegen();
  });
}
function bindText(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    state[key] = el.value;
    scheduleRegen();
  });
}
function bindSelect(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => {
    state[key] = el.value;
    scheduleRegen();
  });
}
function syncLabel(id, value) {
  const label = document.querySelector(`[data-for="${id}"]`);
  if (label) label.textContent = value;
}

// The logo icon isn't a real emoji character, so it can't just be set
// as a button's textContent like every other icon — show the actual
// logo image instead.
function setIconButtonContent(btn, icon) {
  if (icon === LOGO_ICON_KEY) {
    btn.innerHTML = "";
    const img = document.createElement("img");
    img.src = "assets/logo-icon.png";
    img.alt = "Keychain Factory logo";
    img.className = "icon-btn-logo-img";
    btn.appendChild(img);
    btn.title = "Keychain Factory logo";
  } else {
    btn.textContent = icon;
    btn.title = icon;
  }
}

// Turns a caught error into a message that actually helps — network
// failures (offline, a CDN blocked, Google Fonts unreachable) are the
// most common real-world failure here, and "Error: Failed to fetch"
// on its own doesn't tell anyone what to do about it.
function describeError(err) {
  const msg = err && err.message ? err.message : String(err);
  const looksNetworky = /fetch|network|load/i.test(msg);
  if (!navigator.onLine) {
    return "Error: you're offline — reconnect and try again.";
  }
  if (looksNetworky) {
    return "Error: couldn't reach a required resource (Google Fonts, an icon, or a library) — check your connection and try again.";
  }
  return "Error: " + msg;
}

// Collapses a CSS-grid picker (icon pickers) down to a fixed number of
// rows with a "Show More/Less" toggle. Row height is measured from the
// actual rendered buttons rather than hardcoded, so it stays correct
// regardless of font rendering/box sizing differences across browsers.
function setupCollapsibleGrid(gridEl, toggleBtn, rows = 3) {
  let expanded = false;
  function collapsedHeight() {
    const first = gridEl.children[0];
    if (!first) return null;
    const btnH = first.getBoundingClientRect().height;
    if (!btnH) return null; // parent currently hidden (display:none) — can't measure yet
    const gap = parseFloat(getComputedStyle(gridEl).rowGap || "6");
    return rows * btnH + (rows - 1) * gap;
  }
  function applyCollapsed() {
    const h = collapsedHeight();
    if (h == null) return;
    gridEl.style.maxHeight = `${h}px`;
    gridEl.style.overflow = "hidden";
  }
  applyCollapsed();
  toggleBtn.addEventListener("click", () => {
    expanded = !expanded;
    if (expanded) {
      gridEl.style.maxHeight = `${gridEl.scrollHeight}px`;
      gridEl.style.overflow = "visible";
      toggleBtn.textContent = "Show Less \u25B4";
    } else {
      applyCollapsed();
      toggleBtn.textContent = "Show More \u25BE";
    }
  });
  return {
    // re-measure once the grid becomes visible (e.g. its fieldset was
    // display:none at setup time, so the initial measurement came back 0)
    refresh() {
      if (!expanded) applyCollapsed();
    },
  };
}

bindText("line1", "line1");
bindText("line2", "line2");
bindNumber("lineSpacing", "lineSpacingPct", Number);
bindNumber("bold", "boldX10", Number);
bindNumber("textDepth", "textDepthX10", Number);
bindNumber("plateThick", "plateThick", Number);
bindNumber("outlineMargin", "outlineMarginX10", Number);
bindNumber("holeDiameter", "holeDiameterX10", Number);
bindNumber("ringThickness", "ringThicknessX10", Number);
bindNumber("keyringOffsetX", "keyringOffsetX", Number);
bindNumber("keyringOffsetY", "keyringOffsetY", Number);
bindNumber("soloIconSize", "soloIconSize", Number);
bindNumber("iconOffsetX", "iconOffsetX", Number);
bindNumber("iconOutlineMargin", "iconOutlineMarginX10", Number);

// ---------------- keyring position presets ----------------
const keyringPresetGrid = document.getElementById("keyringPresetGrid");
const keyringPresetButtons = keyringPresetGrid.querySelectorAll("button[data-preset]");
function setKeyringPresetUI() {
  keyringPresetButtons.forEach((b) => b.classList.toggle("selected", b.dataset.preset === state.keyringPreset));
}
keyringPresetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.keyringPreset = btn.dataset.preset;
    setKeyringPresetUI();
    scheduleRegen();
  });
});

// per-line font + size
lineFontSelects.forEach((select, i) => {
  select.addEventListener("change", () => {
    state.lineFonts[i] = select.value;
    scheduleRegen();
  });
});
[1, 2].forEach((n, i) => {
  const slider = document.getElementById(`line${n}Size`);
  slider.addEventListener("input", () => {
    state.lineSizes[i] = Number(slider.value);
    syncLabel(`line${n}Size`, slider.value);
    scheduleRegen();
  });
});

// ---------------- shared color picker panel (used by plate/text/letter swatches) ----------------
const colorPanel = document.getElementById("colorPanel");
const colorPanelGrid = document.getElementById("colorPanelGrid");
const colorPanelClear = document.getElementById("colorPanelClear");

for (const c of COLOR_PALETTE) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "color-swatch-btn";
  btn.dataset.hex = c.hex;
  const sw = document.createElement("span");
  sw.className = "color-swatch";
  sw.style.background = c.hex;
  const label = document.createElement("span");
  label.className = "color-swatch-label";
  label.textContent = c.name;
  btn.appendChild(sw);
  btn.appendChild(label);
  colorPanelGrid.appendChild(btn);
}

let colorPanelOnSelect = null;
let colorPanelOnClear = null;

function openColorPanel(anchorEl, currentHex, onSelect, onClear) {
  colorPanelOnSelect = onSelect;
  colorPanelOnClear = onClear || null;
  colorPanelClear.classList.toggle("hidden", !onClear);
  colorPanelGrid.querySelectorAll(".color-swatch-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.hex.toLowerCase() === (currentHex || "").toLowerCase());
  });
  const rect = anchorEl.getBoundingClientRect();
  const panelWidth = 236;
  colorPanel.style.top = `${rect.bottom + 6}px`;
  colorPanel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth))}px`;
  colorPanel.classList.remove("hidden");
}
function closeColorPanel() {
  colorPanel.classList.add("hidden");
  colorPanelOnSelect = null;
  colorPanelOnClear = null;
}
colorPanelGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".color-swatch-btn");
  if (!btn) return;
  const hex = btn.dataset.hex;
  if (colorPanelOnSelect) colorPanelOnSelect(hex);
  closeColorPanel();
});
colorPanelClear.addEventListener("click", () => {
  if (colorPanelOnClear) colorPanelOnClear();
  closeColorPanel();
});
document.addEventListener("click", (e) => {
  if (
    !colorPanel.classList.contains("hidden") &&
    !colorPanel.contains(e.target) &&
    !e.target.closest(".color-trigger, .paint-letter-btn")
  ) {
    closeColorPanel();
  }
});

// ---------------- plate color + text color triggers ----------------
const plateColorTrigger = document.getElementById("plateColorTrigger");
const plateColorSwatch = document.getElementById("plateColorSwatch");
const plateColorLabel = document.getElementById("plateColorLabel");
function refreshPlateColorUI() {
  plateColorSwatch.style.background = state.plateColorHex;
  plateColorLabel.textContent = colorName(state.plateColorHex);
}
plateColorTrigger.addEventListener("click", () => {
  openColorPanel(plateColorTrigger, state.plateColorHex, (hex) => {
    state.plateColorHex = hex;
    refreshPlateColorUI();
    scheduleRegen();
  });
});
refreshPlateColorUI();

const textColorTrigger = document.getElementById("textColorTrigger");
const textColorSwatch = document.getElementById("textColorSwatch");
const textColorLabel = document.getElementById("textColorLabel");
function refreshTextColorUI() {
  textColorSwatch.style.background = state.textColorHex;
  textColorLabel.textContent = colorName(state.textColorHex);
}
textColorTrigger.addEventListener("click", () => {
  openColorPanel(textColorTrigger, state.textColorHex, (hex) => {
    state.textColorHex = hex;
    refreshTextColorUI();
    scheduleRegen();
  });
});
refreshTextColorUI();

// ---------------- Paint Mode: per-letter (and per-icon) color overrides ----------------
const paintModeToggle = document.getElementById("paintModeToggle");
const paintLetterList = document.getElementById("paintLetterList");
let lastPaintUnits = []; // [{key, char}] captured from the most recent successful build

function renderPaintLetterList() {
  paintLetterList.innerHTML = "";
  for (const unit of lastPaintUnits) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "paint-letter-btn";
    const isLogo = unit.char === LOGO_ICON_KEY;
    const label = isLogo ? "logo" : unit.char;
    if (isLogo) {
      const mark = document.createElement("span");
      mark.className = "paint-letter-logo-img";
      btn.appendChild(mark);
    } else {
      btn.textContent = unit.char;
    }
    const hex = state.letterColors[unit.key] || state.textColorHex;
    btn.style.background = hex;
    btn.title = `Color for "${label}"`;
    btn.addEventListener("click", () => {
      openColorPanel(
        btn,
        hex,
        (newHex) => {
          state.letterColors[unit.key] = newHex;
          scheduleRegen();
          renderPaintLetterList();
        },
        state.letterColors[unit.key]
          ? () => {
              delete state.letterColors[unit.key];
              scheduleRegen();
              renderPaintLetterList();
            }
          : null
      );
    });
    paintLetterList.appendChild(btn);
  }
}

paintModeToggle.addEventListener("change", () => {
  state.paintMode = paintModeToggle.checked;
  paintLetterList.classList.toggle("hidden", !state.paintMode);
  if (state.paintMode) renderPaintLetterList();
});

// ---------------- style select: raised/engraved (Paint Mode only applies to raised) ----------------
const styleSelect = document.getElementById("style");
function updateStyleUI() {
  const isEngraved = state.style === "engraved";
  document.querySelectorAll(".type-not-engraved").forEach((el) => (el.style.display = isEngraved ? "none" : ""));
  if (isEngraved && state.paintMode) {
    paintModeToggle.checked = false;
    state.paintMode = false;
    paintLetterList.classList.add("hidden");
  }
}
styleSelect.addEventListener("change", () => {
  state.style = styleSelect.value;
  updateStyleUI();
  scheduleRegen();
});
updateStyleUI();

// ---------------- keychain type: Text Keychain vs Icon Keychain ----------------
const keychainTypeSelect = document.getElementById("keychainType");
let soloIconGridControl = null; // assigned once the solo icon picker is built, below
function updateKeychainTypeVisibility() {
  const t = state.keychainType;
  document.querySelectorAll(".type-text-only").forEach((el) => (el.style.display = t === "text" ? "" : "none"));
  document.querySelectorAll(".type-icon-only").forEach((el) => (el.style.display = t === "icon" ? "" : "none"));
  if (t === "icon" && soloIconGridControl) soloIconGridControl.refresh();
}
keychainTypeSelect.addEventListener("change", () => {
  state.keychainType = keychainTypeSelect.value;
  updateKeychainTypeVisibility();
  scheduleRegen();
});
updateKeychainTypeVisibility();

// ---------------- solo icon picker (Icon Keychain type): exactly one required icon ----------------
function isIconLocked(icon) {
  const unlocked = window.entitlement && window.entitlement.active;
  return !unlocked && !FREE_ICONS.includes(icon);
}

const soloIconPicker = document.getElementById("soloIconPicker");
const soloIconButtons = new Map();
for (const icon of ICON_PALETTE) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  setIconButtonContent(btn, icon);
  if (icon === state.soloIconChar) btn.classList.add("selected");
  btn.addEventListener("click", () => {
    if (isIconLocked(icon)) {
      if (typeof window.openLicenseModal === "function") window.openLicenseModal();
      return;
    }
    if (state.soloIconChar === icon) return; // required — clicking the current one again does nothing
    const prevBtn = soloIconButtons.get(state.soloIconChar);
    if (prevBtn) prevBtn.classList.remove("selected");
    state.soloIconChar = icon;
    btn.classList.add("selected");
    scheduleRegen();
  });
  soloIconButtons.set(icon, btn);
  soloIconPicker.appendChild(btn);
}
soloIconGridControl = setupCollapsibleGrid(soloIconPicker, document.getElementById("soloIconPickerToggle"), 3);

// ---------------- icon picker: pick ONE icon, positioned left or right of the text ----------------
const iconPicker = document.getElementById("iconPicker");
const iconPositionRow = document.getElementById("iconPositionRow");
const iconPosButtons = iconPositionRow.querySelectorAll("button[data-pos]");

const iconButtons = new Map(); // icon char -> button element

function setIconPositionUI() {
  iconPosButtons.forEach((b) => b.classList.toggle("selected", b.dataset.pos === state.iconPosition));
}

for (const icon of ICON_PALETTE) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  setIconButtonContent(btn, icon);
  btn.addEventListener("click", () => {
    if (isIconLocked(icon)) {
      if (typeof window.openLicenseModal === "function") window.openLicenseModal();
      return;
    }
    if (state.iconChar === icon) {
      // clicking the already-selected icon again deselects it
      state.iconChar = null;
      btn.classList.remove("selected");
    } else {
      const prevBtn = iconButtons.get(state.iconChar);
      if (prevBtn) prevBtn.classList.remove("selected");
      state.iconChar = icon;
      btn.classList.add("selected");
    }
    scheduleRegen();
  });
  iconButtons.set(icon, btn);
  iconPicker.appendChild(btn);
}
setupCollapsibleGrid(iconPicker, document.getElementById("iconPickerToggle"), 3);

// keep the "locked" visual + selections in sync with license status
const iconLockHint = document.getElementById("iconLockHint");
const soloIconLockHint = document.getElementById("soloIconLockHint");
function updateIconLockUI() {
  const unlocked = window.entitlement && window.entitlement.active;
  for (const [icon, btn] of soloIconButtons) {
    btn.classList.toggle("locked", !unlocked && !FREE_ICONS.includes(icon));
  }
  for (const [icon, btn] of iconButtons) {
    btn.classList.toggle("locked", !unlocked && !FREE_ICONS.includes(icon));
  }
  iconLockHint.style.display = unlocked ? "none" : "";
  soloIconLockHint.style.display = unlocked ? "none" : "";
  if (!unlocked) {
    if (!FREE_ICONS.includes(state.soloIconChar)) {
      const prevBtn = soloIconButtons.get(state.soloIconChar);
      if (prevBtn) prevBtn.classList.remove("selected");
      state.soloIconChar = FREE_ICONS[0];
      const newBtn = soloIconButtons.get(FREE_ICONS[0]);
      if (newBtn) newBtn.classList.add("selected");
    }
    if (state.iconChar && !FREE_ICONS.includes(state.iconChar)) {
      const prevBtn = iconButtons.get(state.iconChar);
      if (prevBtn) prevBtn.classList.remove("selected");
      state.iconChar = null;
    }
  }
}
window.addEventListener("entitlement-changed", () => {
  updateIconLockUI();
  scheduleRegen();
});
updateIconLockUI();

iconPosButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.iconPosition = btn.dataset.pos;
    setIconPositionUI();
    if (state.iconChar) scheduleRegen();
  });
});
setIconPositionUI();

// ---------------- three.js scene ----------------
const canvas = document.getElementById("viewer");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171b); // dark grey, matches the UI theme

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
camera.position.set(0, -70, 60);
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 2);
controls.enableDamping = true;

const grid = new THREE.GridHelper(220, 44, 0x22c55e, 0x2f3742);
grid.rotation.x = Math.PI / 2; // lie flat on the Z=0 plane (our Z-up world)
grid.material.transparent = true;
grid.material.opacity = 0.5;
scene.add(grid);

scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.1));
const key1 = new THREE.DirectionalLight(0xffffff, 0.9);
key1.position.set(40, -60, 80);
scene.add(key1);
const key2 = new THREE.DirectionalLight(0xffffff, 0.4);
key2.position.set(-50, 40, 30);
scene.add(key2);

let currentGroup = null;

function resizeRenderer() {
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// ---------------- click model to show dimensions ----------------
const raycaster = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2();
const dimsPanel = document.getElementById("dimsPanel");

canvas.addEventListener("click", (ev) => {
  if (!currentGroup) return;
  const rect = canvas.getBoundingClientRect();
  mouseNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouseNdc, camera);
  const hits = raycaster.intersectObject(currentGroup, true);
  if (hits.length > 0) {
    const box = new THREE.Box3().setFromObject(currentGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    dimsPanel.innerHTML =
      `<strong>Dimensions</strong>` +
      `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm` +
      `<span class="dims-sub">width × depth × height</span>`;
    dimsPanel.classList.add("visible");
  } else {
    dimsPanel.classList.remove("visible");
  }
});

// ---------------- regeneration ----------------
const statusEl = document.getElementById("status");
const exportBtn = document.getElementById("exportBtn");

let regenToken = 0;
let debounceTimer = null;

function scheduleRegen() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(regen, 350);
}

async function regen() {
  const myToken = ++regenToken;
  statusEl.textContent = "Rendering…";
  statusEl.classList.add("busy");
  exportBtn.disabled = true;
  try {
    const params = {
      line1: state.line1, line2: state.line2,
      lineSpacingPct: state.lineSpacingPct,
      lineDescriptors: state.lineFonts.map(findDescriptor),
      lineSizes: state.lineSizes,
      boldX10: state.boldX10,
      style: state.style,
      textDepthX10: state.textDepthX10,
      plateColorHex: state.plateColorHex,
      textColorHex: state.textColorHex,
      letterColors: state.letterColors,
      plateThick: state.plateThick,
      outlineMarginX10: state.outlineMarginX10,
      holeDiameterX10: state.holeDiameterX10,
      ringThicknessX10: state.ringThicknessX10,
      keyringPreset: state.keyringPreset,
      keyringOffsetX: state.keyringOffsetX,
      keyringOffsetY: state.keyringOffsetY,
      iconChar: state.iconChar,
      iconPosition: state.iconPosition,
      iconOffsetX: state.iconOffsetX,
      iconOutlineMarginX10: state.iconOutlineMarginX10,
      keychainType: state.keychainType,
      soloIconChar: state.soloIconChar,
      iconOnlySize: state.soloIconSize,
    };

    const { group, paintUnits } = await buildKeychainModel(THREE, params);
    if (myToken !== regenToken) return; // a newer request superseded this one

    lastPaintUnits = paintUnits || [];
    if (state.paintMode) renderPaintLetterList();

    if (currentGroup) {
      scene.remove(currentGroup);
      currentGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    currentGroup = group;
    scene.add(currentGroup);

    // Recenter the model itself on the grid (X/Y only — leave Z alone
    // so it still sits flush on the bed at z=0). Without this, the
    // model only *looks* centered because the camera follows it; the
    // actual geometry (and therefore the exported STL/3MF) stays
    // wherever the keyring happened to push it off-origin. This also
    // means exports come out pre-centered, which slicers generally
    // prefer for auto-arrange.
    const rawBox = new THREE.Box3().setFromObject(currentGroup);
    const rawCenter = new THREE.Vector3();
    rawBox.getCenter(rawCenter);
    currentGroup.position.x -= rawCenter.x;
    currentGroup.position.y -= rawCenter.y;

    // frame the camera on the (now-centered) model
    const box = new THREE.Box3().setFromObject(currentGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    const dist = Math.max(size.x, size.y, 40) * 1.6;
    camera.position.set(center.x, center.y - dist, dist * 0.85);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();

    statusEl.textContent = "Ready";
    exportBtn.disabled = false;
  } catch (err) {
    console.error(err);
    statusEl.textContent = describeError(err);
  } finally {
    statusEl.classList.remove("busy");
  }
}

// ---------------- Export modal (STL / 3MF) ----------------
const exportModal = document.getElementById("exportModal");
const exportModalBackdrop = document.getElementById("exportModalBackdrop");
const exportModalClose = document.getElementById("exportModalClose");
const exportLicenseNotice = document.getElementById("exportLicenseNotice");
const exportFormatBtns = document.querySelectorAll(".export-format-btn");

function updateExportLicenseNotice() {
  const ent = window.entitlement;
  const isCommercial = !!(ent && ent.active && ent.tier === "commercial");
  if (isCommercial) {
    exportLicenseNotice.innerHTML =
      'By downloading, you agree to the <a href="legal/commercial-license.pdf" target="_blank" rel="noopener">Commercial License Agreement</a>.';
  } else {
    exportLicenseNotice.innerHTML =
      'By downloading, you agree to the <a href="legal/personal-license.pdf" target="_blank" rel="noopener">Personal License Agreement</a>.';
  }
}

function openExportModal() {
  if (exportBtn.disabled) return;
  updateExportLicenseNotice();
  exportModal.classList.remove("hidden");
}
function closeExportModal() {
  exportModal.classList.add("hidden");
}
exportBtn.addEventListener("click", openExportModal);
exportModalBackdrop.addEventListener("click", closeExportModal);
exportModalClose.addEventListener("click", closeExportModal);
window.addEventListener("entitlement-changed", updateExportLicenseNotice);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fileBaseName() {
  return (state.line1 || "keychain").trim().replace(/[^a-z0-9]+/gi, "_") || "keychain";
}

async function exportSTL() {
  const exporter = new STLExporter();
  const stlString = exporter.parse(currentGroup, { binary: false });
  downloadBlob(new Blob([stlString], { type: "text/plain" }), `${fileBaseName()}.stl`);
}

async function export3MF() {
  let exportTo3MF;
  try {
    ({ exportTo3MF } = await import("https://cdn.jsdelivr.net/npm/three-3mf-exporter@latest/+esm"));
  } catch (err) {
    throw new Error("couldn't load the 3MF export library — check your internet connection and try again");
  }
  const blob = await exportTo3MF(currentGroup);
  downloadBlob(blob, `${fileBaseName()}.3mf`);
}

exportFormatBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!currentGroup) return;

    // Export itself is always free — the paywall is which fonts/icons
    // can be selected in the first place (see updateFontLockUI /
    // updateIconLockUI), so by the time a model exists it's already
    // built entirely from free-tier or licensed content.
    const format = btn.dataset.format;
    exportFormatBtns.forEach((b) => (b.disabled = true));
    const originalExportLabel = exportBtn.textContent;
    exportBtn.textContent = "Exporting…";
    try {
      if (format === "stl") await exportSTL();
      else if (format === "3mf") await export3MF();
      closeExportModal();
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Export failed — " + describeError(err).replace(/^Error: /, "");
    } finally {
      exportFormatBtns.forEach((b) => (b.disabled = false));
      exportBtn.textContent = originalExportLabel;
    }
  });
});

// ---------------- Reset to Defaults ----------------
const resetDefaultsBtn = document.getElementById("resetDefaultsBtn");
resetDefaultsBtn.addEventListener("click", () => {
  Object.assign(state, DEFAULT_STATE);
  state.lineFonts = [...DEFAULT_STATE.lineFonts];
  state.lineSizes = [...DEFAULT_STATE.lineSizes];
  state.letterColors = {};
  state.paintMode = false;

  // text fields
  document.getElementById("line1").value = state.line1;
  document.getElementById("line2").value = state.line2;

  // per-line font + size
  lineFontSelects.forEach((select, i) => (select.value = state.lineFonts[i]));
  [1, 2].forEach((n, i) => {
    document.getElementById(`line${n}Size`).value = state.lineSizes[i];
    syncLabel(`line${n}Size`, state.lineSizes[i]);
  });

  // sliders + their displayed numbers
  const sliders = [
    ["lineSpacing", state.lineSpacingPct],
    ["bold", state.boldX10],
    ["textDepth", state.textDepthX10],
    ["plateThick", state.plateThick],
    ["outlineMargin", state.outlineMarginX10],
    ["holeDiameter", state.holeDiameterX10],
    ["ringThickness", state.ringThicknessX10],
    ["keyringOffsetX", state.keyringOffsetX],
    ["keyringOffsetY", state.keyringOffsetY],
    ["soloIconSize", state.soloIconSize],
    ["iconOffsetX", state.iconOffsetX],
    ["iconOutlineMargin", state.iconOutlineMarginX10],
  ];
  for (const [id, value] of sliders) {
    document.getElementById(id).value = value;
    syncLabel(id, value);
  }

  // selects
  styleSelect.value = state.style;
  keychainTypeSelect.value = state.keychainType;

  // custom pickers
  refreshPlateColorUI();
  refreshTextColorUI();
  setIconPositionUI();
  setKeyringPresetUI();
  updateStyleUI();
  updateKeychainTypeVisibility();
  updateFontLockUI();

  // icon selections
  for (const btn of iconButtons.values()) btn.classList.remove("selected");
  for (const [icon, btn] of soloIconButtons) btn.classList.toggle("selected", icon === state.soloIconChar);

  // paint mode UI
  paintModeToggle.checked = false;
  paintLetterList.classList.add("hidden");
  paintLetterList.innerHTML = "";

  updateFontLockUI();
  updateIconLockUI();

  scheduleRegen();
});

regen();
