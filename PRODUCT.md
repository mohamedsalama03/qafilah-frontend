# Qafilah Merchant Dashboard

Qafilah is a multi-tenant commerce SaaS. Merchants and authorized staff use the dashboard to operate their stores. Laravel owns authentication, membership, permissions, validation and all commerce state. The frontend is a presentation and interaction layer.

## Scope and authority

Phase F1 establishes the architecture, original design system, application shell and representative patterns. The supplied 525-section F1 brief is the authority. No backend changes, invented contracts, real high-impact mutations, customer storefront, platform administration, Arabic localization, analytics or F2 work are authorized.

The inspected frontend folder was empty, with no Git repository, project configuration or incumbent visual assets. No Laravel source or API documentation was found in its parent. Live integration must remain unavailable until authoritative contracts can be inspected. Development component examples are explicitly separated and excluded from production.

## Audience and use

Merchant operations prioritize accurate state, compact readable information, predictable navigation, keyboard access and clear recovery. Desktop is primary; tablet and mobile must remain functional. No business data, identity, store membership or permission is assumed.

## Confirmed visual direction

Original Qafilah interface inspired by Shopify Admin's usability discipline. Light neutral surfaces, subtle borders, small radii, compact controls and tables, restrained icons and a single controlled brand accent. No cloning, proprietary assets, gradients, marketing heroes, fake charts, fake metrics, unsupported navigation or decorative motion.

## Stack

Next.js App Router, React, strict TypeScript, Tailwind CSS. TanStack Query owns server-state caching. React Hook Form and Zod support presentation validation. Semantic HTML and accessible overlay primitives support keyboard interactions. pnpm is the package manager.

## Deliberately unresolved

Actual authentication routes and identity shapes, CSRF cookie/header contract, approved frontend/API origins, cookie deployment policy, store/membership/permission authority, resource routes and pagination. These are integration blockers, not product decisions for the frontend to invent.
