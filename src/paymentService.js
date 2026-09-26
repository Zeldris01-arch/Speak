const PaymentStatus = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
});

class PaymentProvider {
  getStatus() {
    throw new Error('Implement getStatus() in a provider.');
  }

  async createCheckout() {
    throw new Error('Implement createCheckout() in a provider.');
  }

  async verifyConfirmation() {
    throw new Error('Implement verifyConfirmation() in a provider.');
  }
}

class PaymentService {
  constructor(provider, configStore) {
    this.provider = provider;
    this.configStore = configStore;
  }

  getStatus() {
    return this.provider.getStatus();
  }

  async createCheckout({ guildId, userId, plan, amount, couponId = null }) {
    const checkout = await this.provider.createCheckout({ guildId, userId, plan, amount, couponId });
    if (!checkout?.paymentId || !checkout?.url) throw new Error('PAYMENT_PROVIDER_INVALID_CHECKOUT');
    await this.configStore.updateActiveProfile(guildId, (profile) => {
      profile.paymentHistory.push({
        paymentId: checkout.paymentId,
        userId,
        planId: plan.id,
        amount,
        status: PaymentStatus.PENDING,
        createdAt: new Date().toISOString(),
        couponId,
      });
    });
    return checkout;
  }

  async confirm(guildId, confirmation) {
    const verified = await this.provider.verifyConfirmation(confirmation);
    if (!verified?.confirmed || !verified.paymentId || !Number.isFinite(Number(verified.amount))) return false;
    let matched = false;
    await this.configStore.updateActiveProfile(guildId, (profile) => {
      const payment = profile.paymentHistory.find((entry) => entry.paymentId === verified.paymentId);
      if (!payment || payment.status !== PaymentStatus.PENDING
        || payment.userId !== verified.userId || Number(payment.amount) !== Number(verified.amount)) return;
      if (payment.couponId) {
        const coupon = profile.coupons.find((entry) => entry.id === payment.couponId && entry.status === 'active');
        if (!coupon) return;
        coupon.usages ??= [];
        const userUses = coupon.usages.filter((usage) => usage.userId === payment.userId).length;
        if ((coupon.maxUses > 0 && coupon.usages.length >= coupon.maxUses)
          || (coupon.singleUse && userUses > 0)
          || (coupon.perUserLimit > 0 && userUses >= coupon.perUserLimit)) return;
        const usage = {
          userId: payment.userId,
          planId: payment.planId,
          amount: payment.amount,
          discount: payment.discount,
          paymentId: payment.paymentId,
          at: new Date().toISOString(),
        };
        coupon.usages.push(usage);
        profile.couponHistory.push({ code: coupon.code, ...usage });
      }
      payment.status = PaymentStatus.PAID;
      payment.confirmedAt = new Date().toISOString();
      matched = true;
    });
    return matched;
  }
}

module.exports = { PaymentProvider, PaymentService, PaymentStatus };