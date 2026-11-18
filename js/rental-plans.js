const rentalPlans = [
  { label: "7 dias", prices: { ps5: 6790, xbox: 5790 }, checkoutPath: "7dias" },
  { label: "15 dias", prices: { ps5: 11922, xbox: 9931 }, checkoutPath: "15dias" },
  { label: "1 mês", prices: { ps5: 21184, xbox: 17684 }, checkoutPath: "1mes" },
  { label: "2 meses", prices: { ps5: 27539, xbox: 22539 }, checkoutPath: "2meses" }
];

const rentalRegularPrice = (promotionalPrice) => Math.round(promotionalPrice * 135 / 100);
const rentalGamePrice = 1790;
const rentalMaxOrderBumps = (planId, consoleName) => {
  if (planId !== "2meses") return Infinity;
  const plan = rentalPlans.find((item) => item.checkoutPath === planId);
  const basePrice = plan && plan.prices[consoleName];
  if (!Number.isInteger(basePrice)) return 0;
  return Math.max(0, Math.floor((35000 - basePrice - 1344 - 1290) / rentalGamePrice));
};

if (typeof window !== "undefined") {
  window.rentalPlans = rentalPlans;
  window.rentalRegularPrice = rentalRegularPrice;
  window.rentalGamePrice = rentalGamePrice;
  window.rentalMaxOrderBumps = rentalMaxOrderBumps;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { rentalPlans, rentalRegularPrice, rentalGamePrice, rentalMaxOrderBumps };
}
