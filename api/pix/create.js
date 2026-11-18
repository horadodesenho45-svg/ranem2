const { createExternalId, resolveOrder } = require("../../lib/pixoupay.js");
const { createOrderToken } = require("../../lib/rastrocode.js");

const API_URL = "https://api.pixoupay.com/charge";

module.exports = async function createPix(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const token = process.env.PIXOUPAY_SECRET_TOKEN;
  if (!token) {
    return res.status(503).json({ error: "A integração PixouPay não está configurada no servidor." });
  }

  let order;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    order = resolveOrder(body);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || "Solicitação inválida." });
  }

  const rastrocodeApiKey = process.env.RASTROCODE_API_KEY;
  if (order.offerId === "rental" && !rastrocodeApiKey) {
    return res.status(503).json({ error: "A integração RastroCode não está configurada no servidor." });
  }

  const externalId = createExternalId(order.offerId);
  const orderToken = order.offerId === "rental"
    ? createOrderToken(order, externalId, rastrocodeApiKey)
    : undefined;
  const payload = {
    external_id: externalId,
    payment_method: "pix",
    amount: order.amount,
    product: { name: order.productName },
    tracking: order.tracking
  };
  if (order.buyer) payload.buyer = order.buyer;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = result && result.error && (result.error.detail || result.error.message);
      console.error("PixouPay recusou a criação da cobrança.", { status: response.status });
      return res.status(502).json({
        error: typeof detail === "string" ? detail : "A PixouPay não conseguiu criar a cobrança."
      });
    }

    const data = result && result.data;
    if (!data || !data.id || data.payment_method !== "pix" || !data.pix ||
        typeof data.pix.code !== "string" || !data.pix.code ||
        typeof data.pix.qrcode_base64 !== "string" || !data.pix.qrcode_base64 ||
        data.total_amount !== order.amount) {
      console.error("Resposta PixouPay inválida ao criar cobrança.");
      return res.status(502).json({ error: "A PixouPay retornou uma resposta de cobrança inválida." });
    }

    const responseBody = {
      external_id: externalId,
      offer_id: order.offerId,
      status: data.status,
      pix_code: data.pix.code,
      qrcode_base64: data.pix.qrcode_base64,
      total_amount: data.total_amount
    };
    if (orderToken) responseBody.order_token = orderToken;
    return res.status(201).json(responseBody);
  } catch (error) {
    console.error("Falha ao comunicar com a PixouPay.", { name: error.name });
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "A PixouPay demorou para responder. Tente novamente."
        : "Não foi possível comunicar com a PixouPay."
    });
  } finally {
    clearTimeout(timeout);
  }
};
