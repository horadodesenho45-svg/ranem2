const crypto = require("node:crypto");
const { rentalPlans, rentalRegularPrice, rentalGamePrice } = require("../js/rental-plans.js");

const trackingFields = [
  "ref",
  "src",
  "sck",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content"
];

const games = new Map([
  ["Call of Duty: Modern Warfare 4", false],
  ["The Last of Us Part II", true],
  ["EA Sports FC 26", false],
  ["EA Sports FC 27", false],
  ["Call of Duty: Modern Warfare III", false],
  ["Call of Duty: Modern Warfare II", false],
  ["God of War Ragnarök", true],
  ["Call of Duty: Vanguard", false],
  ["The Last of Us", true],
  ["Grand Theft Auto V", false]
]);

const consoles = {
  ps5: "PlayStation 5 Slim",
  xbox: "Xbox Series X"
};

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeTracking(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const tracking = {};

  for (const field of trackingFields) {
    const item = source[field];
    if (item === undefined || item === null || item === "") {
      tracking[field] = null;
      continue;
    }

    if (typeof item !== "string" || item.length > 500) {
      throw badRequest(`Parâmetro de rastreamento inválido: ${field}.`);
    }

    tracking[field] = item;
  }

  return tracking;
}

function normalizeBuyer(value, required) {
  if (value === undefined || value === null) {
    if (required) throw badRequest("Informe nome e e-mail do comprador.");
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Dados do comprador inválidos.");
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const document = typeof value.document === "string" ? value.document.replace(/\D/g, "") : "";
  let phone = typeof value.phone === "string" ? value.phone.replace(/\D/g, "") : "";

  if (!name && !email && !document && !phone && !required) return undefined;
  if (name.length < 3 || name.length > 100) throw badRequest("Nome do comprador inválido.");
  if (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("E-mail do comprador inválido.");
  }
  if (document && ![11, 14].includes(document.length)) {
    throw badRequest("CPF/CNPJ deve conter 11 ou 14 dígitos.");
  }
  if (phone && [10, 11].includes(phone.length)) phone = `55${phone}`;
  if (phone && ![12, 13].includes(phone.length)) {
    throw badRequest("Telefone deve conter DDD e número.");
  }

  const buyer = { name, email };
  if (document) buyer.document = document;
  if (phone) buyer.phone = phone;
  return buyer;
}

function getPlan(planId, consoleName) {
  const plan = rentalPlans.find((item) => item.checkoutPath === planId);
  if (!plan || !Object.prototype.hasOwnProperty.call(plan.prices, consoleName)) {
    throw badRequest("Plano ou console inválido.");
  }
  return plan;
}

function resolveOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Corpo da solicitação inválido.");
  }

  const { offerId, consoleName } = body;
  let amount;
  let productName;
  let buyer;

  if (offerId === "rental") {
    if (!Object.prototype.hasOwnProperty.call(consoles, consoleName)) {
      throw badRequest("Console inválido.");
    }

    const plan = getPlan(body.planId, consoleName);
    amount = plan.prices[consoleName];
    productName = `Aluguel ${consoles[consoleName]} - ${plan.label}`;

    if (body.extraController === true) {
      amount += 1344;
      productName += " + controle extra";
    } else if (body.extraController !== false) {
      throw badRequest("Seleção do controle extra inválida.");
    }

    if (!Array.isArray(body.games) || body.games.length > games.size) {
      throw badRequest("Seleção de jogos inválida.");
    }
    const selectedGames = new Set(body.games);
    if (selectedGames.size !== body.games.length) {
      throw badRequest("Há jogos repetidos na seleção.");
    }
    for (const game of selectedGames) {
      if (!games.has(game) || (consoleName === "xbox" && games.get(game))) {
        throw badRequest("Um ou mais jogos não estão disponíveis para o console.");
      }
    }
    amount += selectedGames.size * rentalGamePrice;
    if (selectedGames.size) productName += ` + ${selectedGames.size} jogo(s)`;

    if (body.delivery !== "free" && body.delivery !== "express") {
      throw badRequest("Opção de entrega inválida.");
    }
    if (body.delivery === "express") {
      amount += 1290;
      productName += " + entrega expressa";
    }

    buyer = normalizeBuyer(body.buyer, true);
  } else if (offerId === "downsell1" || offerId === "downsell2" || offerId === "thankyou") {
    if (!Object.prototype.hasOwnProperty.call(consoles, consoleName)) {
      throw badRequest("Console inválido.");
    }

    const planId = offerId === "downsell1" ? "15dias" : offerId === "downsell2" ? "7dias" : "1mes";
    const plan = getPlan(planId, consoleName);
    amount = Math.round(rentalRegularPrice(plan.prices[consoleName]) * 0.2);
    const additionalPeriod = offerId === "downsell1" ? "15 dias" :
      offerId === "downsell2" ? "7 dias" : "1 mês";
    productName = `Extensão de ${additionalPeriod} - ${consoles[consoleName]}`;
  } else if (offerId === "upsell1") {
    amount = 2190;
    productName = "Battlefield 1, Battlefield V e Battlefield 6";
  } else {
    throw badRequest("Oferta inválida.");
  }

  if (!Number.isInteger(amount) || amount < 600 || amount > 300000) {
    throw badRequest("O valor calculado está fora dos limites aceitos pela PixouPay.");
  }

  return {
    offerId,
    amount,
    productName,
    buyer,
    tracking: normalizeTracking(body.tracking)
  };
}

function createExternalId(offerId) {
  return `gta-${offerId}-${crypto.randomUUID()}`;
}

function parseExternalId(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^gta-(rental|downsell1|downsell2|thankyou|upsell1)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? { offerId: match[1], externalId: value } : null;
}

module.exports = { createExternalId, normalizeTracking, parseExternalId, resolveOrder };
