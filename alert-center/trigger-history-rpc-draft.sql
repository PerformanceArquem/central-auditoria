-- Draft: service-role-only bridge to private simulation ledger.
begin;
grant usage on schema alert_center_test to service_role;
grant select, insert on alert_center_test.trigger_requests to service_role;
create function public.alert_center_record_simulation(p_request_key uuid,p_recipient_id text,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare entry alert_center_test.trigger_requests%rowtype; inserted boolean;
begin
 insert into alert_center_test.trigger_requests(request_key,recipient_id,actor_id)
 values(p_request_key,p_recipient_id,p_actor_id)
 on conflict(request_key) do nothing returning * into entry;
 inserted := found;
 if not inserted then
  select * into strict entry from alert_center_test.trigger_requests where request_key=p_request_key;
  if entry.recipient_id is distinct from p_recipient_id or entry.actor_id is distinct from p_actor_id then
   raise exception 'Request key conflict' using errcode='23505';
  end if;
 end if;
 return jsonb_build_object('id',entry.id,'createdAt',entry.created_at,'duplicate',not inserted,'status','simulated','deliveryEnabled',false,'ticketCreated',false);
end;
$$;
revoke all on function public.alert_center_record_simulation(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.alert_center_record_simulation(uuid,text,uuid) to service_role;
commit;
