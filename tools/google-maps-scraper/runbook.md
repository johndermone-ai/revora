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

## Option B — self-hosted API + automatic daily delivery

The scraper has a Python API that can run on any VM (see
`server-deployment.md` in the scraper repo):

1. Host a small endpoint that accepts
   `POST { count, services, area }` and returns
   `[{ name, phone, email?, main_category?, address?, website? }]`
   by running the scraper for `services in area`.
2. In Revora, connect the integration (`integration_key: 'google_maps'`)
   with config `{ "endpoint": "https://your-vm.example/scrape", "api_key": "..." }`.
3. The daily generator then prefers this provider: every day it fetches up
   to the plan's remaining quota of real Google Maps leads per business.
   If the endpoint fails or is unconfigured, nothing is fabricated — the
   generator falls back to the labelled AI prospects only if no AI path
   exists either, else reports honestly.

Plan quotas still apply: trial 2/day, starter 5/day, pro 15/day.
