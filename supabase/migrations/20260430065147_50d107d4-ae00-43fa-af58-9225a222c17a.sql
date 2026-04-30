UPDATE public.trigger_settings
SET label = 'Structuring / Smurfing (Cash daily total)',
    description = 'Cumulative Cash/Local transactions for a single client on the same day reach this ZAR amount — classic structuring (a.k.a. smurfing) pattern just under the CTR R49 999.99 threshold. FICA Reg 22B / FIC Guidance Note 7.',
    updated_at = now()
WHERE trigger_key = 'structuring';

INSERT INTO public.trigger_settings (trigger_key, label, description, threshold, enabled, category)
VALUES
('smurf_count', 'Smurf Pattern (Cash txns per day)',
 'Flags a client when the number of separate Cash/Local transactions on the same day reaches this count — multiple sub-threshold deposits indicating possible smurfing.',
 4, true, 'built-in'),
('layering_products', 'Rapid Layering (Distinct Products)',
 'Flags a client who uses this many or more distinct products (Cash, EFT, TT, Draft, Local) in the period — indicative of layering to obscure source/destination of funds.',
 3, true, 'built-in')
ON CONFLICT DO NOTHING;