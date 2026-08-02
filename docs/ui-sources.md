# UI sources

Records components adapted from approved open-source sources for Issue #14. See `docs/upstream-sources.md` for the separate Circle Agent Stack audit.

## shadcn/ui — Phase A

- Repository: https://github.com/shadcn-ui/ui
- License: MIT
- Usage model: source files are copied and adapted into the application (shadcn/ui is distributed as copyable source, not an npm package), then customized with ProofSpend design tokens.
- Adapted commit/version basis: shadcn/ui "new-york" style conventions as documented on https://ui.shadcn.com at the time of this phase (2026-08-02). No upstream repository content was cloned or vendored; components were hand-adapted from the publicly documented component patterns and re-typed against this project's token names.

### Files adapted in this phase

| File | Upstream primitive | Adaptation |
| --- | --- | --- |
| `apps/web/components/ui/button.tsx` | `button` | Variants remapped to ProofSpend semantic tokens (`primary`, `secondary`, `destructive`, etc.); `icon` size set to `44px` (`size-11`) for touch-target compliance. |
| `apps/web/components/ui/badge.tsx` | `badge` | Added `mock` and `arc-testnet` variants mapped to `--mode-mock` / `--mode-arc-testnet` tokens; all variants render with `tabular-nums`. |
| `apps/web/components/ui/sheet.tsx` | `sheet` (built on Radix `Dialog`) | Used for the mobile navigation drawer; close target sized to `44px`. |
| `apps/web/components/ui/tooltip.tsx` | `tooltip` (built on Radix `Tooltip`) | Default delay and token-based surface colors; not yet consumed by a Phase A screen, added as foundation for later phases. |
| `apps/web/components/ui/separator.tsx` | `separator` (built on Radix `Separator`) | Token-based border color only; no visual customization. |

### Underlying Radix packages (MIT)

`@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-separator`, `@radix-ui/react-slot` — all MIT-licensed, versions pinned in `apps/web/package.json` and `bun.lock`.

### Not used in Phase A

- **Tremor** (financial charts) — deferred to Phase C, once real reserve/spend domain data exists (Issues #3/#4). No chart components were added in this phase.
- **Magic UI** (marketing motion) — deferred to Phase B (public landing page). No Magic UI source was copied in this phase.
- **shadcn-admin** — reference-only per Issue #14; not forked or copied. Only used as informal inspiration for the collapsible-sidebar-plus-header composition described in Issue #14, re-implemented independently against ProofSpend's own routes and tokens.

## ProofSpend-owned code

`ModeBadge`, `RoleBadge`, `AppShell`, `DesktopSidebar`, `MobileNav`, `TopHeader`, `PlaceholderPanel`, and all placeholder route pages under `apps/web/app/app/**` and `apps/web/app/proof/**` are original ProofSpend product code, not adapted from any third-party source.
