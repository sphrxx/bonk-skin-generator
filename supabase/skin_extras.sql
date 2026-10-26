-- Camadas extras (além das 16 que o servidor do bonk aceita) de skins do bonk.io.
-- A chave vem dos ângulos da skin enviada na sala; o userscript confere o conteúdo com SHA-256,
-- então uma linha errada é só ignorada. Público: só leitura e inserção, nunca update/delete.
create table public.skin_extras (
	key text primary key check (key ~ '^[0-9a-f]{32}$'),
	extras jsonb not null check (
		jsonb_typeof(extras) = 'array'
		and jsonb_array_length(extras) between 1 and 48
		and octet_length(extras::text) <= 10000
	),
	created_at timestamptz not null default now()
);

alter table public.skin_extras enable row level security;

create policy "qualquer um lê" on public.skin_extras for select to anon, authenticated using (true);
create policy "qualquer um insere" on public.skin_extras for insert to anon, authenticated with check (true);

revoke all on public.skin_extras from anon, authenticated;
grant select, insert on public.skin_extras to anon, authenticated;
