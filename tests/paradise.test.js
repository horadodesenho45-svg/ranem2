const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const createPix = require("../api/pix/create.js");
const getPixStatus = require("../api/pix/status.js");
const { parseExternalId, resolveOrder } = require("../lib/paradise.js");
const { rentalMaxOrderBumps } = require("../js/rental-plans.js");
const { createOrderToken } = require("../lib/rastrocode.js");

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

function rentalBody() {
  return {
    offerId: "rental",
    consoleName: "ps5",
    planId: "7dias",
    extraController: false,
    games: [],
    delivery: "free",
    buyer: {
      name: "Maria Silva",
      email: "maria@example.com",
      document: "52998224725",
      phone: "11987654321"
    },
    address: {
      street: "Rua Exemplo",
      number: "123",
      complement: "",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipcode: "01001000"
    }
  };
}

test("calcula ofertas no servidor e ignora valores enviados pelo navegador", () => {
  const upsell = resolveOrder({ offerId: "upsell1", amount: 1 });
  assert.equal(upsell.amount, 2190);

  const extension = resolveOrder({ offerId: "downsell1", consoleName: "ps5" });
  assert.equal(extension.amount, 3219);
});

test("limita order bumps somente no plano de 2 meses e respeita o teto da Paradise", () => {
  assert.equal(rentalMaxOrderBumps("2meses", "ps5"), 2);
  assert.equal(rentalMaxOrderBumps("2meses", "xbox"), 5);
  assert.equal(rentalMaxOrderBumps("1mes", "ps5"), Infinity);

  assert.throws(
    () => resolveOrder({
      ...rentalBody(),
      planId: "2meses",
      games: [
        "Call of Duty: Modern Warfare 4",
        "The Last of Us Part II",
        "EA Sports FC 26"
      ]
    }),
    /quantidade de jogos adicionais excede/
  );
  assert.equal(resolveOrder({
    ...rentalBody(),
    planId: "1mes",
    games: Array.from([
      "Call of Duty: Modern Warfare 4",
      "The Last of Us Part II",
      "EA Sports FC 26"
    ])
  }).amount, 26554);
});

test("valida comprador e endereço completos para o aluguel inicial", () => {
  const order = resolveOrder(rentalBody());
  assert.equal(order.buyer.phone, "5511987654321");
  assert.deepEqual(order.address, {
    street: "Rua Exemplo",
    number: "123",
    complement: "",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    zipcode: "01001000"
  });
  assert.throws(
    () => resolveOrder({ ...rentalBody(), address: { ...rentalBody().address, zipcode: "01001" } }),
    /CEP deve conter 8 dígitos/
  );
  assert.throws(
    () => resolveOrder({ ...rentalBody(), buyer: { ...rentalBody().buyer, phone: "" } }),
    /telefone do comprador/
  );
});

test("desativa o preenchimento automático do navegador nos campos de endereço", () => {
  const html = fs.readFileSync(require.resolve("../checkout.html"), "utf8");
  const fieldIds = [
    "rental-postal-code",
    "rental-address-number",
    "rental-address-street",
    "rental-address-complement",
    "rental-address-neighborhood",
    "rental-address-city",
    "rental-address-state"
  ];

  for (const id of fieldIds) {
    const field = html.match(new RegExp(`<(?:input|select)\\b[^>]*id="${id}"[^>]*>`));
    assert.ok(field, `missing address field ${id}`);
    assert.match(field[0], /autocomplete="off"/, `${id} must not request browser autofill`);
  }
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
        search: "?ref=ref-123&src=instagram&sck=click-42&utm_source=instagram&utm_medium=paid_social&utm_campaign=black_friday_2026&utm_content=criativo_video_01&utm_term=vape&utm_id=campanha_123&utm_custom=ignored"
      }
    }
  };
  const script = fs.readFileSync(require.resolve("../js/pix-payment.js"), "utf8");
  vm.runInNewContext(script, context);

  const stored = JSON.parse(values.get("pixou-tracking"));
  assert.equal(stored.ref, "ref-123");
  assert.equal(stored.src, "instagram");
  assert.equal(stored.sck, "click-42");
  assert.equal(stored.utm_source, "instagram");
  assert.equal(stored.utm_medium, "paid_social");
  assert.equal(stored.utm_campaign, "black_friday_2026");
  assert.equal(stored.utm_content, "criativo_video_01");
  assert.equal(stored.utm_term, "vape");
  assert.equal(stored.utm_id, "campanha_123");
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "utm_custom"), false);
});

test("reaproveita o token do aluguel no adicional e mantém o polling pendente", async () => {
  const timers = [];
  const storage = new Map();
  const createRequests = [];
  const statusResults = [
    { status: "paid", rastrocode_order_status: "created" },
    { status: "pending" }
  ];
  const createResults = [
    {
      external_id: "gta-rental-123e4567-e89b-12d3-a456-426614174000",
      pix_code: "rental-pix-code",
      qrcode_base64: "cXJjb2Rl",
      order_token: "encrypted-rental-token"
    },
    {
      external_id: "gta-downsell1-123e4567-e89b-12d3-a456-426614174001",
      pix_code: "addon-pix-code",
      qrcode_base64: "cXJjb2Rl"
    }
  ];
  let dialog;
  const createElement = () => ({
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    addEventListener() {},
    close() {
      this.open = false;
    },
    querySelector(selector) {
      const className = selector.slice(1);
      return this.children.find((child) => child.className === className) || null;
    },
    removeAttribute() {},
    setAttribute() {},
    showModal() {
      this.open = true;
    }
  });
  const context = {
    URL,
    URLSearchParams,
    console: { warn() {} },
    document: {
      body: {
        append(element) {
          dialog = element;
        }
      },
      createElement
    },
    fetch: async (url, options) => {
      if (url === "/api/pix/create") {
        createRequests.push(JSON.parse(options.body));
        return { ok: true, json: async () => createResults.shift() };
      }
      return { ok: true, json: async () => statusResults.shift() };
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    window: {
      location: {
        origin: "https://example.test",
        search: ""
      }
    }
  };
  const script = fs.readFileSync(require.resolve("../js/pix-payment.js"), "utf8");
  vm.runInNewContext(script, context);

  await context.window.pixPayment.create({
    offerId: "rental",
    consoleName: "ps5",
    details: {
      buyer: {
        name: "Maria Silva",
        email: "maria@example.com",
        document: "52998224725",
        phone: "5511987654321"
      }
    },
    onPaid() {}
  });
  await timers.shift()();

  await context.window.pixPayment.create({
    offerId: "downsell1",
    consoleName: "ps5"
  });
  await timers.shift()();

  assert.deepEqual(createRequests[1].customer_reference, {
    external_id: "gta-rental-123e4567-e89b-12d3-a456-426614174000",
    order_token: "encrypted-rental-token"
  });
  assert.equal(
    dialog.querySelector(".rental-pix-dialog__status").textContent,
    "Aguardando a confirmação do pagamento..."
  );
});

test("instala o pixel e o script de UTMs da UTMify em todas as páginas HTML", () => {
  const root = path.resolve(__dirname, "..");
  const pages = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length > 0);

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const pixelScript = '<script async defer src="https://cdn.utmify.com.br/scripts/pixel/pixel.js"></script>';
    const utmsScript = '<script async defer src="https://cdn.utmify.com.br/scripts/utms/latest.js" data-utmify-prevent-xcod-sck data-utmify-prevent-subids></script>';
    assert.equal(html.split(pixelScript).length - 1, 1, `${page} must load one UTMify pixel`);
    assert.equal(html.split(utmsScript).length - 1, 1, `${page} must load one UTMify UTMs script`);
    const pixelIdIndex = html.indexOf('window.pixelId = "6afcee25a7d2a14d9fbb519b";');
    assert.ok(pixelIdIndex >= 0 && pixelIdIndex < html.indexOf(pixelScript),
      `${page} must set pixelId before loading the pixel`);
  }
});

test("cria cobrança Pix com product hash e chave apenas no header", async () => {
  const previousApiKey = process.env.PARADISE_API_KEY;
  const previousRastroCodeKey = process.env.RASTROCODE_API_KEY;
  const previousFetch = global.fetch;
  let request;
  process.env.PARADISE_API_KEY = "test-secret";
  process.env.RASTROCODE_API_KEY = "test-rastrocode-key";
  const tracking = {
    ref: "ref-123",
    src: "instagram",
    sck: "click-42",
    utm_source: "instagram",
    utm_medium: "paid_social",
    utm_campaign: "black_friday_2026",
    utm_content: "criativo_video_01",
    utm_term: "vape",
    utm_id: "campanha_123"
  };
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        status: "success",
        transaction_id: 123,
        id: "provider-reference",
        qr_code: "pix-copy-code",
        qr_code_base64: "data:image/png;base64,cXJjb2Rl",
        amount: 6790
      })
    };
  };

  try {
    const response = createResponse();
    await createPix({
      method: "POST",
      body: {
        ...rentalBody(),
        tracking
      }
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(request.url, "https://oferta-processamento.org.ua/api/v1/transaction");
    assert.equal(request.options.headers["X-API-Key"], "test-secret");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.body.includes("test-secret"), false);
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.amount, 6790);
    assert.equal(payload.description, "Aluguel PlayStation 5 Slim - 7 dias");
    assert.equal(payload.reference, response.body.external_id);
    assert.equal(payload.productHash, "prod_799aedac431932fa");
    assert.deepEqual(payload.customer, {
      ...resolveOrder(rentalBody()).buyer,
      phone: "11987654321"
    });
    assert.deepEqual(payload.address, rentalBody().address);
    assert.deepEqual(payload.tracking, {
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "black_friday_2026",
      utm_content: "criativo_video_01",
      utm_term: "vape",
      src: "instagram",
      sck: "click-42"
    });
    assert.equal(response.body.pix_code, "pix-copy-code");
    assert.equal(response.body.qrcode_base64, "cXJjb2Rl");
    assert.ok(parseExternalId(response.body.external_id));
  } finally {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.PARADISE_API_KEY;
    else process.env.PARADISE_API_KEY = previousApiKey;
    if (previousRastroCodeKey === undefined) delete process.env.RASTROCODE_API_KEY;
    else process.env.RASTROCODE_API_KEY = previousRastroCodeKey;
  }
});

test("envia os dados reais do aluguel nos Pix dos adicionais", async () => {
  const previousApiKey = process.env.PARADISE_API_KEY;
  const previousRastroCodeKey = process.env.RASTROCODE_API_KEY;
  const previousFetch = global.fetch;
  const sourceExternalId = "gta-rental-123e4567-e89b-12d3-a456-426614174000";
  const sourceBuyer = resolveOrder(rentalBody()).buyer;
  process.env.PARADISE_API_KEY = "test-pix-secret";
  process.env.RASTROCODE_API_KEY = "test-rastrocode-key";
  const orderToken = createOrderToken(
    resolveOrder(rentalBody()),
    sourceExternalId,
    process.env.RASTROCODE_API_KEY
  );
  const providerRequests = [];
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    providerRequests.push({ url, options, payload });
    return {
      ok: true,
      status: 201,
      json: async () => ({
        status: "success",
        transaction_id: 123,
        id: payload.reference,
        qr_code: "pix-copy-code",
        qr_code_base64: "cXJjb2Rl",
        amount: payload.amount
      })
    };
  };

  try {
    for (const offerId of ["downsell1", "downsell2", "upsell1", "thankyou"]) {
      const expectedOrder = resolveOrder({ offerId, consoleName: "ps5" });
      const response = createResponse();
      await createPix({
        method: "POST",
        body: {
          offerId,
          consoleName: "ps5",
          customer_reference: {
            external_id: sourceExternalId,
            order_token: orderToken
          }
        }
      }, response);

      assert.equal(response.statusCode, 201);
      assert.equal(providerRequests.at(-1).payload.amount, expectedOrder.amount);
      assert.deepEqual(providerRequests.at(-1).payload.customer, {
        ...sourceBuyer,
        phone: "11987654321"
      });
      assert.deepEqual(providerRequests.at(-1).payload.address, rentalBody().address);
    }
  } finally {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.PARADISE_API_KEY;
    else process.env.PARADISE_API_KEY = previousApiKey;
    if (previousRastroCodeKey === undefined) delete process.env.RASTROCODE_API_KEY;
    else process.env.RASTROCODE_API_KEY = previousRastroCodeKey;
  }
});

test("consulta status e converte approved para pago na API Paradise", async () => {
  const previousApiKey = process.env.PARADISE_API_KEY;
  const previousFetch = global.fetch;
  const externalId = "gta-upsell1-123e4567-e89b-12d3-a456-426614174000";
  let requestedUrl;
  process.env.PARADISE_API_KEY = "test-secret";
  global.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers["X-API-Key"], "test-secret");
    return {
      ok: true,
      status: 200,
      json: async () => [{ external_id: externalId, status: "approved" }]
    };
  };

  try {
    const response = createResponse();
    await getPixStatus({ method: "GET", query: { external_id: externalId } }, response);
    assert.equal(requestedUrl.origin, "https://oferta-processamento.org.ua");
    assert.equal(requestedUrl.pathname, "/api/v1/query");
    assert.equal(requestedUrl.searchParams.get("action"), "list_transactions");
    assert.equal(requestedUrl.searchParams.get("external_id"), externalId);
    assert.deepEqual(response.body, {
      external_id: externalId,
      offer_id: "upsell1",
      status: "paid"
    });
  } finally {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.PARADISE_API_KEY;
    else process.env.PARADISE_API_KEY = previousApiKey;
  }
});

test("cria pedido RastroCode só após pagamento e reutiliza o transaction_id", async () => {
  const previousApiKey = process.env.PARADISE_API_KEY;
  const previousRastroCodeKey = process.env.RASTROCODE_API_KEY;
  const previousFetch = global.fetch;
  const previousConsoleError = console.error;
  let pixStatus = "pending";
  let rastroRequest;
  let rastroCallCount = 0;
  process.env.PARADISE_API_KEY = "test-pix-secret";
  process.env.RASTROCODE_API_KEY = "test-rastrocode-key";
  global.fetch = async (url, options) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/api/v1/transaction") {
      assert.equal(options.headers["X-API-Key"], "test-pix-secret");
      return {
        ok: true,
        status: 201,
        json: async () => ({
          status: "success",
          transaction_id: 123,
          id: "provider-reference",
          qr_code: "pix-copy-code",
          qr_code_base64: "cXJjb2Rl",
          amount: 6790
        })
      };
    }
    if (requestUrl.pathname === "/api/v1/query") {
      return {
        ok: true,
        status: 200,
        json: async () => [{ external_id: requestUrl.searchParams.get("external_id"),
          status: pixStatus === "paid" ? "approved" : pixStatus }]
      };
    }
    assert.equal(requestUrl.href, "https://app.rastrocode.site/api/v1/orders");
    rastroCallCount++;
    rastroRequest = { options, payload: JSON.parse(options.body) };
    if (rastroCallCount === 1) return { ok: false, status: 503 };
    if (rastroCallCount === 2) return { ok: true, status: 201 };
    return { ok: false, status: 409 };
  };
  console.error = () => {};

  try {
    const createChargeResponse = createResponse();
    await createPix({ method: "POST", body: rentalBody() }, createChargeResponse);
    assert.equal(createChargeResponse.statusCode, 201);
    assert.equal(typeof createChargeResponse.body.order_token, "string");
    assert.equal(createChargeResponse.body.order_token.includes("Rua Exemplo"), false);

    const externalId = createChargeResponse.body.external_id;
    const pendingResponse = createResponse();
    await getPixStatus({
      method: "GET",
      query: { external_id: externalId, order_token: createChargeResponse.body.order_token }
    }, pendingResponse);
    assert.equal(pendingResponse.body.status, "pending");
    assert.equal(rastroCallCount, 0);

    pixStatus = "paid";
    const paidResponse = createResponse();
    await getPixStatus({
      method: "GET",
      query: { external_id: externalId, order_token: createChargeResponse.body.order_token }
    }, paidResponse);
    assert.equal(paidResponse.body.status, "paid");
    assert.equal(paidResponse.body.rastrocode_order_status, "pending");
    assert.equal(rastroCallCount, 1);

    const retryPaidResponse = createResponse();
    await getPixStatus({
      method: "GET",
      query: { external_id: externalId, order_token: createChargeResponse.body.order_token }
    }, retryPaidResponse);
    assert.equal(retryPaidResponse.body.rastrocode_order_status, "created");
    assert.equal(rastroCallCount, 2);
    assert.equal(rastroRequest.options.headers["X-API-Key"], "test-rastrocode-key");
    assert.equal(rastroRequest.options.headers.Authorization, undefined);
    assert.equal(rastroRequest.payload.transaction_id, externalId);
    assert.match(rastroRequest.payload.paid_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.deepEqual(rastroRequest.payload.customer, {
      name: "Maria Silva",
      email: "maria@example.com",
      phone: "11987654321",
      document: "52998224725"
    });
    assert.deepEqual(rastroRequest.payload.address, rentalBody().address);
    assert.deepEqual(rastroRequest.payload.products, [{
      name: "Aluguel PlayStation 5 Slim - 7 dias",
      quantity: 1,
      price: 67.9
    }]);
    assert.equal(rastroRequest.payload.total, 67.9);

    const retryResponse = createResponse();
    await getPixStatus({
      method: "GET",
      query: { external_id: externalId, order_token: createChargeResponse.body.order_token }
    }, retryResponse);
    assert.equal(retryResponse.body.rastrocode_order_status, "created");
    assert.equal(rastroCallCount, 3);
  } finally {
    global.fetch = previousFetch;
    console.error = previousConsoleError;
    if (previousApiKey === undefined) delete process.env.PARADISE_API_KEY;
    else process.env.PARADISE_API_KEY = previousApiKey;
    if (previousRastroCodeKey === undefined) delete process.env.RASTROCODE_API_KEY;
    else process.env.RASTROCODE_API_KEY = previousRastroCodeKey;
  }
});

test("bloqueia aluguel pago quando a chave RastroCode não está configurada", async () => {
  const previousApiKey = process.env.PARADISE_API_KEY;
  const previousRastroCodeKey = process.env.RASTROCODE_API_KEY;
  const previousFetch = global.fetch;
  let fetchCalled = false;
  process.env.PARADISE_API_KEY = "test-pix-secret";
  delete process.env.RASTROCODE_API_KEY;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("A Paradise não deve ser chamada.");
  };

  try {
    const response = createResponse();
    await createPix({ method: "POST", body: rentalBody() }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.PARADISE_API_KEY;
    else process.env.PARADISE_API_KEY = previousApiKey;
    if (previousRastroCodeKey === undefined) delete process.env.RASTROCODE_API_KEY;
    else process.env.RASTROCODE_API_KEY = previousRastroCodeKey;
  }
});
