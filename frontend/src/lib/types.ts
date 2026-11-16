// Shapes returned by the ClimaSure API (see the backend's /docs endpoint).

export type Peril = "drought" | "dry_spell" | "excess_rain" | "heat";

export interface TriggerSpec {
  peril: Peril;
  window_start: string;
  window_end: string;
  trigger: number;
  exit: number;
  share: number;
  min_payout_pct?: number;
  rolling_days?: number;
  heat_threshold_c?: number;
  dry_day_mm?: number;
  label?: string | null;
}

export interface Contract {
  id: string;
  client_id: string;
  policy_ref: string;
  insured_ref: string;
  lat: number;
  lon: number;
  sum_insured: number;
  currency: string;
  crop?: string | null;
  cell_id: string;
  status: "active" | "expired" | "cancelled";
  triggers: TriggerSpec[];
}

export interface TriggerResult {
  position: number;
  peril: Peril;
  label?: string | null;
  status: string;
  index_value: number | null;
  trigger: number;
  exit: number;
  payout_fraction: number;
  payout_amount: number;
  days_expected: number;
  days_observed: number;
  detail: Record<string, unknown> & { provisional_fraction_if_window_closed_today?: number };
}

export interface DailyWeather {
  date: string;
  rain_mm: number | null;
  tmax_c: number | null;
  tmin_c: number | null;
}

export interface EvaluationSummary {
  id: string;
  as_of: string;
  total_payout: number;
  evidence_hash: string;
  created_at: string;
}

export interface Evaluation {
  id: string;
  contract_id: string;
  as_of: string;
  provider: string;
  engine_version: string;
  currency: string;
  sum_insured: number;
  total_payout: number;
  results: TriggerResult[];
  data: DailyWeather[];
  evidence_hash: string;
  created_at: string;
}

export type PayoutStatus = "pending_approval" | "approved" | "paid" | "rejected";

export interface Payout {
  id: string;
  contract_id: string;
  client_id: string;
  evaluation_id: string;
  insured_ref: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Me {
  id: string;
  name: string;
  webhook_url: string | null;
  auto_approve: number | boolean;
  created_at: string;
}

export interface Summary {
  contracts: Partial<Record<Contract["status"], { count: number; sum_insured: number }>>;
  payouts: Partial<Record<PayoutStatus, { count: number; amount: number }>>;
}

export interface Delivery {
  id: string;
  event: string;
  url: string | null;
  ok: number;
  status_code: number | null;
  error: string | null;
  created_at: string;
}

export interface Backtest {
  years: number;
  provider: string;
  payout_frequency: number;
  burn_cost_pct: number;
  burn_cost_std_pct: number;
  worst_year_pct: number;
  indicative_premium_pct: number;
  indicative_premium: number;
  seasons: { season_start: string; payout: number; payout_pct: number }[];
}

export interface Climatology {
  provider: string;
  seasons: { year: number; rain_mm: number }[];
  mean_mm: number;
  p10_mm: number;
  p20_mm: number;
  median_mm: number;
}

export interface AdminClient {
  id: string;
  name: string;
  webhook_url: string | null;
  auto_approve: number;
  created_at: string;
  contracts: number;
}

export interface EvaluateResponse {
  evaluation_id: string;
  total_payout: number;
  warnings: string[];
  payout: Payout | null;
}

export interface DailyRunSummary {
  as_of: string;
  evaluated: number;
  skipped: number;
  payouts_raised: number;
  payout_total: number;
  errors: { contract_id: string; error: string }[];
}
