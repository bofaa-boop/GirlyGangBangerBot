// src/commands/torn/modules/tornlogs_status.js
import { MessageFlags } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getConfig, isTracking } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        const config = await getConfig(interaction.guildId);
        if (!config) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Noch nicht konfiguriert. Nutze `/tornlogs setup`.',
            });
        }

        const embed = createEmbed({
            title: 'Torn Log Tracker Status',
            description: [
                `**Status:** ${isTracking(interaction.guildId) ? '🟢 Läuft' : '🔴 Gestoppt'}`,
                `**Channel:** <#${config.channel_id}>`,
                `**Torn User-ID:** ${config.torn_user_id || 'Key-Owner'}`,
                `**Kategorien:** ${config.categories || 'Alle'}`,
                `**Letzter Zeitstempel:** ${config.last_timestamp > 0 ? new Date(Number(config.last_timestamp) * 1000).toLocaleString('de-DE') : 'Noch keiner'}`,
            ].join('\n'),
        });

        return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
