import { getUncachableStripeClient } from './stripeClient.js';

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log('Checking for existing Content Rocket subscription product...');

    const existing = await stripe.products.search({
      query: "name:'Content Rocket Pro' AND active:'true'",
    });

    if (existing.data.length > 0) {
      console.log('Content Rocket Pro already exists:', existing.data[0].id);
      const prices = await stripe.prices.list({ product: existing.data[0].id, active: true });
      prices.data.forEach(p => console.log(`  Price: ${p.id}  ${p.unit_amount! / 100} ${p.currency}/${(p.recurring?.interval ?? 'one-time')}`));
      return;
    }

    const product = await stripe.products.create({
      name: 'Content Rocket Pro',
      description: 'Full access to Content Rocket — AI-powered YouTube Shorts, blog posts, newsletters, carousels, podcast audio, and more.',
    });
    console.log('Created product:', product.id);

    const monthly = await stripe.prices.create({
      product: product.id,
      unit_amount: 4900,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    console.log('Monthly price:', monthly.id, '($49/month)');

    const yearly = await stripe.prices.create({
      product: product.id,
      unit_amount: 39900,
      currency: 'usd',
      recurring: { interval: 'year' },
    });
    console.log('Yearly price:', yearly.id, '($399/year)');

    console.log('\nDone! Webhooks will sync this to your database automatically.');
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createProducts();
