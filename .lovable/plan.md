

## Plan: Modern Date Range Picker for Filters

### Current State
The `DateRangePicker` component (lines 30-59 in `Clientes.tsx`) uses two separate Popover+Calendar combos — one for "De" and one for "Até". This requires two clicks, two calendar opens, and feels disconnected.

### Proposed Design
Replace with a **single-popover date range picker** using `react-day-picker`'s built-in `mode="range"` feature. The user clicks one button that shows a **dual-month calendar** where they click start date, then end date in a single interaction.

**Visual layout:**
```text
┌──────────────────────────────────────────┐
│  📅  01/01/26 → 31/01/26           ✕    │  ← single trigger button
└──────────────────────────────────────────┘
         ↓ click opens popover
┌──────────────────────────────────────────┐
│  Presets          │                      │
│  ───────────      │                      │
│  Hoje             │  ◄ Janeiro 2026 ►    │
│  Últimos 7 dias   │  ┌─┬─┬─┬─┬─┬─┬─┐   │
│  Últimos 30 dias  │  │ │ │ │1│2│3│4│   │
│  Este mês         │  │5│6│7│8│9│…│…│   │
│  Mês passado      │  └─┴─┴─┴─┴─┴─┴─┘   │
│  Este trimestre   │                      │
│  Este ano         │  ◄ Fevereiro 2026 ►  │
│                   │  ┌─┬─┬─┬─┬─┬─┬─┐   │
│                   │  │ │ │ │ │ │ │1│   │
│                   │  │…│…│…│…│…│…│…│   │
│                   │  └─┴─┴─┴─┴─┴─┴─┘   │
└──────────────────────────────────────────┘
```

**Key features:**
- Single button trigger showing "De → Até" or placeholder text
- Small "✕" to clear the range without opening
- Dual-month calendar with `mode="range"` for visual range highlighting
- Left sidebar with quick preset buttons (Hoje, Últimos 7d, 30d, Este mês, Mês passado, Trimestre, Ano)
- Portuguese locale (`ptBR`)

### Implementation Steps

1. **Create `src/components/ui/date-range-picker.tsx`** — new reusable component:
   - Props: `label`, `value: { from?: Date; to?: Date }`, `onChange`, `className`
   - Single `Popover` with a wider `PopoverContent`
   - Left panel: preset buttons using `startOfMonth`, `endOfMonth`, `subDays`, etc. from `date-fns`
   - Right panel: `<Calendar mode="range" numberOfMonths={2} selected={...} onSelect={...} />`
   - Trigger button: icon + formatted range or placeholder
   - Clear button (X) on the trigger when range is set

2. **Update `src/pages/Clientes.tsx`**:
   - Remove the inline `DateRangePicker` function (lines 30-59)
   - Import the new component
   - Replace all 4 usages (lines 681-684) with the new component
   - Adapt the `DateRange` type to align with `react-day-picker`'s `DateRange` type (`{ from?: Date; to?: Date }`)

### Technical Details
- Uses `react-day-picker` `mode="range"` which is already installed (v8)
- `numberOfMonths={2}` shows two months side by side
- Presets use `date-fns` functions already available: `startOfMonth`, `endOfMonth`, `subDays`, `startOfYear`, `startOfQuarter`
- PopoverContent width: ~`w-auto min-w-[540px]` to fit preset sidebar + dual calendar
- On mobile (`sm` breakpoint): stack vertically, single month

