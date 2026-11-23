-- Parking Manager v17: Supabase schema, RLS, wallet ledger and reservation lifecycle.
-- Run in Supabase SQL Editor. Use only the anon key in the browser; never expose service_role.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parking_zones (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,
  name text not null,
  address text not null,
  description text,
  latitude double precision,
  longitude double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parking_spots (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.parking_zones(id) on delete cascade,
  spot_number text not null,
  spot_type text not null default 'standard',
  hourly_price numeric(10,2) not null default 0 check (hourly_price >= 0),
  is_active boolean not null default true,
  unique(zone_id, spot_number)
);

create table if not exists public.tariffs (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references public.parking_zones(id) on delete cascade,
  name text not null,
  price_per_hour numeric(10,2) not null check (price_per_hour >= 0),
  price_per_day numeric(10,2),
  is_active boolean not null default true
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plate_number text not null,
  make text,
  model text,
  color text,
  chip_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, plate_number)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  spot_id uuid not null references public.parking_spots(id),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','active','cancelled','completed','expired')),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  currency char(3) not null default 'RUB',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  entry_at timestamptz,
  exit_at timestamptz,
  refunded_at timestamptz,
  check (ends_at > starts_at)
);

-- Prevents two unexpired pending/confirmed/active reservations from taking the same spot and interval.
-- Run the expire_pending_reservations() RPC before creating a new reservation.
do $$ begin
  alter table public.reservations add constraint reservations_no_overlap
    exclude using gist (spot_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('pending','confirmed','active'));
exception when duplicate_object then null; end $$;

create table if not exists public.wallet_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- User-owned app state allows the current prototype to sync settings and UI records
-- between devices while the normalized relational tables are adopted incrementally.
create table if not exists public.user_app_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  state_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(user_id, state_key),
  constraint user_app_state_key_allowed check (state_key in ('bookings','vehicles','notices','favorites','subscriptions','payments','payment_methods','notifications_enabled','wallet_balance','avatar'))
);

-- Add the allowed-key check when upgrading an existing earlier v14 schema.
do $$ begin
  alter table public.user_app_state add constraint user_app_state_key_allowed
    check (state_key in ('bookings','vehicles','notices','favorites','subscriptions','payments','payment_methods','notifications_enabled','wallet_balance','avatar'));
exception when duplicate_object then null; end $$;

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  kind text not null check (kind in ('demo_topup','booking_charge','extension_charge','refund','subscription_charge','adjustment')),
  amount numeric(12,2) not null check (amount > 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  method text not null check (method in ('card','sbp','corporate','wallet','demo')),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  related_payment_id uuid references public.payments(id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists payments_one_paid_per_reservation
  on public.payments(reservation_id) where status='paid';

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_code text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','cancelled','expired')),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  check (ends_at > starts_at)
);

create table if not exists public.access_passes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  qr_token text not null unique default encode(gen_random_bytes(24),'hex'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  check (valid_until > valid_from)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.parking_sessions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete cascade,
  spot_id uuid not null references public.parking_spots(id),
  vehicle_id uuid references public.vehicles(id),
  entry_at timestamptz not null default now(),
  exit_at timestamptz,
  total_cost numeric(10,2),
  check (exit_at is null or exit_at >= entry_at)
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  zone_id uuid not null references public.parking_zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, zone_id)
);

create table if not exists public.access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  event_type text not null check (event_type in ('entry_attempt','entry_success','exit_attempt','exit_success','denied')),
  details text,
  created_at timestamptz not null default now()
);

-- Create profile + demo wallet account when Supabase Auth creates a user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  insert into public.wallet_accounts(user_id, balance) values (new.id, 3000)
  on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Expire unpaid holds so they do not permanently block a parking space.
create or replace function public.expire_pending_reservations() returns integer
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.reservations set status='expired'
  where status='pending' and expires_at is not null and expires_at <= now();
  get diagnostics affected = row_count;
  return affected;
end; $$;

-- Atomic reservation creation. The exclusion constraint prevents overlapping claims.
create or replace function public.reserve_spot(
  p_spot_id uuid, p_vehicle_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_amount numeric
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; spot_active boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then raise exception 'invalid_time_range'; end if;
  if p_starts_at < now() - interval '15 minutes' then raise exception 'reservation_in_past'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'invalid_amount'; end if;
  if p_vehicle_id is not null and not exists(select 1 from public.vehicles where id=p_vehicle_id and user_id=auth.uid()) then raise exception 'vehicle_not_found'; end if;
  perform public.expire_pending_reservations();
  select s.is_active and z.is_active into spot_active
  from public.parking_spots s join public.parking_zones z on z.id=s.zone_id where s.id=p_spot_id;
  if coalesce(spot_active,false)=false then raise exception 'spot_unavailable'; end if;
  insert into public.reservations(user_id,spot_id,vehicle_id,starts_at,ends_at,status,amount,expires_at)
  values(auth.uid(),p_spot_id,p_vehicle_id,p_starts_at,p_ends_at,'pending',p_amount,now()+interval '10 minutes')
  returning id into new_id;
  return new_id;
exception when exclusion_violation then
  raise exception 'spot_already_reserved';
end; $$;

-- Atomic wallet debit: checks the server-side reservation amount and prevents duplicate payment.
create or replace function public.charge_reservation(p_reservation_id uuid, p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare new_balance numeric(12,2); r public.reservations%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into r from public.reservations where id=p_reservation_id and user_id=auth.uid() for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status <> 'pending' or (r.expires_at is not null and r.expires_at <= now()) then raise exception 'reservation_expired'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> r.amount then raise exception 'amount_mismatch'; end if;
  if exists(select 1 from public.payments where reservation_id=p_reservation_id and status='paid') then raise exception 'already_paid'; end if;
  update public.wallet_accounts set balance=balance-p_amount,updated_at=now()
  where user_id=auth.uid() and balance>=p_amount returning balance into new_balance;
  if new_balance is null then raise exception 'insufficient_balance'; end if;
  insert into public.wallet_transactions(user_id,reservation_id,kind,amount,balance_after,description)
  values(auth.uid(),p_reservation_id,'booking_charge',p_amount,new_balance,'Оплата бронирования');
  insert into public.payments(reservation_id,user_id,amount,method,status,paid_at)
  values(p_reservation_id,auth.uid(),p_amount,'wallet','paid',now());
  update public.reservations set status='confirmed' where id=p_reservation_id and status='pending';
  insert into public.access_passes(reservation_id,user_id,valid_from,valid_until)
  values(p_reservation_id,auth.uid(),r.starts_at-interval '15 minutes',r.ends_at)
  on conflict(reservation_id) do nothing;
  return new_balance;
end; $$;

-- Demo top-up is intentionally labeled as simulated. It never communicates with a bank.
create or replace function public.demo_wallet_topup(p_amount numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare new_balance numeric(12,2);
begin
  if p_amount < 100 or p_amount > 100000 then raise exception 'invalid_topup_amount'; end if;
  update public.wallet_accounts set balance=balance+p_amount,updated_at=now()
  where user_id=auth.uid() returning balance into new_balance;
  if new_balance is null then raise exception 'wallet_not_found'; end if;
  insert into public.wallet_transactions(user_id,kind,amount,balance_after,description)
  values(auth.uid(),'demo_topup',p_amount,new_balance,'Демо-пополнение. Реальные средства не переводились.');
  return new_balance;
end; $$;

create or replace function public.refund_reservation(p_reservation_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype; new_balance numeric(12,2);
begin
  select * into r from public.reservations where id=p_reservation_id and user_id=auth.uid() for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status <> 'confirmed' then raise exception 'reservation_not_refundable'; end if;
  if r.refunded_at is not null or exists(select 1 from public.payments where reservation_id=r.id and status='refunded') then raise exception 'already_refunded'; end if;
  update public.wallet_accounts set balance=balance+r.amount,updated_at=now()
  where user_id=auth.uid() returning balance into new_balance;
  update public.payments set status='refunded' where reservation_id=r.id and status='paid';
  update public.reservations set status='cancelled',refunded_at=now() where id=r.id;
  insert into public.wallet_transactions(user_id,reservation_id,kind,amount,balance_after,description)
  values(auth.uid(),r.id,'refund',r.amount,new_balance,'Возврат оплаты отменённого бронирования');
  return new_balance;
end; $$;

create or replace function public.finish_reservation(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.reservations%rowtype;
begin
  select * into r from public.reservations where id=p_reservation_id and user_id=auth.uid() for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status <> 'active' then raise exception 'reservation_not_active'; end if;
  update public.reservations set status='completed',exit_at=now() where id=r.id;
  update public.parking_sessions set exit_at=now() where reservation_id=r.id and exit_at is null;
  update public.access_passes set revoked_at=now() where reservation_id=r.id and revoked_at is null;
end; $$;

-- RLS: all user data is private to the authenticated owner.
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.reservations enable row level security;
alter table public.wallet_accounts enable row level security;
alter table public.user_app_state enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.access_passes enable row level security;
alter table public.notifications enable row level security;
alter table public.parking_sessions enable row level security;
alter table public.favorites enable row level security;
alter table public.access_events enable row level security;
alter table public.parking_zones enable row level security;
alter table public.parking_spots enable row level security;
alter table public.tariffs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id=auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id=auth.uid());

drop policy if exists "public_read_active_zones" on public.parking_zones;
create policy "public_read_active_zones" on public.parking_zones for select to anon, authenticated using (is_active=true);
drop policy if exists "public_read_active_spots" on public.parking_spots;
create policy "public_read_active_spots" on public.parking_spots for select to anon, authenticated using (is_active=true);
drop policy if exists "public_read_active_tariffs" on public.tariffs;
create policy "public_read_active_tariffs" on public.tariffs for select to anon, authenticated using (is_active=true);

drop policy if exists "vehicles_own_all" on public.vehicles;
create policy "vehicles_own_all" on public.vehicles for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "reservations_own_all" on public.reservations;
drop policy if exists "reservations_read_own" on public.reservations;
create policy "reservations_read_own" on public.reservations for select to authenticated using (user_id=auth.uid());
drop policy if exists "wallet_read_own" on public.wallet_accounts;
create policy "wallet_read_own" on public.wallet_accounts for select to authenticated using (user_id=auth.uid());
drop policy if exists "app_state_own_all" on public.user_app_state;
create policy "app_state_own_all" on public.user_app_state for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "wallet_transactions_read_own" on public.wallet_transactions;
create policy "wallet_transactions_read_own" on public.wallet_transactions for select to authenticated using (user_id=auth.uid());
drop policy if exists "payments_own_all" on public.payments;
drop policy if exists "payments_read_own" on public.payments;
create policy "payments_read_own" on public.payments for select to authenticated using (user_id=auth.uid());
drop policy if exists "subscriptions_own_all" on public.subscriptions;
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own" on public.subscriptions for select to authenticated using (user_id=auth.uid());
drop policy if exists "passes_own_read" on public.access_passes;
create policy "passes_own_read" on public.access_passes for select to authenticated using (user_id=auth.uid());
drop policy if exists "notifications_own_all" on public.notifications;
create policy "notifications_own_all" on public.notifications for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "sessions_own_read" on public.parking_sessions;
create policy "sessions_own_read" on public.parking_sessions for select to authenticated using (exists(select 1 from public.reservations r where r.id=reservation_id and r.user_id=auth.uid()));
drop policy if exists "favorites_own_all" on public.favorites;
create policy "favorites_own_all" on public.favorites for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists "access_events_own_read" on public.access_events;
create policy "access_events_own_read" on public.access_events for select to authenticated using (user_id=auth.uid());

revoke all on function public.expire_pending_reservations() from public, anon;
revoke all on function public.reserve_spot(uuid,uuid,timestamptz,timestamptz,numeric) from public, anon;
revoke all on function public.charge_reservation(uuid,numeric) from public, anon;
revoke all on function public.demo_wallet_topup(numeric) from public, anon;
revoke all on function public.refund_reservation(uuid) from public, anon;
revoke all on function public.finish_reservation(uuid) from public, anon;
grant execute on function public.expire_pending_reservations() to authenticated;
grant execute on function public.reserve_spot(uuid,uuid,timestamptz,timestamptz,numeric) to authenticated;
grant execute on function public.charge_reservation(uuid,numeric) to authenticated;
grant execute on function public.demo_wallet_topup(numeric) to authenticated;
grant execute on function public.refund_reservation(uuid) to authenticated;
grant execute on function public.finish_reservation(uuid) to authenticated;
grant select,insert,update,delete on public.user_app_state to authenticated;
