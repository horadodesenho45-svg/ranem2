const { parseExternalId } = require("../../lib/pixoupay.js");

const API_URL = "https://api.pixoupay.com/transaction";

module.exports = async function getPixStatus(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const token = process.env.PIXOUPAY_SECRET_TOKEN;
  if (!token) {
    return res.status(503).json({ error: "A integração PixouPay não está configurada no servidor." });
  }

  const transaction = parseExternalId(req.query && req.query.external_id);
  if (!transaction) {
    return res.status(400).json({ error: "Identificador de transação inválido." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = new URL(API_URL);
    url.searchParams.set("external_id", transaction.externalId);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const status = response.status === 404 ? 404 : 502;
      console.error("PixouPay falhou ao consultar a cobrança.", { status: response.status });
      return res.status(status).json({ error: "Não foi possível consultar o status do Pix." });
    }

    const data = result && result.data;
    if (!data || !["pending", "paid", "expired", "cancelled"].includes(data.status)) {
      console.error("Resposta PixouPay inválida ao consultar cobrança.");
      return res.status(502).json({ error: "A PixouPay retornou um status inválido." });
    }

    return res.status(200).json({
      external_id: transaction.externalId,
      offer_id: transaction.offerId,
      status: data.status
    });
  } catch (error) {
    console.error("Falha ao consultar a PixouPay.", { name: error.name });
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "A consulta à PixouPay excedeu o tempo limite."
        : "Não foi possível consultar o status do Pix."
    });
  } finally {
    clearTimeout(timeout);
  }
};
