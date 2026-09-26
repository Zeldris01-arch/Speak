const { PaymentProvider } = require('./paymentService');

const MISSING_DOCUMENTATION = [
  'base URL oficial atual',
  'endpoint e payload oficial de criação de cobrança',
  'formato de autenticação para ZPAY_CLIENT_ID/ZPAY_CLIENT_SECRET',
  'consulta oficial de status e identificação imutável da cobrança',
  'contrato de webhook/assinatura e validação de valor/usuário',
];

class ZPayProvider extends PaymentProvider {
  getStatus() {
    return {
      configured: Boolean(process.env.ZPAY_CLIENT_ID && process.env.ZPAY_CLIENT_SECRET),
      credentialsPresent: Boolean(process.env.ZPAY_CLIENT_ID && process.env.ZPAY_CLIENT_SECRET),
      missingDocumentation: MISSING_DOCUMENTATION,
      provider: 'Z.PAY',
      mode: 'official-contract-required',
    };
  }

  async createCheckout({ guildId, userId, plan, amount, couponId = null }) {
    const clientId = process.env.ZPAY_CLIENT_ID;
    const clientSecret = process.env.ZPAY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('ZPAY_NOT_CONFIGURED');
    }
    throw new Error('ZPAY_OFFICIAL_CONTRACT_UNVERIFIED');
  }

  async verifyConfirmation() {
    throw new Error('ZPAY_OFFICIAL_CONTRACT_UNVERIFIED');
  }
}

module.exports = { MISSING_DOCUMENTATION, ZPayProvider };