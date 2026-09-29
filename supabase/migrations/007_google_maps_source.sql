-- ============================================================
-- 007 · Google Maps scraper as a lead source
-- Leads imported from the omkarcloud/google-maps-scraper CSV
-- exports (or its self-hosted API via the generate-leads
-- provider adapter) are tagged 'google_maps'.
-- ============================================================

alter type lead_source add value if not exists 'google_maps';
