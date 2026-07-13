import { getUncachableStripeClient } from "./stripeClient.js";

const COUPON_NAME = "Beta Tester — 100% Off";
const PROMO_CODE = "BETA100";

async function main() {
  const stripe = await getUncachableStripeClient();

  // Check if promo code already exists
  const existing = await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 1 });
  if (existing.data.length > 0) {
    const pc = existing.data[0];
    console.log(`Promotion code already exists: ${pc.code}`);
    console.log(`  Coupon: ${(pc.coupon as any).name ?? pc.coupon.id}`);
    console.log(`  Active: ${pc.active}`);
    console.log(`  Times redeemed: ${pc.times_redeemed}`);
    return;
  }

  // Create a 100%-off forever coupon
  const coupon = await stripe.coupons.create({
    name: COUPON_NAME,
    percent_off: 100,
    duration: "forever",
  });
  console.log(`Created coupon: ${coupon.id} — "${coupon.name}"`);

  // Create a human-readable promotion code for that coupon
  const promoCode = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: PROMO_CODE,
  });
  console.log(`Created promotion code: ${promoCode.code}`);
  console.log(`  Coupon: ${coupon.name}`);
  console.log(`  Discount: 100% off forever`);
  console.log(`  Active: ${promoCode.active}`);
  console.log("");
  console.log(`Share this code with beta testers: ${promoCode.code}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
