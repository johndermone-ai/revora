# Google Maps lead source — runbook

Revora consumes real leads from the open-source
[google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper)
(two ways) and tags every lead with source `google_maps`.

## What you get per lead

Name, phone, website, address, main category, rating/review count, social
links — 50+ fields, deduplicated by `kgmid` on import. Emails require the
scraper's enrichment feature (free credits/month).

## Option A — CSV import (works today, no server)

1. Download the **Google Maps Extractor** desktop app (link in the scraper
   README) or run it via Docker. Chrome must be installed.
2. Search with queries built from your Revora lead-gen settings:
   `<service keywords> in <target area>` — e.g.
   `landscape gardening in Manchester`, one search per keyword.
3. Export the results as CSV.
4. In Revora → Leads → **Import CSV**, drop the file. It is auto-detected
   as a Google Maps export (by the `kgmid` / `main_category` columns) and
   mapped: name → name, phone (international preferred) → phone,
   main_category → service interest, address/website/rating/social → notes.
   Duplicates by kgmid/phone are removed. Leads arrive as status `new`.

## Option B — self-hosted API + automatic daily delivery (platform owner only)

The scraper has a Python API that can run on any VM (see
`server-deployment.md` in the scraper repo). **This is a platform-level
setting: the Revora owner (you) configures it once with secrets; your
customers are never asked for an endpoint or API key** — they just toggle
"Automatic daily leads" and set their services/area, and real leads arrive
per their plan.

1. Host a small endpoint that accepts
   `POST { count, services, area }` (header `x-api-key` optional) and returns
   `[{ name, phone, email?, main_category?, address?, website? }]`
   by running the scraper for `services in area`.
2. Set the platform secrets once:
   ```
   supabase secrets set \
     GOOGLE_MAPS_SCRAPER_ENDPOINT=https://your-vm.example/scrape \
     GOOGLE_MAPS_SCRAPER_API_KEY=your-shared-key
   ```
3. Done. The daily generator now prefers real Google Maps leads for every
   subscribed business, up to each plan's remaining quota, using each
   business's own services/area targeting. If the endpoint is down or
   unset, nothing is fabricated — the labelled AI generator is the honest
   fallback.

Plan quotas still apply: trial 2/day, starter 5/day, pro 15/day.
