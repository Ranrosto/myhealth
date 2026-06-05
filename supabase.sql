-- ============================================================
--  Supabase setup for "המעקב שלי" push reminders
--  Paste this whole file into:  Supabase ‹ your project ‹ SQL Editor ‹ Run
-- ============================================================

-- 1) Table that holds one row per subscribed device
create table if not exists public.push_subscriptions (
    endpoint        text primary key,          -- unique per device/browser
    p256dh          text not null,
    auth            text not null,
    hour            int  not null default 15,   -- user's chosen hour (0-23)
    minute          int  not null default 30,   -- user's chosen minute (0-59)
    tz              text not null default 'Asia/Jerusalem',
    enabled         boolean not null default true,
    last_sent_date  text,                       -- 'YYYY-MM-DD' in the user's tz; prevents double-sends
    created_at      timestamptz default now()
);

-- 2) Lock the table down. The browser uses the public "anon" key, which is
--    safe to expose because RLS blocks all direct table access. The browser
--    can ONLY call the two functions below; the GitHub Action uses the secret
--    service_role key (which bypasses RLS) to read and send.
alter table public.push_subscriptions enable row level security;
-- (no policies created on purpose => anon cannot select/insert/update/delete directly)

-- 3) Register / update a subscription (called by the browser with the anon key)
create or replace function public.register_subscription(
    p_endpoint text, p_p256dh text, p_auth text,
    p_hour int, p_minute int, p_tz text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.push_subscriptions(endpoint, p256dh, auth, hour, minute, tz, enabled)
    values (p_endpoint, p_p256dh, p_auth,
            greatest(0, least(23, p_hour)),
            greatest(0, least(59, p_minute)),
            coalesce(nullif(p_tz, ''), 'Asia/Jerusalem'),
            true)
    on conflict (endpoint) do update set
        p256dh  = excluded.p256dh,
        auth    = excluded.auth,
        hour    = excluded.hour,
        minute  = excluded.minute,
        tz      = excluded.tz,
        enabled = true;
end;
$$;

-- 4) Unregister a subscription (called by the browser when the user turns notifications off)
create or replace function public.unregister_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

-- 5) Let the public anon role execute ONLY these two functions
grant execute on function public.register_subscription(text, text, text, int, int, text) to anon;
grant execute on function public.unregister_subscription(text) to anon;
