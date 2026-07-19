-- Deligatr Assistant — clients table
-- Run once in the Supabase SQL editor (or via `psql`).

create table if not exists clients (
  location_id text primary key,              -- GHL sub-account id
  name        text,
  tier        text default 'DeliHub Free',   -- e.g. 'DeliHub Pro'
  products    text[] default '{}'            -- e.g. ['DeliMail','DeliReach']
);

-- ── Column-name mismatch (FLAGGED) ───────────────────────────────────────────
-- The n8n workflow's Supabase node selects `name,locationId,tier,products`
-- (camelCase), but this table uses snake_case (`location_id`). Postgres/
-- PostgREST will NOT match `locationId` to `location_id` automatically.
--
-- Fix: point the workflow's Supabase lookup at the view below instead of the
-- `clients` table. The view exposes exactly the camelCase names the workflow
-- expects, so its select list and filters keep working unchanged:
--
--   GET /rest/v1/clients_api?locationId=eq.<LOCATION_ID>&select=name,locationId,tier,products
--
-- (Alternative, if you'd rather not touch the workflow's table name: keep the
-- table and change the workflow's select to alias the column instead:
--   select=name,locationId:location_id,tier,products  with  location_id=eq.<id>)

create or replace view clients_api as
select
  location_id as "locationId",
  name,
  tier,
  products
from clients;

-- The widget never talks to Supabase directly; only the n8n workflow reads it
-- (with the service-role key), so no anon grants / RLS policies are needed.
-- Enable RLS on the base table so the anon key can't read it at all:
alter table clients enable row level security;
