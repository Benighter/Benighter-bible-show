-- Supabase Auth + Supabase DB schema for Bible Show.
--
-- This version assumes users authenticate directly with Supabase Auth,
-- so row-level security can securely scope all records to auth.uid().

create table if not exists public.user_workspace_documents (
    user_id text not null,
    document_id text not null,
    payload jsonb not null default 'null'::jsonb,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, document_id)
);

create index if not exists user_workspace_documents_user_id_idx
    on public.user_workspace_documents (user_id);

create table if not exists public.user_translations (
    user_id text not null,
    translation_id text not null,
    name text not null,
    short_name text not null,
    source_file_name text null,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, translation_id)
);

create index if not exists user_translations_user_id_idx
    on public.user_translations (user_id);

create index if not exists user_translations_user_id_updated_at_idx
    on public.user_translations (user_id, updated_at desc);

create table if not exists public.user_translation_chunks (
    user_id text not null,
    translation_id text not null,
    chunk_index integer not null,
    verses jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, translation_id, chunk_index),
    constraint user_translation_chunks_translation_fk
        foreign key (user_id, translation_id)
        references public.user_translations (user_id, translation_id)
        on delete cascade
);

create index if not exists user_translation_chunks_user_id_idx
    on public.user_translation_chunks (user_id);

alter table public.user_workspace_documents enable row level security;
alter table public.user_translations enable row level security;
alter table public.user_translation_chunks enable row level security;

drop policy if exists user_workspace_documents_owner_all on public.user_workspace_documents;
create policy user_workspace_documents_owner_all
    on public.user_workspace_documents
    for all
    to authenticated
    using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);

drop policy if exists user_translations_owner_all on public.user_translations;
create policy user_translations_owner_all
    on public.user_translations
    for all
    to authenticated
    using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);

drop policy if exists user_translation_chunks_owner_all on public.user_translation_chunks;
create policy user_translation_chunks_owner_all
    on public.user_translation_chunks
    for all
    to authenticated
    using (auth.uid()::text = user_id)
    with check (auth.uid()::text = user_id);
