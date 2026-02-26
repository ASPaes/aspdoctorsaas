

## Plan: Persistent Filters, In-Form Navigation, and State Preservation

### Problem Summary
1. Filters reset when navigating away and back
2. No way to navigate between client records from within the edit form
3. Clicking a client row always navigates in the same tab (no Cmd+Click support)
4. React Query refetches on every mount, losing scroll/page position

### Implementation Steps

#### 1. Create a shared filter store with `sessionStorage` persistence
- Create `src/hooks/useClientesFilters.ts` — a custom hook using `useState` + `sessionStorage`
- Store all filter values (search, status, dates, selects, ranges, sort, page, filtersOpen) as a single JSON object in `sessionStorage` under key `clientes-filters`
- On init: read from `sessionStorage`; on every change: write back
- This solves items 1 and 4 — filters survive navigation

#### 2. Persist filtered client IDs for in-form navigation
- When the Clientes list loads data, store the ordered array of client IDs in `sessionStorage` under key `clientes-nav-ids`
- In `ClienteForm.tsx`, read this array and find the current client's position
- Add "Previous" / "Next" buttons (with `ChevronLeft`/`ChevronRight` icons) in the form header, navigating to `/clientes/{prevId}` and `/clientes/{nextId}`
- Show position indicator like "3 / 47"
- Disable buttons at boundaries

#### 3. Enable Cmd+Click (open in new tab)
- In `Clientes.tsx`, change the table row click handler from `onClick={() => navigate(...)}` to use an `<a>` tag or handle the click event to check for `metaKey`/`ctrlKey`:
  ```tsx
  onClick={(e) => {
    if (e.metaKey || e.ctrlKey) {
      window.open(`/clientes/${c.id}`, '_blank');
    } else {
      navigate(`/clientes/${c.id}`);
    }
  }}
  ```
- Also wrap the row content in a way that right-click "Open in new tab" works (wrap row in `<Link>` or add `href`)

#### 4. Prevent unnecessary refetches
- The `QueryClient` already has `staleTime: 5min` and `refetchOnWindowFocus: false`
- Ensure the `queryKey` in Clientes uses the persisted filter state so React Query cache matches on return
- The key fix is item 1 (persisted filters) — without it, filters reset to defaults which creates a new queryKey, triggering a refetch

### Files to Create/Edit
- **Create** `src/hooks/useClientesFilters.ts` — persistent filter state hook
- **Edit** `src/pages/Clientes.tsx` — use the new hook instead of individual `useState`; store nav IDs; handle Cmd+Click
- **Edit** `src/pages/ClienteForm.tsx` — add prev/next navigation buttons reading from sessionStorage

