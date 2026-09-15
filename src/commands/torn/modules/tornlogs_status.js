// src/commands/torn/modules/tornlogs_stop.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { setGuildEnabled, stopTracking } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const stopped = stopTracking(interaction.guildId);
        await setGuildEnabled(interaction.guildId, false);

        return await interaction.reply({
            embeds: [successEmbed(stopped ? 'Torn-Log-Tracking gestoppt.' : 'Lief nicht.')],
            flags: MessageFlags.Ephemeral,
        });
    }
};
