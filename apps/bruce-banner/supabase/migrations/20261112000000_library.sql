-- Bruce Banner team library. Only the `library` edge function (service role) touches these:
-- RLS is on with no policies, so the publishable key reads and writes nothing directly.
-- Applied to the Supabase project bruce-banner (eu-central-1) on 2026-11-12.

create table public.team_codes (
  code_hash text primary key,              -- sha256 hex of the team code
  label text,
  created_at timestamptz not null default now()
);

create table public.banners (
  id text primary key,                     -- the document id, the same in every browser
  name text not null,
  template text,
  theme text,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved')),
  doc jsonb not null,
  version integer not null default 1,      -- bumped on every save; a stale save gets 409
  thumb text,                              -- storage path of the card picture
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index banners_updated on public.banners (updated_at desc) where deleted_at is null;

create table public.images (
  ref text primary key,                    -- blob:<sha256>, as the documents reference it
  w integer,
  h integer,
  source text check (source in ('ai', 'upload')),
  subject text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.team_codes enable row level security;
alter table public.banners enable row level security;
alter table public.images enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('banner-images', 'banner-images', false, 15728640, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('banner-thumbs', 'banner-thumbs', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- A team code: insert its sha256, never the code itself, e.g.
--   insert into public.team_codes (code_hash, label) values (encode(sha256('the-code'), 'hex'), 'who has it');
