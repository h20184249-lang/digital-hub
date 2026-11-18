# DIGITAL HUB — Digital Products & Services Marketplace

Full-stack TypeScript marketplace application built with **React 19**, **Vite 8**, **Tailwind CSS v4**, **Express**, **Cloudflare Workers with Static Assets**, **Firebase (Auth & Firestore)**, and **Capacitor Android**.

---

## Features

- **Digital Marketplace & Catalog**: Multi-category digital products, subscription packages, gift cards, gaming top-ups, and bilingual UI support (`bn` / `en`).
- **Payment Gateways (`bKash`, `Nagad`, `Rocket`) & Wallet**:
  - Official vector payment brand logos (`public/assets/payments/`) and responsive gateway cards.
  - Manual payment submission with Transaction ID (`TxID`) server validation and screenshot upload preview.
  - Wallet ledger, Add Money deposits, withdrawal requests, promo credits, cashback, and referral rewards.
- **Watch & Earn + Ad Network Management**: Rewarded ad claims, verified viewing sessions, coin-to-BDT redemption, and 24+ ad placement configurations.
- **Admin Dashboard**: Order fulfillment, unified Payment Control & History (gateway settings, custom logo uploads, full-size screenshot lightbox, approve/reject workflows), package/product/category management, and audit logs.
- **Unified Free Cloudflare Hosting**: Serves both the Vite SPA (`dist/`) and all 31 Express `/api/*` backend routes on a single Cloudflare Workers domain via `wrangler.jsonc` (`worker.ts` + Static Assets).
- **Android Mobile Support (`Capacitor 8`)**: Native Android project configured in `android/` (`com.digitalhub.marketplace`) with splash screen, status bar styling, media upload permissions, and remote API URL routing (`VITE_API_BASE_URL`).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Lucide Icons, Motion
- **Backend API**: Express (`server/apiApp.ts`) hosted natively on **Cloudflare Workers** (`worker.ts` via `cloudflare:node`) and **Node.js** (`server.ts`)
- **Database & Auth**: Firebase Authentication & Cloud Firestore (`firestore.rules`, `firebase-blueprint.json`)
- **Mobile**: Capacitor 8 (`capacitor.config.ts`, `android/`)

---

## Project Structure

```text
.
├── android/                   # Capacitor Android native project
├── public/
│   ├── _headers               # Cloudflare static security & cache headers
│   ├── robots.txt
│   ├── sitemap.xml
│   └── assets/
│       ├── brands/            # Brand SVG icons
│       ├── payments/          # Official bKash, Nagad, Rocket SVG logos
│       └── products/          # Product catalog images
├── server/
│   ├── apiApp.ts              # Shared Express `/api/*` backend (Node.js + Cloudflare Workers)
│   └── workerShims/
│       └── iconvLite.ts       # Web-standard TextDecoder shim for Cloudflare Workers (`workerd`)
├── src/
│   ├── assets/images/         # Bundled marketplace artwork
│   ├── components/            # React UI components & Admin/Customer dashboards
│   ├── lib/                   # Firebase client, API client, catalog, i18n, seed helpers
│   ├── types/                 # Shared TypeScript interfaces
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   └── vite-env.d.ts
├── .env.example               # Environment variable & Cloudflare secrets template
├── .gitignore
├── bun.lock                   # Synchronized Bun lockfile (Bun 1.4.4)
├── capacitor.config.ts
├── eslint.config.js
├── firebase-applet-config.json
├── firebase-blueprint.json
├── firestore.rules
├── index.html
├── metadata.json
├── package.json
├── server.ts                  # Local dev & Node.js server entry point (port 3000)
├── tsconfig.json
├── vite.config.ts
├── worker.ts                  # Cloudflare Workers entry point (`cloudflare:node`)
├── worker-env.d.ts            # TypeScript ambient module declarations for `cloudflare:node`
└── wrangler.jsonc             # Unified Cloudflare Workers + Static Assets configuration
```

---

## Getting Started

### 1. Prerequisites

- **Bun** `1.4.4` (recommended — matches `bun.lock` and Cloudflare Builds) or **Node.js** `>= 20`
- A **Firebase** project with Authentication (Email/Password & Google Sign-In) and Cloud Firestore enabled
- *(Optional for APK builds)* **JDK 21** and **Android SDK / Android Studio**

### 2. Install Dependencies

```bash
bun install --frozen-lockfile
```

Or with npm:

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` for local Node.js development (or `.dev.vars` for local `wrangler dev`). Never commit `.env` or `.dev.vars` to GitHub:

```bash
cp .env.example .env
```

### 4. Run in Development

Starts Express (`server.ts`) with Vite middleware on port `3000`:

```bash
npm run dev
```

Open `http://localhost:3000`.

### 5. Typecheck, Build & Cloudflare Dry-Run Check

```bash
bun run lint
bun run build
bun run cf:check
```

---

## Automated Free Deployment on Cloudflare (GitHub CI/CD)

DIGITAL HUB is preconfigured for **Cloudflare Workers with Static Assets** (`wrangler.jsonc`), which publishes **both** the React/Vite frontend (`./dist`) and all 31 Express `/api/*` backend routes on **one free Cloudflare domain** with automatic redeploys whenever commits are pushed to GitHub (`h20184249-lang/digital-hub`, branch `main`).

### One-Time Cloudflare Dashboard Setup

1. Open **Cloudflare Dashboard → Compute (Workers) → Workers & Pages → Create → Import a repository**.
2. Authorize GitHub and select repository **`h20184249-lang/digital-hub`** (branch: **`main`**).
3. Configure **Builds & deployments**:
   - **Project / Worker name:** `digital-hub` (matches `wrangler.jsonc`)
   - **Build command:** `bun run build`
   - **Deploy command:** `bun run deploy` *(or `npx wrangler deploy`)*
   - **Root directory:** `/` *(leave empty / repository root)*
4. Add **Build Environment Variable**:
   - `BUN_VERSION` = `1.4.4`
   - *(Leave `VITE_API_BASE_URL` unset/blank so the frontend automatically calls same-origin `/api/*` on your Cloudflare Worker.)*
5. After the first deploy, add **Runtime Secrets** in **Workers & Pages → `digital-hub` → Settings → Variables and Secrets**:
   - `APP_URL` = `https://<your-worker-domain>` *(e.g. `https://digital-hub.<subdomain>.workers.dev`)*
   - `ALLOWED_CORS_ORIGINS` = `https://<your-worker-domain>` *(comma-separated if also using a custom domain)*
   - `WATCH_EARN_S2S_SECRET` *(random 32-byte hex secret for S2S ad postbacks)*
   - *(Optional)* `AD_POSTBACK_SECRET_AFDERS`, `AD_POSTBACK_SECRET_ARWF`, `AD_POSTBACK_SECRET_BICEA`, `AD_POSTBACK_SECRET_AUCTIONR`, `AD_POSTBACK_SECRET_ASIAFILM`
   - *(Optional)* `SUPER_ADMIN_EMAIL` *(only if overriding the default Super Admin email)*
6. **Authorize your Cloudflare domain in Firebase Auth**:
   - Open **Firebase Console → Authentication → Settings → Authorized domains → Add domain**.
   - Add your `digital-hub.<subdomain>.workers.dev` domain (and custom domain if configured) so Google Sign-In popups work without `auth/unauthorized-domain`.

Every future update synced from Google AI Studio to GitHub `main` will automatically trigger Cloudflare Builds (`bun install --frozen-lockfile` → `bun run build` → `wrangler deploy`).

---

## Build Android APK (Capacitor)

```bash
VITE_API_BASE_URL="https://<your-cloudflare-worker-domain>" bun run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The debug APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
