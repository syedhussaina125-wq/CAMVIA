revoke all privileges on table public.profiles from anon;

revoke all privileges on table public.profiles from authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
