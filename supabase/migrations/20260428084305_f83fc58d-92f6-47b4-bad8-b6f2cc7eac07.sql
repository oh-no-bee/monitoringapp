
-- Monthly upload periods (auto-detected from Excel date column)
CREATE TABLE public.upload_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key TEXT NOT NULL UNIQUE, -- "2026-03"
  period_label TEXT NOT NULL,       -- "March 2026"
  year INT NOT NULL,
  month INT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filename TEXT,
  row_count INT NOT NULL DEFAULT 0
);

-- Raw transactions per period
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.upload_periods(id) ON DELETE CASCADE,
  deal_code TEXT,
  txn_date DATE,
  teller TEXT,
  client_type TEXT,
  client_name TEXT,
  sanction_check TEXT,
  sanction_match TEXT,
  sanction_hits TEXT,
  product TEXT,
  currency TEXT,
  direction TEXT,
  total NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_txn_period ON public.transactions(period_id);
CREATE INDEX idx_txn_client ON public.transactions(client_name);

-- Built-in trigger config (thresholds editable; enabled toggle)
CREATE TABLE public.trigger_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_key TEXT NOT NULL UNIQUE,  -- 'ctr_zar', 'sda_threshold', etc.
  label TEXT NOT NULL,
  description TEXT,
  threshold NUMERIC,
  enabled BOOLEAN NOT NULL DEFAULT true,
  category TEXT NOT NULL DEFAULT 'built-in', -- built-in | custom
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Custom user-defined triggers (rule builder)
CREATE TABLE public.custom_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  description TEXT,
  -- Conditions: array of { field, op, value, combine }
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  aggregation TEXT NOT NULL DEFAULT 'per_transaction', -- per_transaction | per_client_total | per_client_count
  severity TEXT NOT NULL DEFAULT 'Medium',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Analyst comments per client per period
CREATE TABLE public.analyst_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.upload_periods(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', -- open | reviewed | escalated | cleared
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_id, client_name)
);

-- Enable RLS but allow public access (shared workspace)
ALTER TABLE public.upload_periods   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trigger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_triggers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyst_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public all" ON public.upload_periods   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.transactions     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.trigger_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.custom_triggers  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all" ON public.analyst_comments FOR ALL USING (true) WITH CHECK (true);

-- Seed built-in triggers
INSERT INTO public.trigger_settings (trigger_key, label, description, threshold, enabled) VALUES
('ctr_zar',           'CTR Alert (ZAR Cash/Local)',          'Cash/Local transaction over threshold for LI/MCPI clients', 49999.99, true),
('sanction_bypass',   'Sanction Bypass (>R10k & No Check)',  'Transaction over threshold without sanction check',         10000,    true),
('structuring',       'Structuring Risk (Cash/Local per day)','Cumulative daily cash exceeds threshold',                  45000,    true),
('iftr',              'IFTR Alert (LAC/LAI)',                'International funds transfer over threshold',               19999.99, true),
('product_migration', 'Product Risk (EFT → Cash >threshold)','Same client uses EFT then Cash above threshold',            10000,    true),
('high_limit_month',  'High Monthly Limit (LC/MCPC)',        'Monthly total exceeds threshold for LC/MCPC',               2000000,  true),
('high_velocity',     'High Velocity (Deal Count)',          'Client has more than N deal codes',                         3,        true),
('currency_uturn',    'Currency U-Turn (Buy & Sell USD)',    'Client both buys and sells USD',                            0,        true),
('high_volume_a',     'High Volume Tier A',                  'Client total exceeds tier A',                               250000,   true),
('high_volume_b',     'High Volume Tier B',                  'Client total exceeds tier B',                               150000,   true),
('currency_diversity','Unusual Currency Diversification',    'Client transacts in more than N currencies',                3,        true),
('sda_threshold',     'SDA Annual Allowance',                'Single Discretionary Allowance annual offshore threshold',  1000000,  true);
