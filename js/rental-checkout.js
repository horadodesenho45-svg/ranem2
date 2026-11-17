(() => {
  const params = new URLSearchParams(window.location.search);
  const consoleName = params.get("console");
  const planId = params.get("plan");
  const consoles = {
    ps5: {
      name: "PlayStation 5 Slim",
      image: "images/playstation5egta.png"
    },
    xbox: {
      name: "Xbox Series X",
      image: "images/xboxseriesegta.png"
    }
  };
  const selectedConsole = Object.prototype.hasOwnProperty.call(consoles, consoleName)
    ? consoles[consoleName]
    : null;
  const plan = window.rentalPlans.find((item) => item.checkoutPath === planId);
  const error = document.getElementById("rental-selection-error");
  const content = document.getElementById("rental-checkout-content");

  try {
    if (selectedConsole && plan) {
      sessionStorage.setItem("rental-checkout-console", consoleName);
    } else {
      sessionStorage.removeItem("rental-checkout-console");
    }
  } catch (error) {
    console.error("Não foi possível guardar o console selecionado.", error);
  }

  if (!selectedConsole || !plan) {
    error.hidden = false;
    return;
  }

  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
  const formatPrice = (cents) => currencyFormatter.format(cents / 100);
  let rentalPrice = plan.prices[consoleName];
  const price = formatPrice(rentalPrice);
  const image = document.getElementById("rental-product-image");
  image.src = selectedConsole.image;
  image.alt = `${selectedConsole.name} e GTA VI`;
  document.getElementById("rental-product-name").textContent = selectedConsole.name;
  document.getElementById("rental-product-period").textContent = `Prazo: ${plan.label}`;
  document.getElementById("rental-product-original-price").textContent =
    formatPrice(window.rentalRegularPrice(rentalPrice));
  document.getElementById("rental-product-price").textContent = price;
  document.getElementById("rental-summary-period").textContent = plan.label;
  document.getElementById("rental-summary-price").textContent = price;
  document.getElementById("rental-summary-total").textContent = price;
  const postalCode = document.getElementById("rental-postal-code");
  const delivery = document.getElementById("rental-delivery");
  const freeDelivery = delivery.querySelector('input[value="free"]');
  const deliveryOptions = delivery.querySelectorAll('input[name="rental-delivery"]');
  const summaryDelivery = document.getElementById("rental-summary-delivery");
  const summaryTotal = document.getElementById("rental-summary-total");
  const totalLabel = document.getElementById("rental-total-label");
  const deliveryNote = document.getElementById("rental-summary-delivery-note");
  const extraController = document.getElementById("rental-extra-controller");
  const gamesContainer = document.getElementById("rental-games");
  const controllerRow = document.getElementById("rental-summary-controller-row");
  const gamesRow = document.getElementById("rental-summary-games-row");
  const gamesList = document.getElementById("rental-summary-games-list");
  const planSelect = document.getElementById("rental-plan");
  const checkoutButton = document.getElementById("checkout");
  const paymentNote = document.getElementById("rental-payment-note");
  const customerName = document.getElementById("rental-name");
  const customerEmail = document.getElementById("rental-email");
  const customerPhone = document.getElementById("rental-phone");
  const gamePrice = window.rentalGamePrice;
  const discountFormatter = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1
  });
  window.rentalPlans.forEach((item) => {
    const option = document.createElement("option");
    const promotionalPrice = item.prices[consoleName];
    const originalPrice = window.rentalRegularPrice(promotionalPrice);
    const discount = discountFormatter.format((originalPrice - promotionalPrice) / originalPrice);
    option.value = item.checkoutPath;
    option.textContent = `${item.label} — ${formatPrice(promotionalPrice)} (${discount} OFF)`;
    planSelect.append(option);
  });
  planSelect.value = plan.checkoutPath;
  const games = [
    { image: 1, name: "Call of Duty: Modern Warfare 4" },
    { image: 2, name: "The Last of Us Part II", ps5Only: true },
    { image: 3, name: "EA Sports FC 26" },
    { image: 4, name: "EA Sports FC 27" },
    { image: 5, name: "Call of Duty: Modern Warfare III" },
    { image: 6, name: "Call of Duty: Modern Warfare II" },
    { image: 7, name: "God of War Ragnarök", ps5Only: true },
    { image: 8, name: "Call of Duty: Vanguard" },
    { image: 9, name: "The Last of Us", ps5Only: true },
    { image: 10, name: "Grand Theft Auto V" }
  ];

  games.filter((game) => consoleName === "ps5" || !game.ps5Only).forEach((game) => {
    const label = document.createElement("label");
    label.className = "rental-game";
    const cover = document.createElement("img");
    cover.src = `images/order${game.image}.png`;
    cover.alt = "";
    cover.loading = "lazy";
    const name = document.createElement("strong");
    name.textContent = game.name;
    const priceLabel = document.createElement("span");
    priceLabel.className = "rental-game__price";
    const originalPrice = document.createElement("del");
    originalPrice.textContent = formatPrice(2490);
    const salePrice = document.createElement("strong");
    salePrice.textContent = formatPrice(gamePrice);
    priceLabel.append("De ", originalPrice, " por ", salePrice);
    const select = document.createElement("span");
    select.className = "rental-game__select";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "rental-game";
    input.value = game.name;
    select.append(input, document.createTextNode("Adicionar"));
    label.append(cover, name, priceLabel, select);
    gamesContainer.append(label);
  });
  const gameOptions = gamesContainer.querySelectorAll('input[name="rental-game"]');
  document.getElementById("rental-games-prev").addEventListener("click", () => {
    gamesContainer.scrollBy({ left: -gamesContainer.clientWidth, behavior: "auto" });
  });
  document.getElementById("rental-games-next").addEventListener("click", () => {
    gamesContainer.scrollBy({ left: gamesContainer.clientWidth, behavior: "auto" });
  });

  function setupNumberMask(input, format) {
    input.addEventListener("input", () => {
      const position = input.selectionStart;
      const atEnd = position === input.value.length;
      const digitsBeforeCursor = input.value.slice(0, position).replace(/\D/g, "").length;
      input.value = format(input.value.replace(/\D/g, "").slice(0, 11));

      if (atEnd) {
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }

      let cursor = 0;
      let digitsSeen = 0;
      while (cursor < input.value.length && digitsSeen < digitsBeforeCursor) {
        if (/\d/.test(input.value[cursor])) digitsSeen++;
        cursor++;
      }
      input.setSelectionRange(cursor, cursor);
    });

    input.addEventListener("keydown", (event) => {
      if (input.selectionStart !== input.selectionEnd) return;
      const cursor = input.selectionStart;
      const backward = event.key === "Backspace";
      if (!backward && event.key !== "Delete") return;
      const adjacent = backward ? cursor - 1 : cursor;
      if (adjacent < 0 || adjacent >= input.value.length || /\d/.test(input.value[adjacent])) return;

      let target = adjacent;
      while (target >= 0 && target < input.value.length && !/\d/.test(input.value[target])) {
        target += backward ? -1 : 1;
      }
      if (target < 0 || target >= input.value.length) return;
      event.preventDefault();
      const start = backward ? target : cursor;
      const end = backward ? cursor : target + 1;
      input.value = input.value.slice(0, start) + input.value.slice(end);
      input.setSelectionRange(start, start);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function formatCpf(digits) {
    let result = digits.slice(0, 3);
    if (digits.length > 3) result += `.${digits.slice(3, 6)}`;
    if (digits.length > 6) result += `.${digits.slice(6, 9)}`;
    if (digits.length > 9) result += `-${digits.slice(9, 11)}`;
    return result;
  }

  const cpf = document.getElementById("rental-cpf");
  const dialogCpf = document.getElementById("rental-dialog-cpf");
  setupNumberMask(cpf, formatCpf);
  setupNumberMask(dialogCpf, formatCpf);

  setupNumberMask(document.getElementById("rental-phone"), (digits) => {
    if (!digits) return "";
    let result = `(${digits.slice(0, 2)}`;
    if (digits.length <= 2) return result;
    result += `) ${digits.slice(2, digits.length > 10 ? 7 : 6)}`;
    const split = digits.length > 10 ? 7 : 6;
    if (digits.length > split) result += `-${digits.slice(split)}`;
    return result;
  });

  function updateDelivery() {
    const selectedGames = Array.from(gameOptions).filter((option) => option.checked);
    const controllerPrice = extraController.checked ? 1344 : 0;
    const gamesPrice = selectedGames.length * gamePrice;
    controllerRow.hidden = !extraController.checked;
    gamesRow.hidden = selectedGames.length === 0;
    gamesList.hidden = selectedGames.length === 0;
    document.getElementById("rental-summary-controller").textContent = formatPrice(controllerPrice);
    document.getElementById("rental-summary-games-label").textContent =
      `Jogos adicionais (${selectedGames.length})`;
    document.getElementById("rental-summary-games").textContent = formatPrice(gamesPrice);
    gamesList.replaceChildren(...selectedGames.map((option) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const price = document.createElement("span");
      name.textContent = option.value;
      price.textContent = formatPrice(gamePrice);
      item.append(name, price);
      return item;
    }));

    const completePostalCode = postalCode.value.replace(/\D/g, "").length === 8;
    delivery.hidden = !completePostalCode;
    if (!completePostalCode) {
      freeDelivery.checked = true;
      summaryDelivery.textContent = "Informe o CEP";
      summaryTotal.textContent = formatPrice(rentalPrice + controllerPrice + gamesPrice);
      totalLabel.textContent = "Total do aluguel";
      deliveryNote.textContent = "Informe o CEP para visualizar as opções de entrega.";
      return;
    }

    const express = delivery.querySelector('input[value="express"]').checked;
    const shippingPrice = express ? 1290 : 0;
    summaryDelivery.textContent = express ? formatPrice(shippingPrice) : "Grátis";
    summaryTotal.textContent = formatPrice(rentalPrice + controllerPrice + gamesPrice + shippingPrice);
    totalLabel.textContent = "Total estimado";
    deliveryNote.textContent = "Prazo e valor exibidos conforme a opção selecionada.";
  }

  postalCode.addEventListener("input", () => {
    const digits = postalCode.value.replace(/\D/g, "").slice(0, 8);
    postalCode.value = digits.length > 5
      ? `${digits.slice(0, 5)}-${digits.slice(5)}`
      : digits;
    updateDelivery();
  });
  deliveryOptions.forEach((option) => option.addEventListener("change", updateDelivery));
  extraController.addEventListener("change", updateDelivery);
  gameOptions.forEach((option) => option.addEventListener("change", updateDelivery));
  let creatingPix = false;
  let pixCreated = false;

  function updateCheckoutButton() {
    if (creatingPix || pixCreated) return;
    checkoutButton.disabled = !customerName.value.trim() ||
      !customerEmail.checkValidity() ||
      !cpf.checkValidity();
  }

  [customerName, customerEmail, cpf].forEach((input) => {
    input.addEventListener("input", updateCheckoutButton);
    input.addEventListener("blur", updateCheckoutButton);
  });

  checkoutButton.addEventListener("click", async () => {
    if (checkoutButton.disabled) return;
    creatingPix = true;
    checkoutButton.disabled = true;
    checkoutButton.textContent = "Gerando Pix...";
    paymentNote.textContent = "Aguarde enquanto geramos seu Pix.";

    try {
      await window.pixPayment.create({
        offerId: "rental",
        consoleName,
        onTerminal: (status) => {
          pixCreated = false;
          checkoutButton.disabled = false;
          checkoutButton.textContent = "Gerar novo Pix";
          paymentNote.textContent = status === "expired"
            ? "O Pix expirou. Gere um novo código para continuar."
            : status === "cancelled"
              ? "A cobrança Pix foi cancelada."
              : "Não foi possível localizar essa cobrança. Gere um novo Pix.";
        },
        details: {
          consoleName,
          planId: planSelect.value,
          extraController: extraController.checked,
          games: Array.from(gameOptions)
            .filter((option) => option.checked)
            .map((option) => option.value),
          delivery: delivery.hidden
            ? "free"
            : delivery.querySelector('input[name="rental-delivery"]:checked').value,
          buyer: {
            name: customerName.value.trim(),
            email: customerEmail.value.trim(),
            document: cpf.value.replace(/\D/g, ""),
            phone: customerPhone.value.replace(/\D/g, "")
          }
        }
      });
      pixCreated = true;
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Mostrar Pix gerado";
      paymentNote.textContent = "Pix gerado. Pague pelo QR Code ou copie e cole o código.";
    } catch (error) {
      checkoutButton.textContent = "Tentar novamente";
      paymentNote.textContent = `Não foi possível gerar o Pix: ${error.message}`;
    } finally {
      creatingPix = false;
      updateCheckoutButton();
      if (pixCreated) checkoutButton.disabled = false;
    }
  });

  planSelect.addEventListener("change", () => {
    const selectedPlan = window.rentalPlans.find((item) => item.checkoutPath === planSelect.value);
    if (!selectedPlan) {
      throw new Error("Prazo de aluguel inválido.");
    }
    rentalPrice = selectedPlan.prices[consoleName];
    document.getElementById("rental-product-period").textContent = `Prazo: ${selectedPlan.label}`;
    document.getElementById("rental-product-original-price").textContent =
      formatPrice(window.rentalRegularPrice(rentalPrice));
    document.getElementById("rental-product-price").textContent = formatPrice(rentalPrice);
    document.getElementById("rental-summary-period").textContent = selectedPlan.label;
    document.getElementById("rental-summary-price").textContent = formatPrice(rentalPrice);
    const url = new URL(window.location.href);
    url.searchParams.set("plan", selectedPlan.checkoutPath);
    window.history.replaceState(window.history.state, "", url);
    updateDelivery();
  });
  updateDelivery();
  updateCheckoutButton();
  content.hidden = false;

  const dialog = document.getElementById("rental-details-dialog");
  dialog.showModal();
})();
