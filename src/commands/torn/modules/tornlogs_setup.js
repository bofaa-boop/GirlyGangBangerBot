// src/commands/torn/modules/tornlogs_setup.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { upsertConfig } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const apiKey = interaction.options.getString('apikey', true);
        const channel = interaction.options.getChannel('channel', true);
        const tornUserId = interaction.options.getString('userid') || null;
        const categories = interaction.options.getString('categories') || null;

        await upsertConfig(interaction.guildId, {
            apiKey,
            tornUserId,
            channelId: channel.id,
            categories,
        });

        return await interaction.reply({
            embeds: [successEmbed(`Torn-Log-Tracking konfiguriert für ${channel}. Starte es mit \`/tornlogs start\`.`)],
            flags: MessageFlags.Ephemeral,
        });
    }
};
