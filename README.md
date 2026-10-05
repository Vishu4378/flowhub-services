# FlowHub API

Multi-tenant backend for FlowHub: accounts, organizations with roles,
invitations, projects, plans and Stripe billing, notifications and an activity
log. The web app lives in the sibling repo
[flowhub.com](https://github.com/Vishu4378/flowhub.com).

NestJS 12 · MongoDB (Mongoose 9) · Stripe · AWS SES · Vitest

## Getting started

Requires Node 22+ and pnpm.

```bash
cp .env.example .env          # then fill in MONGODB_URI and JWT_SECRET
pnpm install
pnpm start:dev                # http://localhost:3000, Swagger at /docs
```

Everything except Mongo and `JWT_SECRET` is optional in development:

| Variable | Without it |
|---|---|
| `MAIL_FROM` (+ AWS credentials) | Emails are logged to the console, links included |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` | Paid plans show as unavailable; billing endpoints return 503 |
| `STRIPE_WEBHOOK_SECRET` | The Stripe webhook returns 503 |
| `OBSERVE_APP_KEY` | Observe telemetry is off |
| `SUPER_ADMIN_EMAILS` | Nobody can open the platform admin (`/app/admin`) |

`APP_URL` is the web app's public URL, used to build links in emails and Stripe
redirects. `CORS_ORIGIN` only matters if browsers call the API directly; the
web app proxies `/api` through its own origin.

### Docker

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

## Tests

```bash
pnpm test        # unit tests
pnpm test:e2e    # boots the whole app against an in-memory MongoDB
pnpm lint
```

The e2e suite never touches a real database or Stripe: it starts
`mongodb-memory-server`, stubs Stripe's network calls, and sends webhooks
signed exactly like Stripe does. Emailed links are read from
`MailService.outbox`.

## Architecture

All routes are under `/api` except `/health`. Every route needs a bearer token
unless marked `@Public()`.

```
src/
├── main.ts / app.setup.ts     # bootstrap; validation, CORS, /api prefix, error mapping
├── app.module.ts              # wires everything; rate limiting; optional Observe
├── common/
│   ├── events/                # domain event names and payloads
│   ├── decorators/            # @Public, @Roles, @CurrentUser, @CurrentOrg
│   ├── guards/                # JwtAuthGuard (global)
│   ├── filters/               # Mongo duplicate key → 409
│   ├── pipes/                 # ParseObjectIdPipe
│   └── utils/                 # password hashing, tokens, slugs, app URLs
├── database/
│   ├── tenant-scope.plugin.ts # refuses tenant queries that don't filter by organizationId
│   └── to-json.plugin.ts      # id instead of _id; strips select:false fields
├── mail/                      # MailService (SES or console) + templates
└── modules/
    ├── auth/                  # register, login, email verification, password reset
    ├── users/                 # profile
    ├── organizations/         # orgs, members, roles, invitations; TenancyModule + OrgMemberGuard
    ├── projects/              # tenant-scoped CRUD with plan limits
    ├── billing/               # plan catalog, subscriptions, limits, checkout and portal
    ├── payments/              # Stripe client, webhook, payment ledger
    ├── notifications/         # in-app (+ email) notifications from domain events
    ├── analytics/             # activity log from domain events, overview stats
    ├── admin/                 # super admin: all orgs/users, suspend, delete, global audit log
    └── health/
```

Key ideas:

- **Tenancy.** Tenant data carries `organizationId` and uses `tenantScopePlugin`, so a
  query that forgets the tenant filter throws instead of leaking data. Org routes
  look like `/organizations/:orgId/...` and use `OrgMemberGuard`, which 404s for
  non-members and checks `@Roles()`.
- **Events, not imports.** Feature services emit domain events
  (`project.created`, `member.joined`…). Notifications and analytics listen, so
  features never depend on them.
- **Billing.** Plans and limits live in `billing/plans.ts`. Stripe is the source of
  truth: checkout and portal are Stripe-hosted, and subscription state arrives via
  `POST /api/payments/webhooks/stripe`. Payments reports normalized
  `payments.subscription_synced` events, so another provider (Razorpay) can plug in
  without touching billing.

### Stripe setup

1. Create two recurring prices (Pro, Business) and put their ids in
   `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS`. Keep `priceMonthly` in
   `billing/plans.ts` in sync with them; it's what the pricing page shows.
2. Add a webhook endpoint for `https://<api>/api/payments/webhooks/stripe` with
   `customer.subscription.created|updated|deleted`, `invoice.paid` and
   `invoice.payment_failed`, then set `STRIPE_WEBHOOK_SECRET`.
3. Enable the customer portal in the Stripe dashboard (plan switching, cancel).

Locally: `stripe listen --forward-to localhost:3000/api/payments/webhooks/stripe`.

### Super admin

Platform owners are listed in `SUPER_ADMIN_EMAILS` (comma-separated). It lives
in config, not the database, so no API call can grant it. `/api/admin/*` reads
across every tenant with `skipTenantScope`; suspending an organization makes
`OrgMemberGuard` answer 403 `ORG_SUSPENDED` for all of its routes.

## Build plan: what's next

CRUD, dashboards and the admin panel are done. The remaining phases of the
FlowHub Build Plan are the backend-engineering core:

| Phase | Where to start |
|---|---|
| 3 · Project API keys | `ProjectsService.rotateApiKey` (stub returns 501), schema fields in `project.schema.ts`, UI card already wired |
| 2 · `x-org-api-key` resolution | a new guard next to `common/guards/jwt-auth.guard.ts` |
| 2 · Refresh tokens + logout | `AuthService.session()` / `JwtAuthGuard` |
| 4 · Redis (cache, rate limit, blacklist) | replaces the in-memory `ThrottlerModule` storage in `app.module.ts` |
| 4.5 · Monthly API-call quotas | alongside `BillingService.assertWithinLimit` |
| 5 · SQS email queue + DLQ | `MailService.send` becomes a producer |
| 6 · Kafka | `EventEmitter2` emits in services → Kafka producer; listeners → consumers |
| 7 · Webhook event-ID idempotency | `PaymentsController.stripeWebhook` |
| 8 · Prometheus / Grafana | new `/metrics` endpoint |
| 9 · CI/CD, EC2, Nginx | repo root |

### Adding a feature module

```bash
pnpm exec nest g module modules/<feature>
pnpm exec nest g controller modules/<feature>
pnpm exec nest g service modules/<feature>
```

Give tenant-owned schemas an `organizationId` and `schema.plugin(tenantScopePlugin)`,
guard org routes with `@UseGuards(OrgMemberGuard)`, and emit a domain event for
anything that should appear in the activity log.
