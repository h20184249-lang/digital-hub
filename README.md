# DIGITAL HUB — Digital Products & Services Marketplace

Full-stack TypeScript marketplace application built with **React 19**, **Vite**, **Tailwind CSS v4**, **Express**, **Firebase (Auth & Firestore)**, and **Capacitor Android**.

---

## Features

- **Digital Marketplace & Catalog**: Multi-category digital products, subscription packages, gift cards, gaming top-ups, and bilingual UI support (`bn` / `en`).
- **Payment Gateways (`bKash`, `Nagad`, `Rocket`) & Wallet**:
  - Official vector payment brand logos (`public/assets/payments/`) and responsive gateway cards.
  - Manual payment submission with Transaction ID (`TxID`) server validation and screenshot upload preview.
  - Wallet ledger, Add Money deposits, withdrawal requests, promo credits, cashback, and referral rewards.
- **Watch & Earn + Ad Network Management**: Rewarded ad claims, verified viewing sessions, coin-to-BDT redemption, and 24+ ad placement configurations.
- **Admin Dashboard**: Order fulfillment, unified Payment Control & History (gateway settings, custom logo uploads, full-size screenshot lightbox, approve/reject workflows), package/product/category management, and audit logs.
- **Android Mobile Support (`Capacitor 8`)**: Native Android project configured in `android/` (`com.digitalhub.marketplace`) with splash screen, status bar styling, media upload permissions, and remote API URL routing (`VITE_API_BASE_URL`).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, Lucide Icons, Motion
- **Backend**: Node.js, Express (`server.ts`), TSX
- **Database & Auth**: Firebase Authentication & Cloud Firestore (`firestore.rules`, `firebase-blueprint.json`)
- **Mobile**: Capacitor 8 (`capacitor.config.ts`, `android/`)

---

## Project Structure

```text
.
├── android/                   # Capacitor Android native project
├── public/
│   └── assets/
│       ├── brands/            # Brand SVG icons
│       ├── payments/          # Official bKash, Nagad, Rocket SVG logos
│       └── products/          # Product catalog images
├── src/
│   ├── assets/images/         # Bundled marketplace artwork
│   ├── components/            # React UI components & Admin/Customer dashboards
│   ├── lib/                   # Firebase client, API client, catalog, i18n, seed helpers
│   ├── types/                 # Shared TypeScript interfaces
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .env.example               # Environment variable template (copy to .env)
├── .gitignore
├── capacitor.config.ts
├── eslint.config.js
├── firebase-applet-config.json
├── firebase-blueprint.json
├── firestore.rules
├── index.html
├── metadata.json
├── package.json
├── server.ts                  # Express backend & Vite dev server entry point
├── tsconfig.json
└── vite.config.ts
```

---

## Getting Started

### 1. Prerequisites

- **Node.js** `>= 20` and **npm**
- A **Firebase** project with Authentication (Email/Password & Google Sign-In) and Cloud Firestore enabled
- *(Optional for APK builds)* **JDK 21** and **Android SDK / Android Studio**

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your values (never commit `.env` to GitHub):

```bash
cp .env.example .env
```

Environment variables documented in `.env.example`:
- `GEMINI_API_KEY` — Optional server-side Gemini API key if using AI routes.
- `APP_URL` — Public origin URL of your deployed backend/server.
- `VITE_API_BASE_URL` — Backend API base URL used by native Capacitor Android builds.

Configure your Firebase web credentials in `firebase-applet-config.json` to match your Firebase project if deploying to a new project.

### 4. Run in Development

Starts Express (`server.ts`) with Vite middleware on port `3000`:

```bash
npm run dev
```

Open `http://localhost:3000`.

### 5. Typecheck, Build & Production Start

```bash
npm run lint
npm run build
npm start
```

### 6. Build Android APK (Capacitor)

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The debug APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
