// ============================================================
// license.js — checks a Gumroad license key against TWO products
// (Personal and Commercial use) and exposes the result as
// window.entitlement + an "entitlement-changed" event, so main.js can
// gate the export button on it.
//
// No accounts, no database, no server of our own: Gumroad issues the
// key at purchase time, and this just asks Gumroad's API "is this key
// real, and for which product?" The key is stored in localStorage so
// returning visitors don't have to re-enter it, but it's re-verified
// against Gumroad on every page load (not just trusted locally),
// since a stored value alone is trivial to fake.
//
// FILL IN before deploying — two Gumroad products, one per tier:
//   PERSONAL / COMMERCIAL   PRODUCT_ID  — from each product's "Share" page
//   PERSONAL / COMMERCIAL   PRODUCT_URL — each product's public purchase link
// ============================================================

const TIERS = {
  personal: {
    productId: "vILRZ39wIQtoiuDzxDE4PQ==",
    productUrl: "https://artistry65738.gumroad.com/l/uddbbq",
    label: "Personal Use",
  },
  commercial: {
    productId: "clvCbeRsWgCJ0-1rgobg3w==",
    productUrl: "https://artistry65738.gumroad.com/l/qxobxy",
    label: "Commercial Use",
  },
};

const STORAGE_KEY = "keychainFactoryLicenseKey";

window.entitlement = { active: false, tier: null, checking: false };
function setEntitlement(next) {
  window.entitlement = { ...window.entitlement, ...next };
  window.dispatchEvent(new CustomEvent("entitlement-changed", { detail: window.entitlement }));
}

async function verifyWithGumroad(licenseKey, productId) {
  const body = new URLSearchParams();
  body.append("product_id", productId);
  body.append("license_key", licenseKey);
  body.append("increment_uses_count", "false"); // just checking validity, not counting a new activation

  const res = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    body,
  });
  return res.json(); // { success: true/false, purchase: {...}, message?: "..." }
}

// Tries the key against each tier's product in turn. A key only ever
// belongs to one product, so whichever one succeeds tells us the tier.
async function identifyTier(key) {
  for (const [tierKey, tier] of Object.entries(TIERS)) {
    const data = await verifyWithGumroad(key, tier.productId);
    if (data.success) return { tierKey, label: tier.label };
  }
  return null;
}

// ---------------- element refs ----------------
const accountStatus = document.getElementById("accountStatus");
const accountActionBtn = document.getElementById("accountActionBtn");

const modal = document.getElementById("licenseModal");
const modalHeading = document.getElementById("modalHeading");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const currentLicenseStatus = document.getElementById("currentLicenseStatus");
const buyPersonalLink = document.getElementById("buyPersonalLink");
const buyCommercialLink = document.getElementById("buyCommercialLink");
const licenseForm = document.getElementById("licenseForm");
const licenseKeyInput = document.getElementById("licenseKeyInput");
const licenseError = document.getElementById("licenseError");
const licenseSubmitBtn = document.getElementById("licenseSubmitBtn");
const removeLicenseBtn = document.getElementById("removeLicenseBtn");

buyPersonalLink.href = TIERS.personal.productUrl;
buyCommercialLink.href = TIERS.commercial.productUrl;

function openModal() {
  modal.classList.remove("hidden");
}
function closeModal() {
  modal.classList.add("hidden");
  licenseError.textContent = "";
  licenseKeyInput.value = "";
}
window.openLicenseModal = openModal; // main.js calls this when export is blocked

modalBackdrop.addEventListener("click", closeModal);
modalClose.addEventListener("click", closeModal);
accountActionBtn.addEventListener("click", openModal);

function showLocked() {
  accountStatus.textContent = "Free tier";
  accountActionBtn.textContent = "Unlock all fonts & icons";
  accountActionBtn.classList.remove("hidden");
  modalHeading.textContent = "Unlock all fonts & icons";
  currentLicenseStatus.classList.add("hidden");
  removeLicenseBtn.classList.add("hidden");
}
function showUnlocked(label) {
  accountStatus.textContent = `Licensed (${label}) \u2713`;
  accountActionBtn.textContent = "Change license";
  accountActionBtn.classList.remove("hidden"); // stays clickable so you can switch or remove it
  modalHeading.textContent = "Manage your license";
  currentLicenseStatus.textContent = `Currently licensed: ${label}. Enter a different key below to switch, or remove your license to go back to the free tier.`;
  currentLicenseStatus.classList.remove("hidden");
  removeLicenseBtn.classList.remove("hidden");
}

removeLicenseBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  setEntitlement({ active: false, tier: null, checking: false });
  showLocked();
  closeModal();
});

async function tryActivate(key, { silent = false } = {}) {
  if (!silent) {
    licenseSubmitBtn.disabled = true;
    licenseSubmitBtn.textContent = "Checking…";
    licenseError.textContent = "";
  }
  setEntitlement({ checking: true });
  try {
    const match = await identifyTier(key);
    if (match) {
      localStorage.setItem(STORAGE_KEY, key);
      setEntitlement({ active: true, tier: match.tierKey, checking: false });
      showUnlocked(match.label);
      closeModal();
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setEntitlement({ active: false, tier: null, checking: false });
      if (!silent) licenseError.textContent = "That license key isn't valid for either tier.";
      showLocked();
    }
  } catch (err) {
    setEntitlement({ active: false, tier: null, checking: false });
    if (!silent) {
      licenseError.textContent = navigator.onLine
        ? "Couldn't reach the license server. Try again in a moment."
        : "You're offline — reconnect to the internet to verify your license.";
    }
  } finally {
    if (!silent) {
      licenseSubmitBtn.disabled = false;
      licenseSubmitBtn.textContent = "Unlock";
    }
  }
}

licenseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = licenseKeyInput.value.trim();
  if (key) tryActivate(key);
});

// on load: if a key was saved from a previous visit, re-check it quietly
const savedKey = localStorage.getItem(STORAGE_KEY);
if (savedKey) {
  accountStatus.textContent = "Checking license\u2026";
  tryActivate(savedKey, { silent: true }).then(() => {
    if (!window.entitlement.active) {
      // Don't just say "Free tier" if this failed because we're offline —
      // the saved key wasn't rejected, it just couldn't be checked this
      // session (tryActivate's catch block never clears it), so a paying
      // customer deserves to know why access looks locked right now.
      if (!navigator.onLine && localStorage.getItem(STORAGE_KEY)) {
        accountStatus.textContent = "Offline \u2014 couldn't verify saved license";
        accountActionBtn.textContent = "Unlock all fonts & icons";
        accountActionBtn.classList.remove("hidden");
      } else {
        showLocked();
      }
    }
  });
} else {
  showLocked();
}
