# Qafilah design system

## Direction

Operate mode: a quiet, precise merchant workspace. The supplied brief pins the visual direction; implementation proceeds directly within it. Small typography, clear grouping and density carry the product. Warm mineral neutrals and a deep evergreen action color give Qafilah an original, restrained identity.

## Tokens and geometry

Use semantic CSS variables exposed as Tailwind theme colors: background, surface, surface-subtle, border, text, text-muted, brand, brand-subtle, success, warning, danger, info and focus. State colors have matching quiet surface tokens. Fonts use the native system sans family; numbers are tabular. Body 14px, headings 20–24px, controls 13–14px. Four-pixel spacing rhythm, six-pixel control radius, eight-pixel grouped surfaces. No decorative shadows.

Desktop navigation is 228px wide; the top bar is 60px. Content is constrained to 1260px for operations and narrower for forms. Tablet/mobile use an accessible sheet with 44px touch targets. Logical spacing and start/end alignment retain RTL readiness.

## Interaction

Visible focus, concise labels, inline validation with first-invalid focus, native form semantics, explicit pending controls, bounded error recovery, and focus-trapped dialogs. Reduced motion disables optional transitions. No fake search, notifications, user identity or store switcher choices.

## Foundation state

Production renders an honest connection-unavailable login surface until contracts are verified. Development-only component review renders the shell and representative table/detail/form/state patterns with a persistent notice. It never represents an authenticated user or live merchant data.
