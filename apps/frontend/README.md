# Travel Assistant chat

WhatsApp-style React chat UI built with Vite and Tailwind CSS. The development server proxies `/api` requests to the Express backend at `http://localhost:3000`.

## Run locally

1. Start the backend and MongoDB.
2. From the repository root, run `pnpm --filter frontend dev`.
3. Open the local URL printed by Vite, usually `http://localhost:5173`.

The chat posts messages to `POST /api/webhook/mock` using the demo phone number `919999999999`. Bot replies and optional quick-reply buttons are rendered in the conversation.

## Checks

- `pnpm --filter frontend lint`
- `pnpm --filter frontend build`
