import type { Peril } from "./types";

export const PERILS: Record<Peril, { name: string; unit: string; index: string; lowerWorse: boolean }> = {
  drought: { name: "Drought", unit: "mm", index: "Total rainfall", lowerWorse: true },
  dry_spell: { name: "Dry spell", unit: "days", index: "Longest dry spell", lowerWorse: false },
  excess_rain: { name: "Excess rain", unit: "mm", index: "Highest rolling rainfall", lowerWorse: false },
  heat: { name: "Heat", unit: "days", index: "Hot days", lowerWorse: false },
};

export type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

// Status colour is always paired with a text label, never used alone.
export const STATUS: Record<string, [Tone, string]> = {
  active: ["good", "Active"],
  expired: ["neutral", "Expired"],
  cancelled: ["critical", "Cancelled"],
  pending_approval: ["warning", "Awaiting approval"],
  approved: ["info", "Approved"],
  paid: ["good", "Paid"],
  rejected: ["critical", "Rejected"],
  not_started: ["neutral", "Not started"],
  monitoring: ["info", "Monitoring"],
  triggered: ["serious", "Triggered"],
  final: ["good", "Final"],
  insufficient_data: ["critical", "Data gap"],
};
