const crypto = require("node:crypto");

const API_URL = "https://app.rastrocode.site/api/v1/orders";

function deriveTokenKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("A integração RastroCode não está configurada no servidor.");
  }
  return crypto.createHash("sha256")
    .update("rastrocode-order-token\0")
    .update(apiKey)
    .digest();
}

function amountInReais(amountInCents) {
  return Number((amountInCents / 100).toFixed(2));
}

function buildOrderPayload(order, externalId) {
  const phone = order.buyer.phone.replace(/\D/g, "");
  const localPhone = phone.startsWith("55") && [12, 13].includes(phone.length)
    ? phone.slice(2)
    : phone;

  if (![10, 11].includes(localPhone.length)) {
    throw new Error("Telefone inválido para criar o pedido RastroCode.");
  }

  const total = amountInReais(order.amount);
  return {
    transaction_id: externalId,
    customer: {
      name: order.buyer.name,
      email: order.buyer.email,
      phone: localPhone,
      document: order.buyer.document
    },
    address: order.address,
    products: [{
      name: order.productName,
      quantity: 1,
      price: total
    }],
    total
  };
}

function createOrderToken(order, externalId, apiKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveTokenKey(apiKey), iv);
  cipher.setAAD(Buffer.from(externalId));
  const payload = Buffer.from(JSON.stringify(buildOrderPayload(order, externalId)));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);

  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url")
  ].join(".");
}

function readOrderToken(token, externalId, apiKey) {
  if (typeof token !== "string" || token.length > 20000) {
    throw new Error("Token de pedido RastroCode inválido.");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error("Token de pedido RastroCode inválido.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveTokenKey(apiKey),
    Buffer.from(parts[0], "base64url")
  );
  decipher.setAAD(Buffer.from(externalId));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parts[1], "base64url")),
    decipher.final()
  ]);
  const payload = JSON.parse(plaintext.toString("utf8"));

  if (!payload || payload.transaction_id !== externalId ||
      !payload.customer || !payload.address || !Array.isArray(payload.products) ||
      payload.products.length !== 1 || !Number.isFinite(payload.total)) {
    throw new Error("Dados do pedido RastroCode inválidos.");
  }

  const product = payload.products[0];
  if (!Number.isInteger(product.quantity) || product.quantity < 1 ||
      !Number.isFinite(product.price) ||
      Math.round(product.price * product.quantity * 100) !== Math.round(payload.total * 100)) {
    throw new Error("Total do pedido RastroCode inválido.");
  }

  return payload;
}

async function createRastroCodeOrder(token, externalId, apiKey) {
  const payload = readOrderToken(token, externalId, apiKey);
  payload.paid_at = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

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

    if (!response.ok && response.status !== 409) {
      const error = new Error("A RastroCode não conseguiu criar o pedido.");
      error.statusCode = response.status;
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { createOrderToken, createRastroCodeOrder, readOrderToken };
