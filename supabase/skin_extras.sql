-- Camadas extras (além das 16 que o servidor do bonk aceita) de skins do bonk.io.
-- A chave vem dos ângulos da skin enviada na sala; o userscript confere o conteúdo com SHA-256,
-- então uma linha errada é só ignorada. Público: só leitura e inserção, nunca update/delete.
create table public.skin_extras (
	key text primary key check (key ~ '^[0-9a-f]{32}$'),
	extras jsonb not null check (
		jsonb_typeof(extras) = 'array'
		and jsonb_array_length(extras) between 1 and 111 -- 127 no total, com as 16 da sala
		and octet_length(extras::text) <= 20000
	),
	created_at timestamptz not null default now(),
	ip_hash text -- só para o limite de envios; não é legível pela chave pública
);

create index skin_extras_ip_recent on public.skin_extras (ip_hash, created_at);
create index skin_extras_recent on public.skin_extras (created_at);

alter table public.skin_extras enable row level security;

create policy "qualquer um lê" on public.skin_extras for select to anon, authenticated using (true);
create policy "qualquer um insere" on public.skin_extras for insert to anon, authenticated with check (true);

-- Só key e extras vêm de quem envia: created_at e ip_hash são definidos pelo gatilho
revoke all on public.skin_extras from anon, authenticated;
grant select (key, extras, created_at) on public.skin_extras to anon, authenticated;
grant insert (key, extras) on public.skin_extras to anon, authenticated;

-- Limites contra spam: por IP, global por hora e total de linhas (o plano gratuito tem 500 MB)
create function public.skin_extras_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
	headers json := current_setting('request.headers', true)::json;
	-- cf-connecting-ip vem do Cloudflare e não pode ser forjado pelo cliente; x-forwarded-for pode
	ip text := coalesce(headers->>'cf-connecting-ip', split_part(headers->>'x-forwarded-for', ',', 1), 'desconhecido');
begin
	new.ip_hash := md5(ip);
	new.created_at := now();
	if (select count(*) from public.skin_extras where ip_hash = new.ip_hash and created_at > now() - interval '1 hour') >= 20 then
		raise exception 'limite de 20 envios por hora atingido' using errcode = '54000';
	end if;
	if (select count(*) from public.skin_extras where created_at > now() - interval '1 hour') >= 500 then
		raise exception 'limite global de envios por hora atingido' using errcode = '54000';
	end if;
	if (select count(*) from public.skin_extras) >= 20000 then
		raise exception 'banco de skins cheio' using errcode = '54000';
	end if;
	return new;
end $$;

revoke execute on function public.skin_extras_limit() from public, anon, authenticated;

create trigger skin_extras_limit before insert on public.skin_extras
for each row execute function public.skin_extras_limit();
