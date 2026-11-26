-- Draft only. Requires delivery-history-draft.sql; review in isolated database.
begin;
grant usage on schema alert_center_test to service_role;
grant select, insert, update on alert_center_test.delivery_requests to service_role;
create function public.alert_center_reserve_delivery(p_request_key uuid,p_recipient_id text,p_actor_id uuid,p_ticket_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare entry alert_center_test.delivery_requests%rowtype;
begin
 insert into alert_center_test.delivery_requests(request_key,recipient_id,actor_id,ticket_id)
 values(p_request_key,p_recipient_id,p_actor_id,p_ticket_id)
 on conflict(request_key) do nothing returning * into entry;
 if found then
  return jsonb_build_object('id',entry.id,'acquired',true,'duplicate',false);
 end if;
 select * into strict entry from alert_center_test.delivery_requests where request_key=p_request_key;
 if entry.recipient_id is distinct from p_recipient_id or entry.actor_id is distinct from p_actor_id or entry.ticket_id is distinct from p_ticket_id then
  raise exception 'Request key conflict' using errcode='23505';
 end if;
 return jsonb_build_object('id',entry.id,'acquired',false,'duplicate',true,'status',entry.status);
end;
$$;
create function public.alert_center_finish_delivery(p_id uuid,p_actor_id uuid,p_status text,p_delivery_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare entry alert_center_test.delivery_requests%rowtype;
begin
 if p_status is null or p_status not in ('accepted','uncertain') or
 (p_status='accepted' and (p_delivery_id is null or length(trim(p_delivery_id))=0)) or
 (p_status='uncertain' and p_delivery_id is not null) then
  raise exception 'Invalid outcome';
 end if;
 update alert_center_test.delivery_requests set status=p_status,provider_delivery_id=p_delivery_id,finished_at=now()
 where id=p_id and actor_id=p_actor_id and status='reserved' returning * into entry;
 if not found then raise exception 'Reservation unavailable or already finalized'; end if;
 return jsonb_build_object('id',entry.id,'status',entry.status);
end;
$$;
revoke all on function public.alert_center_reserve_delivery(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.alert_center_finish_delivery(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.alert_center_reserve_delivery(uuid,text,uuid,text) to service_role;
grant execute on function public.alert_center_finish_delivery(uuid,uuid,text,text) to service_role;
-- Trusted server must independently derive actor, authorized recipient, approved ticket,
-- stable logical request key, and delivery permission. No scheduler or real send here.
commit;
