// src/commands/torn/modules/tornlogs_start.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildSettings, setGuildEnabled, startTracking } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const settings = await getGuildSettings(interaction.guildId);
        if (!settings) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Bitte zuerst `/tornlogs setchannel` ausführen.',
            });
        }

        const started = startTracking(client, interaction.guildId);
        await setGuildEnabled(interaction.guildId, true);

        return await interaction.reply({
            embeds: [successEmbed(started ? 'Torn-Log-Tracking gestartet.' : 'Läuft bereits.')],
            flags: MessageFlags.Ephemeral,
        });
    }
};
