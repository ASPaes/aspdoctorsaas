

# Root Cause: Wrong URA Template Being Used

## Problem
There are **two sets of URA columns** in the `configuracoes` table:

1. **`support_ura_welcome_template`** — the one edited in the UI (AtendimentoCsatTab). This is what the user configured with their custom text.
2. **`ura_welcome_template`** — a "v2" column with a hardcoded default: `'Olá! 👋 Para te atender mais rápido, escolha um setor:\n{options}\n\nResponda apenas com o número. 😊'`

The webhook code (line 977) prioritizes `ura_welcome_template` first:
```typescript
const template = supportConfig.ura_welcome_template || supportConfig.support_ura_welcome_template || '';
```

Since `ura_welcome_template` always has a non-empty default value in the DB, the user's custom `support_ura_welcome_template` is **never used**.

Same issue applies to `ura_enabled` (defaults to `true`) overriding `support_ura_enabled`.

## Solution — Consolidate to single set of fields

**File: `supabase/functions/evolution-webhook/index.ts`**

1. Swap priority on line 961: use `support_ura_enabled` first (the one the UI controls)
2. Swap priority on line 977: use `support_ura_welcome_template` first
3. Swap priority on line 1431: use `support_ura_welcome_template` for max option extraction
4. Same for invalid option template references

Specifically change:
- `supportConfig.ura_enabled ?? supportConfig.support_ura_enabled` → `supportConfig.support_ura_enabled ?? supportConfig.ura_enabled`
- `supportConfig.ura_welcome_template || supportConfig.support_ura_welcome_template` → `supportConfig.support_ura_welcome_template || supportConfig.ura_welcome_template`
- Same pattern for `invalid_option_template`

**File: `supabase/functions/_shared/support-config.ts`**

Update the `ura_enabled` default from `true` to `false` so it doesn't override the UI-controlled `support_ura_enabled` when no explicit value is set.

No other files change. The UI already reads/writes the correct `support_ura_*` fields.

