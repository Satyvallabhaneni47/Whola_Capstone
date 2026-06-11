Middleware README
Overview
-------------
Purpose: Receive events from the browser extension, upsert or update HubSpot contacts, and create timeline notes (engagements).
Location: Middleware/ (contains package.json, src/, and a constants.js file used to store API tokens and endpoints).

Quick Start
-------------------
Clone or open the repo


Install dependencies
----------------------
bash
npm install


Change the hubspot token in  constants.js.

Run the service
-------------------
node .\server.js 
Confirm the server is running  
Open http://localhost:4000 (or the port you configured).


# Whola × HubSpot Integration Middleware

> **Version:** 0.0.23  
> **Platform:** Node.js / Express  
> **Purpose:** Real-time behavioural event capture from the Whola VTEX storefront, processed and synchronised into HubSpot CRM automatically.

---

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Required Libraries](#required-libraries)
6. [Installation](#installation)
7. [Configuration](#configuration)
8. [Running the Server](#running-the-server)
9. [Available Routes](#available-routes)
10. [Environment Variables](#environment-variables)
11. [Verifying the Server](#verifying-the-server)
12. [Troubleshooting](#troubleshooting)

---

## Overview

This middleware is a standalone Node.js/Express server that sits between the Whola VTEX storefront and HubSpot CRM. It receives customer behaviour events (login, logout, product views, cart changes, brand visits, orders) from a Chrome Extension running on the Whola website, processes and deduplicates them, and synchronises structured activity data into HubSpot — creating or updating contacts, posting timeline notes, and linking `brand_view` custom objects automatically.

---

## How It Works

```
Chrome Extension (browser)
        │
        │  POST JSON payload
        ▼
Middleware Server (this repo — localhost:4000)
        │
        ├── Validates & classifies the event
        ├── Computes cart delta (what changed)
        ├── Deduplicates (suppresses repeated events)
        │
        ├──► HubSpot CRM API  (contacts, notes, brand_view objects)
        └──► VTEX Masterdata  (event logs, dedupe records)
```

---

## Project Structure

```
node/
├── server.js                  # Express server — all route registrations
├── service.json               # VTEX IO route configuration
├── package.json               # Dependencies
│
├── middlewares/
│   ├── CartEvents.js          # Login, logout, cart add/remove, product view
│   ├── ProductView.js         # Dedicated product page view handler
│   ├── PageViews.js           # Brand/category/general page view handler
│   ├── OrdersHook.js          # VTEX order webhook (payment, invoice, cancel)
│   ├── AbandonedCart.js       # VTEX abandoned cart webhook
│   ├── HubspotService.js      # Core HubSpot integration (contacts, notes)
│   ├── BrandViewService.js    # brand_view custom object creation
│   ├── HubSpotClient.js       # Low-level HubSpot API client helpers
│   ├── VtexService.js         # VTEX API helpers (orders, profiles)
│   ├── ping.js                # Health check handler
│   └── rawCaptureLogger.js    # Raw event payload logger
│
├── util/
│   ├── constants.js           # ⚠️  API tokens & endpoint URLs (update before deploy)
│   ├── logger.js              # Structured JSON logger with log-level filtering
│   ├── messageId.js           # Per-request unique ID generator
│   ├── pageTypeDetection.js   # Detects product / brand / category page type
│   └── logs.js                # VTEX Masterdata logging helpers
│
└── general/
    ├── CartItem.js            # Cart item data model
    ├── Deal.js                # HubSpot deal data model
    ├── OrderItem.js           # Order item data model
    └── Result.js              # Standard result wrapper
```

---

## Prerequisites

Ensure the following are installed on the server before proceeding:

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Node.js | 12.x or higher | `node --version` |
| npm | 6.x or higher | `npm --version` |

---

## Required Libraries

### Core Dependencies (`package.json`)

| Library | Version | Purpose |
|---|---|---|
| `axios` | ~0.24.0 | All HTTP calls to HubSpot API and VTEX APIs |
| `co-body` | ^6.0.0 | Request body parsing |
| `form-data` | ^4.0.0 | Multipart form data for API calls |
| `ramda` | ^0.25.0 | Functional utility helpers |

### Additional Runtime Dependencies

These are used in the code but must be installed separately as they are not listed in `package.json`:

| Library | Version | Purpose |
|---|---|---|
| `express` | ^4.x | HTTP server framework and route registration |
| `cors` | ^2.x | Cross-Origin Resource Sharing headers (required for Chrome Extension) |
| `fast-deep-equal` | ^3.1 | Cart delta comparison in CartEvents.js |

---

## Installation

### Step 1 — Clone or copy the project

```bash
git clone <your-repo-url>
cd whola-integration-app/node
```

### Step 2 — Install all dependencies

```bash
npm install
```

### Step 3 — Install additional runtime dependencies

```bash
npm install express cors fast-deep-equal
```

### Step 4 — Verify installation

```bash
node -e "require('express'); require('cors'); require('fast-deep-equal'); console.log('All dependencies OK')"
```

You should see: `All dependencies OK`

---

## Configuration

### ⚠️ Important — Update API Tokens Before Running

Open `node/util/constants.js` and update the following values with the client's credentials:

```js
// VTEX credentials
exports.BASE_URL_SHIPOP = 'http://<your-vtex-store>.vtexcommercestable.com.br/';
exports.BASE_URL_PRICE  = 'https://api.vtex.com/<your-vtex-account>/';
exports.VTEX_API_KEY    = '<your-vtex-api-key>';
exports.VTEX_API_TOKEN  = '<your-vtex-api-token>';

// HubSpot Private App Token
// Generate at: HubSpot → Settings → Integrations → Private Apps
exports.HUBSPOT_TOKEN   = '<your-hubspot-private-app-token>';
```

### HubSpot Private App — Required Scopes

When creating the HubSpot Private App, enable the following scopes:

| Scope | Required For |
|---|---|
| `crm.objects.contacts.read` | Searching existing contacts |
| `crm.objects.contacts.write` | Creating and updating contacts |
| `crm.objects.deals.read` | Reading existing deals |
| `crm.objects.deals.write` | Creating and updating deals |
| `crm.objects.custom.read` | Reading brand_view objects |
| `crm.objects.custom.write` | Creating brand_view objects |
| `crm.schemas.custom.read` | Reading custom object schemas |
| `timeline` | Posting timeline notes to contacts |

### VTEX API Keys

Generate at: **VTEX Admin → Account Settings → Account → API Keys**

Required permissions:
- OMS Viewer
- Masterdata read/write (`ADMIN_DS`, `POWER_USER_DS`)

---

## Running the Server

### Development (standard)

```bash
cd node
node server.js
```

Expected output:
```
[SERVER] HubspotService loaded, sendCartToHubSpot type: function
 Local integration server running at http://localhost:4000
```

### Development (with garbage collection tracing)

```bash
node --trace-gc server.js
```

### Production (with process monitoring — recommended)

```bash
npm install -g pm2
pm2 start server.js --name whola-hubspot-middleware
pm2 save
pm2 startup
```

### Custom Port

```bash
PORT=5000 node server.js
```

The server defaults to port **4000** if `PORT` is not set.

---

## Available Routes

Once running, the following endpoints are active at `http://localhost:4000`:

| Method | Route | Handler | Purpose |
|---|---|---|---|
| `POST` | `/_v/orders` | `OrdersHook.js` | VTEX order webhook (payment-approved, invoiced, cancelled) |
| `POST` | `/_v/abandoned-cart-custom` | `AbandonedCart.js` | VTEX abandoned cart webhook |
| `POST` | `/_v/cart-events` | `CartEvents.js` | Login, logout, cart changes, product view events |
| `POST` | `/_v/product-view` | `ProductView.js` | Dedicated product page view events |
| `POST` | `/_v/page-views` | `PageViews.js` | Brand page, category page, general page views |
| `POST` | `/events` | `server.js` | Direct fire-and-forget route from Chrome Extension |
| `GET`  | `/_v/whola-integration-app/ping` | `ping.js` | Health check — returns `{ response: "pong" }` |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port the server listens on |
| `LOG_LEVEL` | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |

### Setting log level

```bash
# Show all logs including debug traces
LOG_LEVEL=DEBUG node server.js

# Production — show warnings and errors only
LOG_LEVEL=WARN node server.js
```

Log entries are structured JSON:
```json
{
  "timestamp": "2026-06-01T10:23:45.123Z",
  "level": "INFO",
  "service": "CartEvents",
  "messageID": "1748779425123-abc4x2",
  "eventLabel": "Login",
  "api": "route:CartEvents",
  "msg": "Route hit"
}
```

---

## Verifying the Server

### 1. Ping check

```bash
curl http://localhost:4000/_v/whola-integration-app/ping
```

Expected response:
```json
{ "response": "pong" }
```

### 2. Test a cart event manually

```bash
curl -X POST http://localhost:4000/_v/cart-events \
  -H "Content-Type: application/json" \
  -d '{
    "customerProperties": {
      "email": "test@example.com",
      "firstName": "Test",
      "lastName": "User",
      "lastActivityType": "Login"
    },
    "cartProperties": { "items": [] },
    "pageUrl": "https://whola.com.au"
  }'
```

Expected response:
```json
{ "ok": true }
```

Check the server console — you should see structured log entries showing the event was processed and a HubSpot note was created.

### 3. Verify in HubSpot

Open HubSpot → Contacts → search for `test@example.com` → check the Activity Timeline for the login note.

---

## Troubleshooting

| Issue | Likely Cause | Fix |
|---|---|---|
| `Cannot find module 'express'` | express not installed | Run `npm install express cors fast-deep-equal` |
| `Cannot find module 'fast-deep-equal'` | fast-deep-equal not installed | Run `npm install fast-deep-equal` |
| `401 Unauthorized` from HubSpot | Invalid or expired token | Regenerate the Private App token in HubSpot and update `constants.js` |
| `403 Forbidden` from HubSpot | Missing API scope | Add the missing scope to the HubSpot Private App |
| `ping` returns 404 | Server not running or wrong port | Check `node server.js` output, confirm port matches |
| Events received but no HubSpot note | Missing email in payload | Confirm `customerProperties.email` is present in the event payload |
| `ECONNREFUSED` on port 4000 | Server crashed on startup | Check console for error — likely a missing dependency or constants issue |

---

## Notes for the Client

- **Never commit `constants.js` with real tokens to a public repository.** Move credentials to environment variables using `dotenv` before any public deployment.
- The server is designed to run as a long-running process behind a reverse proxy (nginx or similar) in production.
- All HubSpot API calls include a 10-second timeout. If HubSpot is unreachable, events are not retried — check logs for `WARN` or `ERROR` entries.
- The Chrome Extension must point to this server's URL. Update the middleware URL in the extension's background script before deploying to a new environment.
