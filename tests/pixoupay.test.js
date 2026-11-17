const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const createPix = require("../api/pix/create.js");
const getPixStatus = require("../api/pix/status.js");
const { parseExternalId, resolveOrder } = require("../lib/pixoupay.js");

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test("calcula ofertas no servidor e ignora valores enviados pelo navegador", () => {
  const upsell = resolveOrder({ offerId: "upsell1", amount: 1 });
  assert.equal(upsell.amount, 2190);

  const extension = resolveOrder({ offerId: "downsell1", consoleName: "ps5" });
  assert.equal(extension.amount, 3219);
});

test("valida console, jogos e parâmetros UTM aceitos pela adquirente", () => {
  assert.throws(
    () => resolveOrder({
      offerId: "rental",
      consoleName: "xbox",
      planId: "7dias",
      extraController: false,
      games: ["The Last of Us Part II"],
      delivery: "free",
      buyer: { name: "Maria Silva", email: "maria@example.com" }
    }),
    /não estão disponíveis/
  );

  const order = resolveOrder({
    offerId: "upsell1",
    tracking: {
      utm_source: "facebook",
      utm_campaign: "black-friday",
      utm_custom: "not-supported"
    }
  });
  assert.equal(order.tracking.utm_source, "facebook");
  assert.equal(Object.prototype.hasOwnProperty.call(order.tracking, "utm_custom"), false);
});

test("captura UTMs do Facebook na sessão para repassá-las no checkout", () => {
  const values = new Map();
  const context = {
    URLSearchParams,
    console: { warn() {} },
    document: {},
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    window: {
      location: {
        origin: "https://example.test",
        search: "?utm_source=facebook&utm_medium=paid_social&utm_campaign=campa%C3%B1a&utm_id=ad-42&utm_custom=ignored"
      }
    }
  };
  const script = fs.readFileSync(require.resolve("../js/pix-payment.js"), "utf8");
  vm.runInNewContext(script, context);

  const stored = JSON.parse(values.get("pixou-tracking"));
  assert.equal(stored.utm_source, "facebook");
  assert.equal(stored.utm_medium, "paid_social");
  assert.equal(stored.utm_campaign, "campaña");
  assert.equal(stored.utm_id, "ad-42");
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "utm_custom"), false);
});

test("cria cobrança Pix com valor calculado e token apenas no header", async () => {
  const previousToken = process.env.PIXOUPAY_SECRET_TOKEN;
  const previousFetch = global.fetch;
  let request;
  process.env.PIXOUPAY_SECRET_TOKEN = "test-secret";
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          id: "provider-id",
          status: "pending",
          payment_method: "pix",
          pix: { code: "pix-copy-code", qrcode_base64: "cXJjb2Rl" },
          total_amount: 2190
        }
      })
    };
  };

  try {
    const response = createResponse();
    await createPix({
      method: "POST",
      body: {
        offerId: "upsell1",
        amount: 1,
        tracking: { utm_source: "facebook", utm_id: "campaign-1" }
      }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(request.url, "https://api.pixoupay.com/charge");
    assert.equal(request.options.headers.Authorization, "Bearer test-secret");
    assert.equal(request.options.body.includes("test-secret"), false);
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.amount, 2190);
    assert.equal(payload.payment_method, "pix");
    assert.equal(payload.tracking.utm_source, "facebook");
    assert.equal(payload.tracking.utm_id, "campaign-1");
    assert.equal(response.body.pix_code, "pix-copy-code");
    assert.ok(parseExternalId(response.body.external_id));
  } finally {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.PIXOUPAY_SECRET_TOKEN;
    else process.env.PIXOUPAY_SECRET_TOKEN = previousToken;
  }
});

test("consulta o status pela API protegida da PixouPay", async () => {
  const previousToken = process.env.PIXOUPAY_SECRET_TOKEN;
  const previousFetch = global.fetch;
  const externalId = "gta-rental-123e4567-e89b-12d3-a456-426614174000";
  let requestedUrl;
  process.env.PIXOUPAY_SECRET_TOKEN = "test-secret";
  global.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { status: "paid" } })
    };
  };

  try {
    const response = createResponse();
    await getPixStatus({ method: "GET", query: { external_id: externalId } }, response);
    assert.equal(requestedUrl.origin, "https://api.pixoupay.com");
    assert.equal(requestedUrl.pathname, "/transaction");
    assert.equal(requestedUrl.searchParams.get("external_id"), externalId);
    assert.deepEqual(response.body, {
      external_id: externalId,
      offer_id: "rental",
      status: "paid"
    });
  } finally {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.PIXOUPAY_SECRET_TOKEN;
    else process.env.PIXOUPAY_SECRET_TOKEN = previousToken;
  }
});
