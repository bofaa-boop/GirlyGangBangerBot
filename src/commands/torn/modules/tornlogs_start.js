// src/commands/torn/modules/tornlogs_start.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getConfig, setEnabled, startTracking } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const guildConfig = await getConfig(interaction.guildId);
        if (!guildConfig) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Bitte zuerst `/tornlogs setup` ausführen.',
            });
        }

        const started = startTracking(client, interaction.guildId);
        await setEnabled(interaction.guildId, true);

        return await interaction.reply({
            embeds: [successEmbed(started ? 'Torn-Log-Tracking gestartet.' : 'Läuft bereits.')],
            flags: MessageFlags.Ephemeral,
        });
    }
};
