(() => {
  const storageKey = "pixou-tracking";
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
  const orderTokenKey = "rastrocode-order:";
  const customerReferenceKey = "rastrocode-customer-reference";
  const customerReferenceOffers = new Set(["downsell1", "downsell2", "upsell1", "thankyou"]);
  let dialog;
  let activePayment;

  function readStoredTracking() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch (error) {
      console.warn("Não foi possível recuperar os parâmetros de campanha.", error);
      return {};
    }
  }

  function saveTracking(tracking) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(tracking));
    } catch (error) {
      console.warn("Não foi possível guardar os parâmetros de campanha.", error);
    }
  }

  function getTracking() {
    let tracking = readStoredTracking();
    const query = new URLSearchParams(window.location.search);
    const hasCampaignParams = trackingFields.some((field) => query.has(field));
    if (hasCampaignParams) {
      tracking = Object.fromEntries(trackingFields.map((field) => [field, null]));
    }

    for (const field of trackingFields) {
      if (!query.has(field)) continue;
      const value = query.get(field);
      if (value && value.length <= 500) {
        tracking[field] = value;
      }
    }

    if (hasCampaignParams) saveTracking(tracking);
    return Object.fromEntries(trackingFields.map((field) => [field, tracking[field] || null]));
  }

  function createDialog() {
    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.className = "rental-pix-dialog";
    dialog.setAttribute("aria-labelledby", "rental-pix-title");

    const heading = document.createElement("h2");
    heading.id = "rental-pix-title";
    heading.textContent = "Pague com Pix";

    const description = document.createElement("p");
    description.className = "rental-pix-dialog__description";
    description.textContent = "Escaneie o QR Code ou copie e cole o código Pix.";

    const qrCode = document.createElement("img");
    qrCode.className = "rental-pix-dialog__qr";
    qrCode.alt = "QR Code Pix";
    qrCode.hidden = true;

    const pixCode = document.createElement("textarea");
    pixCode.className = "rental-pix-dialog__code";
    pixCode.readOnly = true;
    pixCode.setAttribute("aria-label", "Código Pix copia e cola");
    pixCode.rows = 4;

    const copyButton = document.createElement("button");
    copyButton.className = "rental-pix-dialog__button";
    copyButton.type = "button";
    copyButton.textContent = "Copiar código Pix";

    const status = document.createElement("p");
    status.className = "rental-pix-dialog__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const closeButton = document.createElement("button");
    closeButton.className = "rental-pix-dialog__button rental-pix-dialog__button--secondary";
    closeButton.type = "button";
    closeButton.textContent = "Fechar";
    closeButton.addEventListener("click", () => dialog.close());

    copyButton.addEventListener("click", async () => {
      if (!pixCode.value) return;
      try {
        await navigator.clipboard.writeText(pixCode.value);
        status.textContent = "Código Pix copiado.";
      } catch (error) {
        pixCode.focus();
        pixCode.select();
        status.textContent = "Selecione e copie o código Pix.";
      }
    });

    dialog.append(heading, description, qrCode, pixCode, copyButton, status, closeButton);
    document.body.append(dialog);
    return dialog;
  }

  async function readJson(response) {
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result && result.error ? result.error : "Não foi possível processar o Pix.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function redirectToThankyou(externalId, consoleName) {
    const destination = new URL("thankyou.html", window.location.href);
    destination.searchParams.set("external_id", externalId);
    if (consoleName) destination.searchParams.set("console", consoleName);
    window.location.assign(destination.href);
  }

  function storeOrderToken(externalId, token) {
    if (!token) return;
    try {
      sessionStorage.setItem(`${orderTokenKey}${externalId}`, token);
      if (externalId.startsWith("gta-rental-")) {
        sessionStorage.setItem(customerReferenceKey, JSON.stringify({
          externalId,
          token,
          savedAt: Date.now()
        }));
      }
    } catch (error) {
      console.warn("Não foi possível guardar a referência segura do pedido.", error);
    }
  }

  function getCustomerReference(offerId) {
    if (!customerReferenceOffers.has(offerId)) return null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(customerReferenceKey) || "null");
      if (!saved || typeof saved.externalId !== "string" ||
          typeof saved.token !== "string" || !Number.isFinite(saved.savedAt) ||
          Date.now() - saved.savedAt > 24 * 60 * 60 * 1000) {
        return null;
      }
      return { external_id: saved.externalId, order_token: saved.token };
    } catch (error) {
      console.warn("Não foi possível recuperar os dados seguros do comprador.", error);
      return null;
    }
  }

  function getOrderToken(externalId) {
    try {
      const token = sessionStorage.getItem(`${orderTokenKey}${externalId}`);
      if (token) return token;
    } catch (error) {
      console.warn("Não foi possível recuperar a referência segura do pedido.", error);
    }
    return activePayment && activePayment.externalId === externalId
      ? activePayment.orderToken
      : null;
  }

  async function getStatus(externalId) {
    const url = new URL("/api/pix/status", window.location.origin);
    url.searchParams.set("external_id", externalId);
    const orderToken = getOrderToken(externalId);
    if (orderToken) url.searchParams.set("order_token", orderToken);
    const response = await fetch(url, { cache: "no-store" });
    return readJson(response);
  }

  function pollUntilPaid(externalId, options, startedAt) {
    const statusElement = createDialog().querySelector(".rental-pix-dialog__status");
    const check = async () => {
      if (!activePayment || activePayment.externalId !== externalId) return;
      const payment = activePayment;

      try {
        const result = await getStatus(externalId);
        if (result.status === "paid") payment.paidAt = payment.paidAt || Date.now();
        if (result.status === "paid" && result.rastrocode_order_status === "pending") {
          statusElement.textContent = "Pagamento confirmado. Registrando o pedido...";
          activePayment = null;
          dialog.close();
          if (options.onPaid) {
            options.onPaid(result);
          } else {
            redirectToThankyou(externalId, options.consoleName);
          }
          return;
        } else if (result.status === "paid") {
          activePayment = null;
          statusElement.textContent = "Pagamento confirmado.";
          dialog.close();
          if (options.onPaid) {
            options.onPaid(result);
          } else {
            redirectToThankyou(externalId, options.consoleName);
          }
          return;
        }

        if (result.status === "expired" || result.status === "cancelled") {
          activePayment = null;
          statusElement.textContent = result.status === "expired"
            ? "Este Pix expirou. Gere um novo código para tentar novamente."
            : "Esta cobrança Pix foi cancelada.";
          if (options.onTerminal) options.onTerminal(result.status);
          return;
        }

        statusElement.textContent = "Aguardando a confirmação do pagamento...";
      } catch (error) {
        if (error.status === 404) {
          activePayment = null;
          statusElement.textContent = "Não encontramos essa cobrança Pix.";
          if (options.onTerminal) options.onTerminal("not_found");
          return;
        }
        statusElement.textContent = `${error.message} Tentando consultar novamente...`;
      }

      const timeoutStartedAt = payment.paidAt || startedAt;
      if (activePayment && Date.now() - timeoutStartedAt < 10 * 60 * 1000) {
        setTimeout(check, 5000);
      } else if (activePayment) {
        activePayment = null;
        const orderFailed = Boolean(payment.paidAt);
        statusElement.textContent = orderFailed
          ? "Pagamento confirmado, mas não conseguimos registrar seu pedido. Não faça outro Pix; entre em contato com o suporte."
          : "A consulta automática foi encerrada. Recarregue a página para verificar novamente.";
        if (options.onTerminal) options.onTerminal(orderFailed ? "order_pending" : "timeout");
      }
    };

    setTimeout(check, 3000);
  }

  async function create(options) {
    if (!options || typeof options.offerId !== "string") {
      throw new Error("Oferta Pix inválida.");
    }

    const currentDialog = createDialog();
    if (activePayment) {
      if (activePayment.offerId !== options.offerId) {
        throw new Error("Já existe outra cobrança Pix em andamento nesta página.");
      }
      if (!currentDialog.open) currentDialog.showModal();
      return activePayment.result;
    }

    const qrCode = currentDialog.querySelector(".rental-pix-dialog__qr");
    const pixCode = currentDialog.querySelector(".rental-pix-dialog__code");
    const statusElement = currentDialog.querySelector(".rental-pix-dialog__status");
    statusElement.textContent = "Gerando cobrança Pix...";
    pixCode.value = "";
    qrCode.removeAttribute("src");
    qrCode.hidden = true;
    currentDialog.showModal();

    try {
      const customerReference = getCustomerReference(options.offerId);
      const body = {
        ...options.details,
        offerId: options.offerId,
        tracking: getTracking()
      };
      if (customerReference) body.customer_reference = customerReference;

      const response = await fetch("/api/pix/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await readJson(response);

      if (!result.external_id || !result.pix_code) {
        throw new Error("A resposta da Paradise não contém o código Pix.");
      }

      storeOrderToken(result.external_id, result.order_token);
      pixCode.value = result.pix_code;
      if (result.qrcode_base64) {
        qrCode.src = `data:image/png;base64,${result.qrcode_base64}`;
        qrCode.hidden = false;
      }
      statusElement.textContent = "Aguardando a confirmação do pagamento...";
      activePayment = {
        externalId: result.external_id,
        offerId: options.offerId,
        orderToken: result.order_token,
        result
      };
      pollUntilPaid(result.external_id, options, Date.now());
      return result;
    } catch (error) {
      statusElement.textContent = error.message;
      if (dialog.open) dialog.close();
      throw error;
    }
  }

  function watchPayment(externalId, callbacks) {
    callbacks = callbacks || {};
    let stopped = false;
    const start = Date.now();
    const interval = callbacks.interval || 5000;
    let paymentConfirmedAt = null;

    const check = async () => {
      if (stopped) return;
      let orderPending = false;
      try {
        const result = await getStatus(externalId);
        if (callbacks.onStatus) callbacks.onStatus(result);
        if (result.status === "paid") paymentConfirmedAt = paymentConfirmedAt || Date.now();
        if (result.status === "paid" && result.rastrocode_order_status === "pending") {
          orderPending = true;
        } else if (result.status === "paid") {
          stopped = true;
          if (callbacks.onPaid) callbacks.onPaid(result);
          return;
        }
        if (result.status === "expired" || result.status === "cancelled") {
          stopped = true;
          if (callbacks.onTerminal) callbacks.onTerminal(result);
          return;
        }
      } catch (error) {
        if (error.status === 404) {
          stopped = true;
          if (callbacks.onTerminal) callbacks.onTerminal({ status: "not_found" });
          return;
        }
        if (callbacks.onError) callbacks.onError(error);
      }

      const timeoutStartedAt = paymentConfirmedAt || start;
      if (!stopped && Date.now() - timeoutStartedAt < 10 * 60 * 1000) {
        setTimeout(check, orderPending ? 15000 : interval);
      } else if (!stopped) {
        stopped = true;
        if (callbacks.onTerminal) {
          callbacks.onTerminal({ status: paymentConfirmedAt ? "order_pending" : "timeout" });
        }
      }
    };

    check();
    return () => { stopped = true; };
  }

  getTracking();
  window.pixPayment = { create, watchPayment };
})();
