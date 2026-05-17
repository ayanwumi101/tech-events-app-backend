# EventScout Backend

This folder contains the backend service for EventScout.

## Stack

- Fastify (HTTP API)
- Prisma + PostgreSQL (data)
- JWT access/refresh auth
- OTP-based email verification flow
- Scheduled AI ingestion pipeline (web/blog/social scraping + OpenAI/Gemini extraction)
- Cloudinary image upload for scraped event images
- Expo push notification support

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client and migrate:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Start backend:

```bash
npm run dev
```

Backend base URL: `http://localhost:4000/api/v1`

## Core API Groups

- `POST /auth/signup`
- `POST /auth/resend-otp`
- `POST /auth/verify-email`
- `POST /auth/forgot-password/request-otp`
- `POST /auth/forgot-password/reset`
- `POST /auth/signin`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `PATCH /auth/onboarding`
- `PATCH /auth/theme`

- `GET /events`
- `GET /events/:id`
- `POST /events/:id/favorite`
- `PATCH /events/:id/attendance`
- `GET /events/history`
- `POST /events/:id/feedback`
- `GET /events/:id/deep-link`

- `GET /notifications`
- `PATCH /notifications/:id/read`
- `POST /notifications/read-all`

- `GET /profile`
- `PATCH /profile`

- `POST /ingestion/run`
- `GET /ingestion/runs`
- `GET /ingestion/sources`
- `POST /ingestion/sources`
- `PATCH /ingestion/sources/:id/toggle`

- `POST /push/register-token`
- `DELETE /push/register-token`
- `POST /push/test`

## Notes

- In development, OTP values are returned as `devOtpPreview` for faster testing.
- Default ingestion provider is `gemini`. You can override with `AI_PROVIDER=openai`.
- Add `GEMINI_API_KEY` (or `OPENAI_API_KEY` if using OpenAI) in `.env` to enable provider-backed extraction.
- Without provider keys, fallback extraction keeps the pipeline functional.
- For real OTP emails, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in `.env`.
- To upload scraped images, set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- Scraping behavior is controlled with `SCRAPE_REQUEST_TIMEOUT_MS`, `SCRAPE_MAX_LINKS_PER_SOURCE`, and `SCRAPE_MAX_SOURCES_PER_RUN`.
- Optional discovery API keys:
  - `EVENTBRITE_API_TOKEN`
  - `MEETUP_API_KEY`
  - `SERPAPI_API_KEY`
  - `BRAVE_SEARCH_API_KEY`
  - `X_API_BEARER_TOKEN`
- Validation controls:
  - `INGESTION_USE_AI_VALIDATION` (default `true`)
  - `INGESTION_VALIDATION_MIN_SCORE` (default `0.6`)
