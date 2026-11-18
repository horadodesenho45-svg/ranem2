const { parseExternalId } = require("../../lib/paradise.js");
const { createRastroCodeOrder } = require("../../lib/rastrocode.js");

const API_URL = "https://oferta-processamento.org.ua/api/v1/query";

function normalizeStatus(status) {
  if (status === "approved") return "paid";
  if (["pending", "processing", "under_review"].includes(status)) return "pending";
  if (["failed", "refunded", "chargeback"].includes(status)) return "cancelled";
  return null;
}

module.exports = async function getPixStatus(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.PARADISE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "A integração Paradise não está configurada no servidor." });
  }

  const transaction = parseExternalId(req.query && req.query.external_id);
  if (!transaction) {
    return res.status(400).json({ error: "Identificador de transação inválido." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = new URL(API_URL);
    url.searchParams.set("action", "list_transactions");
    url.searchParams.set("external_id", transaction.externalId);
    const response = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const status = response.status === 404 ? 404 : 502;
      console.error("Paradise falhou ao consultar a cobrança.", { status: response.status });
      return res.status(status).json({ error: "Não foi possível consultar o status do Pix." });
    }

    const transactions = Array.isArray(result)
      ? result
      : result && Array.isArray(result.data)
        ? result.data
        : result && [result];
    const data = transactions && transactions.find((item) =>
      item && item.external_id === transaction.externalId
    );
    const status = data && normalizeStatus(data.status);
    if (!status) {
      if (transactions && transactions.length === 0) {
        return res.status(404).json({ error: "Cobrança Pix não encontrada." });
      }
      console.error("Resposta Paradise inválida ao consultar cobrança.");
      return res.status(502).json({ error: "A Paradise retornou um status inválido." });
    }

    const responseBody = {
      external_id: transaction.externalId,
      offer_id: transaction.offerId,
      status
    };

    if (transaction.offerId === "rental" && status === "paid") {
      try {
        await createRastroCodeOrder(
          req.query && req.query.order_token,
          transaction.externalId,
          process.env.RASTROCODE_API_KEY
        );
        responseBody.rastrocode_order_status = "created";
      } catch (error) {
        console.error("RastroCode falhou ao registrar pedido pago.", {
          name: error.name,
          status: error.statusCode
        });
        responseBody.rastrocode_order_status = "pending";
      }
    }

    return res.status(200).json(responseBody);
  } catch (error) {
    console.error("Falha ao consultar a Paradise.", { name: error.name });
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "A consulta à Paradise excedeu o tempo limite."
        : "Não foi possível consultar o status do Pix."
    });
  } finally {
    clearTimeout(timeout);
  }
};
