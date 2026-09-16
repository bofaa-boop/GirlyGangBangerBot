// src/commands/torn/modules/tornlogs_onlinechannel.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { setOnlineChannel } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const channel = interaction.options.getChannel('channel', true);
        await setOnlineChannel(interaction.guildId, channel.id);

        return await interaction.reply({
            embeds: [successEmbed(`Online-Status-Channel gesetzt auf ${channel}. Statuswechsel und Tages-Zusammenfassungen erscheinen jetzt dort.`)],
            flags: MessageFlags.Ephemeral,
        });
    }
};
