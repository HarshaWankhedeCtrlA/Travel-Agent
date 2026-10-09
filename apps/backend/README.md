# Travel Agent API

Simple Node.js, Express, and MongoDB backend for the travel-agent project.

## Run locally

1. Install dependencies from the repository root with `pnpm install`.
2. Start MongoDB with `pnpm db:up` (Docker required).
3. Copy `apps/backend/.env.example` to `apps/backend/.env`.
4. Start the API with `pnpm --filter @travel-agent/backend dev`.

The API listens on `http://localhost:3000` by default. Check `GET /api/health` to see the API and MongoDB connection status.

## Trips API

- `GET /api/trips` — list trips
- `POST /api/trips` — create a trip
- `GET /api/trips/:id` — get a trip
- `PATCH /api/trips/:id` — update a trip
- `DELETE /api/trips/:id` — delete a trip

A trip requires `title`, `destination`, `startDate`, and `endDate`. `budget` is optional and must be non-negative.

Run the backend checks with `pnpm --filter @travel-agent/backend lint` and `pnpm --filter @travel-agent/backend test`.
