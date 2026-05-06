## What I'll change

### 1. Fix April upload (Total ZAR = 0)
April's sheet has only foreign-currency rows; the existing parser only reads the `Total` column, which is in the foreign currency, so the ZAR aggregation comes out empty.

- Update `src/lib/excel.ts` to also detect ZAR-equivalent columns: `Total (ZAR)`, `Total ZAR`, `ZAR Total`, `ZAR Equivalent`, `ZAR Amount`, `Rand Equivalent`, `Rand Value`, `Total Rand`.
- Store that value into `total` whenever the row currency is not ZAR (so the rules engine, which sums `currency=ZAR ? total : 0`, will instead sum the ZAR-equivalent across ALL rows). For ZAR rows, keep `Total` as today.
- Backfill: re-running the April upload will then populate the totals correctly. Existing periods are unaffected.

### 2. Watch List tab (new)
A third top-level tab next to Compliance Dashboard / Flagged Clients.

- Pulls only **MCPI** and **LI** clients across **all periods**.
- Per-client row: name, type, months active (chips per month with txn count + ZAR), total ZAR lifetime, last-seen month, transacting-streak indicator, "missed last month" alert badge.
- "Assign trigger" action on each row → opens a small dialog letting you toggle which built-in/custom triggers apply specifically to that watch-listed client (stored in a new `watchlist_assignments` table).
- Filter chips: All / Active this month / Missed last month / New this month.
- Animated entrance, hover-lift cards, pulsing alert dot for "missed last month".

### 3. Advanced trigger editing
Upgrade `TriggerManager`:

- Built-ins are now fully editable: label, description, threshold, severity, enabled — and **deletable** (soft-disabled into a hidden bucket with a "Restore defaults" button).
- "Add built-in style trigger" quick-add for the common AML rules.
- Custom triggers: full CRUD (already mostly there) — add severity dropdown, duplicate, and inline JSON-condition editor improvements.
- Reachable from three places: header button, "Edit Rules" in Flagged tab, and a new "Adjust triggers" button at the top of each flagged client card.

### 4. Flagged tab — story-form narrative
- Replace the bullet list with a single flowing paragraph that weaves AML/FIC reasoning, totals, products, currencies, breached rules, and the recommended next step into one cohesive story (no bullets).
- Keep the risk score chip and "Adjust triggers" button.

### 5. Animations & UI polish
- Add `animate-fade-in`, `animate-scale-in`, staggered list entrance, hover-lift on cards, smooth tab transitions, animated count-up on stat cards, pulse on critical badges.
- Toast styling refresh; sheet/dialog transitions; subtle gradient borders on flagged & watch-list cards.

### Technical details
- New migration: `watchlist_assignments` table (`client_name`, `trigger_key`, `note`, `enabled`, RLS public for now matching existing tables) + add `is_hidden` boolean to `trigger_settings` so built-ins can be "deleted" without losing the seed.
- New file: `src/components/WatchList.tsx`.
- Edits: `src/lib/excel.ts`, `src/lib/flagged.ts` (story narrative), `src/components/FlaggedClients.tsx`, `src/components/TriggerManager.tsx`, `src/components/Dashboard.tsx`, `src/styles.css` (new keyframes/utilities).

After this lands you'll need to **re-upload the April sheet once** so the ZAR-equivalent column is captured.