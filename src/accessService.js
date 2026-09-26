const crypto = require('node:crypto');

const MAX_ACCOUNTS = 2;
const MONTHLY_RESETS = 2;

class AccessService {
  constructor(configStore, encryptionSecret = process.env.DATA_ENCRYPTION_KEY) {
    this.configStore = configStore;
    this.encryptionSecret = encryptionSecret;
  }

  getEncryptionKey() {
    if (!this.encryptionSecret) throw new Error('ACCESS_ENCRYPTION_NOT_CONFIGURED');
    return crypto.scryptSync(this.encryptionSecret, 'speak-access-v1', 32);
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  decrypt(value) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      Buffer.from(value.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  async list(guildId, userId) {
    const profile = await this.configStore.getActiveProfile(guildId);
    const userData = profile.accounts[userId] ?? { entries: [], reset: null };
    return userData.entries.map((entry) => {
      const credentials = JSON.parse(this.decrypt(entry.credentials));
      return { id: entry.id, ra: credentials.ra };
    });
  }

  async add(guildId, userId, ra, password) {
    const credentials = JSON.stringify({ ra, password });
    const encrypted = this.encrypt(credentials);
    let result;

    await this.configStore.updateActiveProfile(guildId, (profile) => {
      const userData = profile.accounts[userId] ?? { entries: [], reset: null };
      const existingAccounts = userData.entries.map((entry) =>
        JSON.parse(this.decrypt(entry.credentials)).ra.toLocaleLowerCase('pt-BR'),
      );

      if (existingAccounts.includes(ra.toLocaleLowerCase('pt-BR'))) {
        result = 'DUPLICATE';
        return;
      }
      if (userData.entries.length >= MAX_ACCOUNTS) {
        result = 'LIMIT';
        return;
      }

      userData.entries.push({ id: crypto.randomUUID(), credentials: encrypted });
      profile.accounts[userId] = userData;
      result = 'ADDED';
    });

    return result;
  }

  async reset(guildId, userId, accountId) {
    let result;
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    await this.configStore.updateActiveProfile(guildId, (profile) => {
      const userData = profile.accounts[userId] ?? { entries: [], reset: null };
      const currentReset = userData.reset;
      const used = currentReset?.month === month && currentReset?.year === year
        ? currentReset.count
        : 0;

      if (used >= MONTHLY_RESETS) {
        result = { status: 'LIMIT', remaining: 0 };
        return;
      }

      const accountIndex = userData.entries.findIndex((entry) => entry.id === accountId);
      if (accountIndex === -1) {
        result = { status: 'NOT_FOUND', remaining: MONTHLY_RESETS - used };
        return;
      }

      userData.entries.splice(accountIndex, 1);
      userData.reset = { month, year, count: used + 1 };
      profile.accounts[userId] = userData;
      profile.resetHistory.push({
        userId,
        at: now.toISOString(),
        month,
        year,
        usedInMonth: used + 1,
      });
      result = { status: 'RESET', remaining: MONTHLY_RESETS - used - 1 };
    });

    return result;
  }

  async getResetStatus(guildId, userId) {
    const profile = await this.configStore.getActiveProfile(guildId);
    const reset = profile.accounts[userId]?.reset;
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const used = reset?.month === month && reset?.year === year ? reset.count : 0;
    return { remaining: Math.max(0, MONTHLY_RESETS - used), month, year };
  }
}

module.exports = { AccessService };