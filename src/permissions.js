const { PermissionFlagsBits } = require('discord.js');

const STAFF_DENIED_MESSAGE = 'Isso é para staff, sai daqui kkk';

function getSpeakStaffRoleId() {
  return process.env.SPEAK_STAFF_ROLE_ID || '';
}

function getIsekayUserIds() {
  return (process.env.ISEKAY_USER_ID || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^\d{17,20}$/.test(value));
}

function isIsekayUser(userId) {
  return getIsekayUserIds().includes(String(userId));
}

function isSpeakStaff(member, profile) {
  if (isIsekayUser(member?.id || member?.user?.id)) return true;
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)
    || member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoleIds = [
    getSpeakStaffRoleId(),
    ...(profile?.permissions?.roleIds || []),
    ...(profile?.permissions?.areas?.general?.roleIds || []),
  ].filter(Boolean);
  const roles = member?.roles?.cache;
  return Boolean(roles && staffRoleIds.some((roleId) => roles.has?.(roleId)
    || roles.some?.((role) => role.id === roleId)));
}

function isExplicitlyAuthorizedUser(member, userId, profile, area = 'general') {
  if (!member || !userId || !profile) return false;
  const path = profile?.permissions?.areas?.[area] || profile?.permissions;
  const userIds = new Set([
    ...(profile?.permissions?.userIds || []),
    ...(path?.userIds || []),
  ]);
  const roleIds = new Set([
    ...(profile?.permissions?.roleIds || []),
    ...(path?.roleIds || []),
  ]);
  const roles = member.roles?.cache;
  return userIds.has(String(userId)) || Boolean(roles && [...roleIds].some((roleId) => roles.has(roleId) || roles.some((role) => role.id === roleId)));
}

function hasSpeakAdminAccess(member, userId, profile, area = 'general') {
  if (!member || !userId) return false;
  const isOwner = isIsekayUser(userId);
  return isOwner || isSpeakStaff(member, profile) || isExplicitlyAuthorizedUser(member, userId, profile, area);
}

function canAccessAdminArea(member, userId, profile, area = 'general') {
  return hasSpeakAdminAccess(member, userId, profile, area);
}

function canAccessAnyAdminArea(member, userId, profile) {
  return hasSpeakAdminAccess(member, userId, profile, 'general');
}

function canManageSpeak(member, userId, profile) {
  return hasSpeakAdminAccess(member, userId, profile, 'general');
}

function canConfigure(interaction, profile, area = 'general') {
  return canAccessAdminArea(interaction.member, interaction.user.id, profile, area);
}

module.exports = {
  STAFF_DENIED_MESSAGE,
  canAccessAdminArea,
  canAccessAnyAdminArea,
  canConfigure,
  canManageSpeak,
  getIsekayUserIds,
  getSpeakStaffRoleId,
  hasSpeakAdminAccess,
  isExplicitlyAuthorizedUser,
  isIsekayUser,
  isSpeakStaff,
};