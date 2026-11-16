window.rentalPlans = [
  { label: "7 dias", prices: { ps5: 6790, xbox: 5790 }, checkoutPath: "7dias" },
  { label: "15 dias", prices: { ps5: 11922, xbox: 9931 }, checkoutPath: "15dias" },
  { label: "1 mês", prices: { ps5: 21184, xbox: 17684 }, checkoutPath: "1mes" },
  { label: "2 meses", prices: { ps5: 27539, xbox: 22539 }, checkoutPath: "2meses" }
];

window.rentalRegularPrice = (promotionalPrice) => Math.round(promotionalPrice * 135 / 100);
window.rentalGamePrice = 1790;
