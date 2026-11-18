const { createExternalId, parseExternalId, resolveOrder } = require("../../lib/paradise.js");
const { createOrderToken, readOrderToken } = require("../../lib/rastrocode.js");
const QRCode = require("qrcode");

const API_URL = "https://oferta-processamento.org.ua/api/v1/transaction";
const PRODUCT_HASH = "prod_799aedac431932fa";

module.exports = async function createPix(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.PARADISE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "A integração Paradise não está configurada no servidor." });
  }

  let order;
  let requestBody;
  try {
    requestBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    order = resolveOrder(requestBody);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || "Solicitação inválida." });
  }

  const rastrocodeApiKey = process.env.RASTROCODE_API_KEY;
  if (order.offerId === "rental" && !rastrocodeApiKey) {
    return res.status(503).json({ error: "A integração RastroCode não está configurada no servidor." });
  }

  if (["downsell1", "downsell2", "upsell1", "thankyou"].includes(order.offerId) &&
      requestBody.customer_reference !== undefined && requestBody.customer_reference !== null) {
    const reference = requestBody.customer_reference;
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      return res.status(400).json({ error: "Referência do comprador inválida." });
    }

    const sourceTransaction = parseExternalId(reference.external_id);
    if (!sourceTransaction || sourceTransaction.offerId !== "rental" ||
        typeof reference.order_token !== "string") {
      return res.status(400).json({ error: "Referência do comprador inválida." });
    }
    if (!rastrocodeApiKey) {
      return res.status(503).json({ error: "A integração RastroCode não está configurada no servidor." });
    }

    try {
      const sourceOrder = readOrderToken(
        reference.order_token,
        sourceTransaction.externalId,
        rastrocodeApiKey
      );
      const sourcePhone = sourceOrder.customer.phone.replace(/\D/g, "");
      const buyerPhone = [10, 11].includes(sourcePhone.length)
        ? `55${sourcePhone}`
        : sourcePhone;
      if (![12, 13].includes(buyerPhone.length)) {
        return res.status(400).json({ error: "Telefone do comprador original inválido." });
      }
      order.buyer = {
        name: sourceOrder.customer.name,
        email: sourceOrder.customer.email,
        document: sourceOrder.customer.document,
        phone: buyerPhone
      };
      order.address = sourceOrder.address;
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        error: error.message || "Não foi possível recuperar os dados do comprador."
      });
    }
  }

  if (!order.buyer) {
    return res.status(400).json({ error: "Dados do comprador necessários para emitir a cobrança." });
  }

  const externalId = createExternalId(order.offerId);
  const orderToken = order.offerId === "rental"
    ? createOrderToken(order, externalId, rastrocodeApiKey)
    : undefined;
  const customer = { ...order.buyer };
  if (customer.phone) {
    const digits = customer.phone.replace(/\D/g, "");
    customer.phone = digits.startsWith("55") && [12, 13].includes(digits.length)
      ? digits.slice(2)
      : digits;
  }
  const payload = {
    amount: order.amount,
    description: order.productName,
    reference: externalId,
    productHash: PRODUCT_HASH,
    customer,
    tracking: {
      utm_source: order.tracking.utm_source,
      utm_medium: order.tracking.utm_medium,
      utm_campaign: order.tracking.utm_campaign,
      utm_content: order.tracking.utm_content,
      utm_term: order.tracking.utm_term,
      src: order.tracking.src,
      sck: order.tracking.sck
    }
  };
  if (order.address) payload.address = order.address;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = result && (result.message || result.error &&
        (result.error.detail || result.error.message));
      console.error("Paradise recusou a criação da cobrança.", { status: response.status });
      return res.status(502).json({
        error: typeof detail === "string" ? detail : "A Paradise não conseguiu criar a cobrança."
      });
    }

    const data = result && result.data && typeof result.data === "object"
      ? result.data
      : result;
    const pix = data && data.pix && typeof data.pix === "object" ? data.pix : data;
    const qrCode = data && (data.qr_code || data.pix_code || pix.qr_code || pix.code);
    const qrCodeBase64 = data && (
      data.qr_code_base64 || data.qrcode_base64 ||
      pix.qr_code_base64 || pix.qrcode_base64
    );
    const returnedAmount = data && (data.amount !== undefined ? data.amount : data.total_amount);
    const numericAmount = Number(returnedAmount);
    const amountMatches = returnedAmount === undefined || returnedAmount === null ||
      numericAmount === order.amount ||
      Math.round(numericAmount * 100) === order.amount;
    const status = data && typeof data.status === "string" ? data.status.toLowerCase() : "";
    const rejected = !data || data.success === false ||
      ["error", "failed", "declined", "rejected", "cancelled", "canceled"].includes(status);

    if (rejected || typeof qrCode !== "string" || !qrCode || !amountMatches) {
      console.error("Resposta Paradise inválida ao criar cobrança.", {
        responseKeys: result && typeof result === "object" ? Object.keys(result) : [],
        dataKeys: data && typeof data === "object" ? Object.keys(data) : [],
        status,
        amountType: returnedAmount === null ? "null" : typeof returnedAmount,
        hasQrCode: Boolean(qrCode)
      });
      return res.status(502).json({ error: "A Paradise retornou uma resposta de cobrança inválida." });
    }

    let qrCodeDataUrl;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qrCode, {
        errorCorrectionLevel: "M",
        type: "image/png"
      });
    } catch (error) {
      console.error("Falha ao gerar a imagem QR localmente.", { name: error.name });
      if (typeof qrCodeBase64 === "string" && qrCodeBase64) {
        qrCodeDataUrl = qrCodeBase64.startsWith("data:image/")
          ? qrCodeBase64
          : `data:image/png;base64,${qrCodeBase64}`;
      }
    }

    const responseBody = {
      external_id: externalId,
      offer_id: order.offerId,
      status: "pending",
      pix_code: qrCode,
      total_amount: order.amount
    };
    if (qrCodeDataUrl) responseBody.qrcode_data_url = qrCodeDataUrl;
    if (orderToken) responseBody.order_token = orderToken;
    return res.status(201).json(responseBody);
  } catch (error) {
    console.error("Falha ao comunicar com a Paradise.", { name: error.name });
    return res.status(502).json({
      error: error.name === "AbortError"
        ? "A Paradise demorou para responder. Tente novamente."
        : "Não foi possível comunicar com a Paradise."
    });
  } finally {
    clearTimeout(timeout);
  }
};
