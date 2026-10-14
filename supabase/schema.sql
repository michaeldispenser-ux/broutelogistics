-- =============================================================================
-- Broutelogistics database schema (Supabase / PostgreSQL)
-- Run once in: Supabase dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe model: the public site can ONLY call track_shipment() and submit_inquiry().
-- Everything else requires a signed-in user listed in public.admins.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Admin allow-list ----------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies: not readable through the API

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Shipments ----------
create table if not exists public.shipments (
  id                uuid primary key default gen_random_uuid(),
  tracking_no       text not null unique,
  description       text not null check (char_length(description) between 1 and 120),
  service           text not null default 'Express'
                      check (service in ('Air Freight', 'Ocean Freight', 'Express')),
  origin            text not null check (char_length(origin) between 1 and 100),
  destination       text not null check (char_length(destination) between 1 and 100),
  sender_name       text check (char_length(sender_name) <= 100),
  recipient_name    text check (char_length(recipient_name) <= 100),
  recipient_contact text check (char_length(recipient_contact) <= 120),
  weight_kg         numeric(10, 2) check (weight_kg is null or weight_kg > 0),
  status            text not null default 'Created'
                      check (status in ('Created', 'In Transit', 'Out for Delivery', 'Delivered', 'On Hold', 'Cancelled')),
  current_location  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id)
);
create index if not exists shipments_created_idx on public.shipments (created_at desc);
create index if not exists shipments_status_idx  on public.shipments (status);

-- Append-only history. No policy or function ever updates or deletes rows here.
create table if not exists public.shipment_events (
  id          bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  status      text not null
                check (status in ('Created', 'In Transit', 'Out for Delivery', 'Delivered', 'On Hold', 'Cancelled')),
  location    text check (char_length(location) <= 120),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);
create index if not exists shipment_events_idx on public.shipment_events (shipment_id, created_at desc);

-- ---------- Customer enquiries ----------
create table if not exists public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  email      text not null check (char_length(email) between 3 and 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (char_length(phone) <= 40),
  service    text check (char_length(service) <= 40),
  message    text not null check (char_length(message) between 5 and 2000),
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists inquiries_created_idx on public.inquiries (created_at desc);

-- ---------- Row Level Security ----------
alter table public.shipments       enable row level security;
alter table public.shipment_events enable row level security;
alter table public.inquiries       enable row level security;

drop policy if exists "admins read shipments" on public.shipments;
create policy "admins read shipments" on public.shipments for select to authenticated using (public.is_admin());

drop policy if exists "admins read events" on public.shipment_events;
create policy "admins read events" on public.shipment_events for select to authenticated using (public.is_admin());

drop policy if exists "admins read inquiries" on public.inquiries;
create policy "admins read inquiries" on public.inquiries for select to authenticated using (public.is_admin());

drop policy if exists "admins update inquiries" on public.inquiries;
create policy "admins update inquiries" on public.inquiries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Belt and braces: strip default grants, then give back only what is needed.
revoke all on public.shipments, public.shipment_events, public.inquiries, public.admins from anon, authenticated;
grant select on public.shipments, public.shipment_events to authenticated;
grant select on public.inquiries to authenticated;
grant update (handled) on public.inquiries to authenticated;

-- ---------- Tracking number generator (unguessable, 10 chars, no look-alike characters) ----------
create or replace function public.generate_tracking_no()
returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 characters
  bytes  bytea := gen_random_bytes(10);
  result text := '';
  i int;
begin
  for i in 0..9 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;
  return 'BRT-' || result;
end;
$$;

-- ---------- Admin: create shipment (always starts as 'Created') ----------
create or replace function public.create_shipment(
  p_description       text,
  p_origin            text,
  p_destination       text,
  p_service           text default 'Express',
  p_sender_name       text default null,
  p_recipient_name    text default null,
  p_recipient_contact text default null,
  p_weight_kg         numeric default null
)
returns public.shipments
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  s     public.shipments;
  tn    text;
  tries int := 0;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  loop
    tn := public.generate_tracking_no();
    begin
      insert into public.shipments
        (tracking_no, description, service, origin, destination, sender_name, recipient_name,
         recipient_contact, weight_kg, status, current_location, created_by)
      values
        (tn, btrim(p_description), coalesce(nullif(btrim(p_service), ''), 'Express'), btrim(p_origin), btrim(p_destination),
         nullif(btrim(p_sender_name), ''), nullif(btrim(p_recipient_name), ''), nullif(btrim(p_recipient_contact), ''),
         p_weight_kg, 'Created', 'Awaiting pickup – ' || btrim(p_origin), auth.uid())
      returning * into s;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;

  insert into public.shipment_events (shipment_id, status, location, note, created_by)
  values (s.id, 'Created', s.origin, 'Shipment registered', auth.uid());

  return s;
end;
$$;

-- ---------- Admin: add a status event (atomic; closed shipments cannot change) ----------
create or replace function public.add_shipment_event(
  p_shipment_id uuid,
  p_status      text,
  p_location    text default null,
  p_note        text default null
)
returns public.shipments
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  s   public.shipments;
  loc text;
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_status not in ('Created', 'In Transit', 'Out for Delivery', 'Delivered', 'On Hold', 'Cancelled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'Shipment not found' using errcode = 'P0002';
  end if;
  if s.status in ('Delivered', 'Cancelled') then
    raise exception 'This shipment is closed and can no longer be changed' using errcode = 'P0001';
  end if;

  loc := coalesce(
    nullif(btrim(p_location), ''),
    case p_status
      when 'Delivered'        then 'Delivered – ' || s.destination
      when 'Out for Delivery' then 'Out for delivery – ' || s.destination
      when 'In Transit'       then 'In transit'
      when 'On Hold'          then s.current_location
      when 'Cancelled'        then 'Shipment cancelled'
      else s.origin
    end
  );

  update public.shipments
     set status = p_status, current_location = loc, updated_at = now()
   where id = s.id
   returning * into s;

  insert into public.shipment_events (shipment_id, status, location, note, created_by)
  values (s.id, p_status, loc, nullif(btrim(p_note), ''), auth.uid());

  return s;
end;
$$;

-- ---------- Public: look up ONE shipment by its tracking number (no personal data returned) ----------
create or replace function public.track_shipment(p_tracking text)
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'tracking_no',      s.tracking_no,
    'description',      s.description,
    'service',          s.service,
    'origin',           s.origin,
    'destination',      s.destination,
    'status',           s.status,
    'current_location', s.current_location,
    'created_at',       s.created_at,
    'updated_at',       s.updated_at,
    'events', (
      select coalesce(
        json_agg(json_build_object('status', e.status, 'location', e.location, 'note', e.note, 'created_at', e.created_at)
                 order by e.created_at desc, e.id desc),
        '[]'::json)
      from public.shipment_events e
      where e.shipment_id = s.id
    )
  )
  from public.shipments s
  where s.tracking_no = upper(btrim(p_tracking));
$$;

-- ---------- Public: contact / quote request ----------
create or replace function public.submit_inquiry(
  p_name    text,
  p_email   text,
  p_message text,
  p_phone   text default null,
  p_service text default null,
  p_website text default ''          -- honeypot: real visitors leave this empty
)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(p_website, '') <> '' then
    return true;                     -- silently drop bots
  end if;
  if (select count(*) from public.inquiries
       where lower(email) = lower(btrim(p_email)) and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests. Please try again later.' using errcode = 'P0001';
  end if;
  insert into public.inquiries (name, email, phone, service, message)
  values (btrim(p_name), btrim(p_email), nullif(btrim(p_phone), ''), nullif(btrim(p_service), ''), btrim(p_message));
  return true;
end;
$$;

-- ---------- Function permissions ----------
revoke all on function public.is_admin()           from public, anon;
revoke all on function public.generate_tracking_no() from public, anon, authenticated;
revoke all on function public.create_shipment(text, text, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.add_shipment_event(uuid, text, text, text)                         from public, anon;
revoke all on function public.track_shipment(text)                                               from public;
revoke all on function public.submit_inquiry(text, text, text, text, text, text)                 from public;

grant execute on function public.is_admin()           to authenticated;
grant execute on function public.create_shipment(text, text, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.add_shipment_event(uuid, text, text, text)                         to authenticated;
grant execute on function public.track_shipment(text)                                               to anon, authenticated;
grant execute on function public.submit_inquiry(text, text, text, text, text, text)                 to anon, authenticated;

-- =============================================================================
-- AFTER running this file, create your admin sign-in:
--   1. Authentication -> Users -> Add user (email + strong password, tick "Auto Confirm User").
--   2. Authentication -> Sign In / Providers -> turn OFF "Allow new users to sign up".
--   3. Run:  insert into public.admins (user_id) select id from auth.users where email = 'YOU@YOURDOMAIN';
-- =============================================================================
