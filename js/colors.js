// ============================================================
// colors.js — one shared palette for plate color, text color, and
// per-letter paint mode, so all three pickers offer the same options.
// ============================================================

export const COLOR_PALETTE = [
  { name: "Black", hex: "#1a1a1a" },
  { name: "White", hex: "#f2f2f2" },
  { name: "Gray", hex: "#8a8a8a" },
  { name: "Dark Gray", hex: "#4a4a4a" },
  { name: "Silver", hex: "#c7cdd3" },
  { name: "Red", hex: "#e74c3c" },
  { name: "Crimson", hex: "#b3122f" },
  { name: "Orange", hex: "#e67e22" },
  { name: "Amber", hex: "#f5a623" },
  { name: "Yellow", hex: "#f1c40f" },
  { name: "Lime", hex: "#a4e02a" },
  { name: "Green", hex: "#2ecc71" },
  { name: "Emerald", hex: "#16a34a" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Cyan", hex: "#22d3ee" },
  { name: "Sky Blue", hex: "#38bdf8" },
  { name: "Blue", hex: "#3498db" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Violet", hex: "#7c3aed" },
  { name: "Magenta", hex: "#d946ef" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Brown", hex: "#92400e" },
  { name: "Tan", hex: "#d2b48c" },
  { name: "Gold", hex: "#d4af37" },
  { name: "Copper", hex: "#b87333" },
];

export function colorName(hex) {
  const found = COLOR_PALETTE.find((c) => c.hex.toLowerCase() === (hex || "").toLowerCase());
  return found ? found.name : "Custom";
}
