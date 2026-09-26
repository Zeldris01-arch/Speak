const { PermissionFlagsBits } = require('discord.js');

const { canManageRole, canManageTarget, sendAdminLog } = require('./adminService');

let sweepRunning = false;

async function sweepExpirations(client, store, now = new Date()) {
  if (sweepRunning) return 0;
  sweepRunning = true;
  let expiredCount = 0;
  try {
    for (const guildId of await store.listGuildIds()) {
      const config = await store.getGuild(guildId);
      const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
      for (const [profileId, profile] of Object.entries(config.profiles)) {
        const dueAccesses = profile.accesses.filter((access) => access.status === 'active'
          && Number.isFinite(Date.parse(access.expiresAt))
          && Date.parse(access.expiresAt) <= now.getTime());
        for (const access of dueAccesses) {
          let roleRemoved = false;
          const hasAnotherActiveGrant = Object.values(config.profiles).some((otherProfile) =>
            otherProfile.accesses.some((otherAccess) => otherAccess.id !== access.id
              && otherAccess.userId === access.userId
              && otherAccess.roleId === access.roleId
              && otherAccess.status === 'active'
              && Date.parse(otherAccess.expiresAt) > now.getTime()));
          if (!hasAnotherActiveGrant && guild?.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const [member, role] = await Promise.all([
              guild.members.fetch(access.userId).catch(() => null),
              guild.roles.fetch(access.roleId).catch(() => null),
            ]);
            if (canManageTarget(guild, member) && canManageRole(guild, role) && member.roles.cache.has(role.id)) {
              await member.roles.remove(role, 'SPEAK access expired').then(() => { roleRemoved = true; }).catch(() => {});
            }
          }

          const expiredAt = now.toISOString();
          await store.updateGuild(guildId, (current) => {
            const currentProfile = current.profiles[profileId];
            const currentAccess = currentProfile?.accesses.find((entry) => entry.id === access.id);
            if (currentAccess?.status === 'active' && Date.parse(currentAccess.expiresAt) <= now.getTime()) {
              currentAccess.status = 'expired';
              currentAccess.expiredAt = expiredAt;
              currentAccess.expirationRoleRemoved = roleRemoved;
            }
          });
          expiredCount += 1;

          if (guild) {
            try {
              await sendAdminLog(guild, profile, 'SPEAK · EXPIRAÇÃO', [
                ['Usuário', `<@${access.userId}> (${access.userId})`],
                ['Plano', access.planName],
                ['Cargo', `<@&${access.roleId}> (${access.roleId})`],
                ['Expirou em', access.expiresAt],
                ['Cargo removido', roleRemoved ? 'Sim' : hasAnotherActiveGrant ? 'Não; outro acesso ativo mantém o cargo' : 'Não; ausente ou sem hierarquia'],
                ['Horário', expiredAt],
              ], now);
            } catch {
              // Expiration state is authoritative even if the log channel is unavailable.
            }
          }
        }
      }
    }
    return expiredCount;
  } finally {
    sweepRunning = false;
  }
}

function startExpirationWorker(client, store, intervalMs = 60_000) {
  const run = () => sweepExpirations(client, store).catch(() => {
    console.error('Falha ao verificar expirações SPEAK.');
  });
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { startExpirationWorker, sweepExpirations };