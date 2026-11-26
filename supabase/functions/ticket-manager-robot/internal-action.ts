import {movideskInternalAction,type MovideskProfile} from '../audit-email-dispatch/ticket-charge-internal.ts';

type Rule = 'overdue'|'missing_forecast'|'stale_appointment'|'idle';
type Decision = {ticketId:string;mode:string;deliveryEnabled:boolean;review?:boolean;actions:{key:Rule;level:number}[];message?:string};
const rules = new Set(['overdue','missing_forecast','stale_appointment','idle']);

// Pure payload preview: no network requests, email, time entries or ticket mutations.
// A future dispatcher must verify authorization, fresh history and durable reservation.
export function previewRobotInternalAction(decision:Decision, profile:MovideskProfile){
 if(decision.mode!=='dry-run'||decision.deliveryEnabled!==false||decision.review===true)throw Error('Simulação não autorizada.');
 if(!/^\d{1,12}$/.test(decision.ticketId)||!String(profile?.movidesk_person_id??'').trim())throw Error('Chamado ou perfil inválido.');
 const actions=decision.actions;
 if(!Array.isArray(actions)||actions.length<1||actions.length>4||new Set(actions.map(a=>a.key)).size!==actions.length||actions.some(a=>!rules.has(a.key)||![1,2,3].includes(a.level)))throw Error('Pendências inválidas.');
 const message=String(decision.message??'').trim();
 if(!message||message.length>4000||!message.includes('Ticket Manager | Gestão da Qualidade'))throw Error('Mensagem não padronizada.');
 const payload=movideskInternalAction(message,profile);
 const action=payload.actions[0];
 if(payload.actions.length!==1||action.type!==1||'timeAppointments' in action)throw Error('Registro interno inválido.');
 return {ticketId:decision.ticketId,mode:'dry-run',deliveryEnabled:false,payload};
}
