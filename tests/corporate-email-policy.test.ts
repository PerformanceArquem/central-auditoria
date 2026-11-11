import {
  corporateCopy,corporatePacket,corporateFallbackHtml,assertCorporateCopy
} from "../supabase/functions/audit-email-dispatch/corporate-mail-policy.ts";

const expect=(ok:boolean,msg:string)=>{if(!ok)throw new Error(msg);};
Deno.test("nomes de infraestrutura nao aparecem em mensagens",()=>{
 const message="Dados extraídos do Supabase e publicados pela Vercel. Google Apps Script e PostgreSQL.";
 const clean=corporateCopy(message);
 assertCorporateCopy(clean);
 expect(!/supabase|vercel|apps script|postgres/i.test(clean),"nome tecnicos visiveis");
 expect(clean.includes("plataforma interna"),"referencia institucional ausente");
});
Deno.test("pacote PDF e Excel tambem segue politica",()=>{
 const packet={schema:"arquem-mail-v1",title:"Relatório Supabase",customers:[{
   name:"Cliente",note:"Dados no Vercel"}],tickets:[{
    id:"100769",url:"https://arquem.movidesk.com/Ticket/Edit/100769"
   }]};
 const clean=corporatePacket(packet);
 assertCorporateCopy(clean);
 expect(packet.title==="Relatório Supabase","origem foi modificada");
 expect(clean.tickets[0].url.includes("Ticket/Edit/100769"),"link de ticket perdido");
});
Deno.test("corpo HTML corporativo de contingencia escapa dados",()=>{
 const html=corporateFallbackHtml("Relatório Vercel","Prezados,\n<script>alert('x')</script>\nFonte Supabase");
 assertCorporateCopy(html);
 expect(html.includes("ARQUEM SISTEMAS"),"marca corporativa ausente");
 expect(html.includes("&lt;script&gt;"),"entrada perigosa nao escapada");
 expect(!html.includes("<script>"),"script injetado no HTML");
});
Deno.test("envio bloqueia material nao saneado",()=>{
 let blocked=false;try{assertCorporateCopy({html:"Hospedagem: Supabase"})}catch{blocked=true;}
 expect(blocked,"checada de saida falhou");
});
