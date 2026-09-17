// src/commands/torn/modules/tornlogs_status.js
import { MessageFlags } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildSettings, listRegisteredUsers, isTracking } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        const settings = await getGuildSettings(interaction.guildId);
        if (!settings) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Noch nicht konfiguriert. Nutze `/tornlogs setchannel`.',
            });
        }

        const users = await listRegisteredUsers(interaction.guildId);
        const memberList = users.length > 0
            ? users.map(u => `<@${u.discord_user_id}>`).join(', ')
            : 'Niemand registriert';

        const embed = createEmbed({
            title: 'Torn Log Tracker Status',
            description: [
                `**Status:** ${isTracking(interaction.guildId) ? '🟢 Läuft' : '🔴 Gestoppt'}`,
                `**Log-Channel:** ${settings.channel_id ? `<#${settings.channel_id}>` : 'Nicht gesetzt'}`,
                `**Online-Status-Channel:** ${settings.online_channel_id ? `<#${settings.online_channel_id}>` : 'Nicht gesetzt'}`,
                `**Registrierte Mitglieder (${users.length}):** ${memberList}`,
            ].join('\n'),
        });

        return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
