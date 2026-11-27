const loaders={
  'robot-overview':()=>import('../server/audit-robot-overview.mjs'),
  inspection:()=>import('../server/audit-ticket-inspection.mjs'),
  lookup:()=>import('../server/audit-ticket-lookup.mjs'),
  forecast:()=>import('../server/audit-forecast-variances.mjs'),
  'production-flow':()=>import('../server/audit-production-flow.mjs')
};
// A fixed allowlist keeps the existing endpoint handlers and their authorization intact.
export function createAuditRouter(routes=loaders){
  return async function handler(req,res){
    res.setHeader('Cache-Control','private, no-store');
    const route=req.query?.route;
    if(typeof route!=='string'||!Object.hasOwn(routes,route))return res.status(404).json({ok:false,error:'Rota não encontrada'});
    const query={...req.query};delete query.route;
    try{
      const module=await routes[route]();
      // Preserve the original request object (stream, headers and parsed body).
      req.query=query;
      return await module.default(req,res);
    }catch{
      if(!res.headersSent)return res.status(502).json({ok:false,error:'Consulta indisponível; tente novamente.'});
    }
  };
}
export default createAuditRouter();
