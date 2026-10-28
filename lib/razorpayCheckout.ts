// lib/razorpayCheckout.ts - Load Razorpay Checkout and open it for an order.

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Razorpay'));
    document.body.appendChild(script);
  });
}

/** Opens Checkout for an order from /api/payments/order or /api/registrations/order. */
export async function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  prefill?: { contact?: string; name?: string };
  onPaid: () => void;
}): Promise<void> {
  await loadCheckout();
  new window.Razorpay!({
    key: options.keyId,
    order_id: options.orderId,
    amount: options.amount,
    currency: options.currency,
    name: 'Bid11Pro',
    description: options.description,
    prefill: options.prefill,
    theme: { color: '#2563eb' },
    handler: options.onPaid,
  }).open();
}
