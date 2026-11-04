
const ALLOWED_EXPANDS = [
  "owner,clients($expand=organization),actions($select=id,createdDate,createdBy,description,timeAppointments;$expand=createdBy($select=id,businessName),timeAppointments)",
  "owner,clients($expand=organization),actions($expand=createdBy,timeAppointments)",
  "owner,clients,actions($expand=createdBy,timeAppointments)",
  "owner,clients,actions"
];

const ALLOWED_SELECT = new Set([
  "id",
  "createdDate",
  "lastUpdate",
  "subject",
  "category",
  "status",
  "serviceFirstLevel",
  "ownerTeam",
  "owner",
  "clients",
  "actions",
  "slaSolutionDate",
  "customFieldValues"
]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  // Exige autenticação verificada pelo backend.
  // Não confie apenas em login ou senha no HTML.
  const authorized = await verifyAccess(req);

  if (!authorized) {
    return res.status(401).json({
      error: "Acesso não autorizado"
    });
  }

  const token = process.env.MOVIDESK_TOKEN;
  const domain = (
    process.env.MOVIDESK_DOMAIN ||
    "https://api.movidesk.com"
  ).replace(/\/+$/, "");

  if (!token) {
    return res.status(500).json({
      error: "MOVIDESK_TOKEN não configurado na Vercel"
    });
  }

  if (domain !== "https://api.movidesk.com") {
    return res.status(500).json({
      error: "Domínio da API não permitido"
    });
  }

  try {
    const params = new URLSearchParams();
    const query = req.query || {};

    // Aceita os parâmetros utilizados pelo HTML.
    const select = String(
      query.$select || query.select || ""
    );

    if (select) {
      const fields = select.split(",").map(x => x.trim());

      if (fields.some(x => !ALLOWED_SELECT.has(x))) {
        return res.status(400).json({
          error: "Campos de seleção inválidos"
        });
      }

      params.set("$select", fields.join(","));
    }

    const expand = String(
      query.$expand || query.expand || ""
    );

    if (expand) {
      if (!ALLOWED_EXPANDS.includes(expand)) {
        return res.status(400).json({
          error: "Expansão não permitida"
        });
      }

      params.set("$expand", expand);
    }

    const filter = String(
      query.$filter || query.filter || ""
    );

    if (filter) {
      if (
        !/^lastUpdate ge \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?z$/i.test(filter)
      ) {
        return res.status(400).json({
          error: "Filtro de data inválido"
        });
      }

      params.set("$filter", filter);
    }

    const orderby = String(
      query.$orderby || query.orderby || "lastUpdate desc"
    );

    if (orderby !== "lastUpdate desc") {
      return res.status(400).json({
        error: "Ordenação não permitida"
      });
    }

    params.set("$orderby", orderby);

    const top = Number(query.$top || query.top || 100);
    const skip = Number(query.$skip || query.skip || 0);

    if (
      !Number.isInteger(top) ||
      top < 1 ||
      top > 100 ||
      !Number.isInteger(skip) ||
      skip < 0 ||
      skip > 20000
    ) {
      return res.status(400).json({
        error: "Paginação inválida"
      });
    }

    params.set("$top", String(top));
    params.set("$skip", String(skip));
    params.set("token", token);

    const url =
      domain + "/public/v1/tickets?" + params.toString();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      25000
    );

    let response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();

    if (!response.ok) {
      console.error("Movidesk HTTP", response.status);

      return res.status(response.status).json({
        error: "Falha na consulta ao Movidesk",
        status: response.status
      });
    }

    let data;

    try {
      data = JSON.parse(body);
    } catch {
      return res.status(502).json({
        error: "Movidesk retornou resposta não JSON"
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error("Erro Movidesk:", error.message);

    return res.status(
      error.name === "AbortError" ? 504 : 500
    ).json({
      error:
        error.name === "AbortError"
          ? "Tempo limite da API excedido"
          : "Erro interno ao consultar Movidesk"
    });
  }
}

// Substitua pela validação real da sessão do seu sistema.
// Por segurança, a rota permanece bloqueada até isso ser feito.
async function verifyAccess(req) {
  return false;
}

