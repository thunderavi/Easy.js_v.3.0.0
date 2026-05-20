const stripeClient = {
  paymentIntents: {
    create: jest.fn(),
    confirm: jest.fn()
  },
  customers: {
    create: jest.fn()
  },
  subscriptions: {
    create: jest.fn(),
    update: jest.fn(),
    del: jest.fn(),
    retrieve: jest.fn()
  },
  invoices: {
    create: jest.fn(),
    sendInvoice: jest.fn(),
    finalizeInvoice: jest.fn()
  },
  invoiceItems: {
    create: jest.fn()
  },
  refunds: {
    create: jest.fn()
  },
  charges: {
    list: jest.fn()
  },
  prices: {
    create: jest.fn()
  },
  products: {
    create: jest.fn()
  },
  webhooks: {
    constructEvent: jest.fn()
  }
};

jest.mock('stripe', () => jest.fn(() => stripeClient));

const PaymentProcessor = require('../../payments/paymentProcessor');

describe('PaymentProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates and confirms payment intents', async () => {
    stripeClient.paymentIntents.create.mockResolvedValue({ id: 'pi_1' });
    stripeClient.paymentIntents.confirm.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
    const payments = new PaymentProcessor('sk_test');

    await expect(payments.createPaymentIntent(12.34, 'usd', { orderId: 'o1' })).resolves.toEqual({ id: 'pi_1' });
    expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith({
      amount: 1234,
      currency: 'usd',
      metadata: { orderId: 'o1' },
      automatic_payment_methods: { enabled: true }
    });

    await expect(payments.confirmPaymentIntent('pi_1', 'pm_card')).resolves.toEqual({
      id: 'pi_1',
      status: 'succeeded'
    });
  });

  it('manages customers, subscriptions, invoices, refunds, prices, products, and charges', async () => {
    const payments = new PaymentProcessor('sk_test');
    stripeClient.customers.create.mockResolvedValue({ id: 'cus_1' });
    stripeClient.subscriptions.create.mockResolvedValue({ id: 'sub_1' });
    stripeClient.subscriptions.update.mockResolvedValue({ id: 'sub_1', cancel_at_period_end: true });
    stripeClient.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1' });
    stripeClient.invoices.create.mockResolvedValue({ id: 'inv_1' });
    stripeClient.invoices.sendInvoice.mockResolvedValue({ id: 'inv_1', sent: true });
    stripeClient.invoices.finalizeInvoice.mockResolvedValue({ id: 'inv_1', finalized: true });
    stripeClient.refunds.create.mockResolvedValue({ id: 're_1' });
    stripeClient.charges.list.mockResolvedValue({ data: [{ id: 'ch_1' }] });
    stripeClient.prices.create.mockResolvedValue({ id: 'price_1' });
    stripeClient.products.create.mockResolvedValue({ id: 'prod_1' });

    await payments.createCustomer('a@example.com', 'Alice');
    await payments.createSubscription('cus_1', 'price_1');
    await payments.cancelSubscription('sub_1', true);
    await payments.getSubscription('sub_1');
    await payments.createInvoice('cus_1', [{ amount: 5, description: 'Seat' }]);
    await payments.sendInvoice('inv_1');
    await payments.finalizeInvoice('inv_1');
    await payments.createRefund('ch_1', 2.5);
    await expect(payments.listCharges('cus_1')).resolves.toEqual([{ id: 'ch_1' }]);
    await payments.createPrice('prod_1', 9.99);
    await payments.createProduct('Plan', 'Monthly plan');

    expect(stripeClient.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 500,
      description: 'Seat'
    }));
    expect(stripeClient.subscriptions.del).toHaveBeenCalledWith('sub_1');
    expect(stripeClient.refunds.create).toHaveBeenCalledWith({ charge: 'ch_1', amount: 250 });
  });

  it('verifies and dispatches webhook events', () => {
    const payments = new PaymentProcessor('sk_test', 'whsec');
    stripeClient.webhooks.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded' });

    expect(payments.verifyWebhookSignature('payload', 'sig')).toEqual({ type: 'payment_intent.succeeded' });
    expect(stripeClient.webhooks.constructEvent).toHaveBeenCalledWith('payload', 'sig', 'whsec');

    const handlers = {
      onPaymentSucceeded: jest.fn(),
      onPaymentFailed: jest.fn(),
      onSubscriptionUpdated: jest.fn(),
      onSubscriptionCancelled: jest.fn(),
      onInvoicePaid: jest.fn(),
      onRefunded: jest.fn()
    };

    for (const type of [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'charge.refunded'
    ]) {
      payments.handleWebhookEvent({ type, data: { object: { id: type } } }, handlers);
    }

    expect(handlers.onPaymentSucceeded).toHaveBeenCalled();
    expect(handlers.onRefunded).toHaveBeenCalled();
  });
});
