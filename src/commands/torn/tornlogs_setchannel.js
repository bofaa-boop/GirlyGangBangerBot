// src/commands/torn/modules/tornlogs_setchannel.js
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { setGuildChannel } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.PERMISSION,
                message: 'Du benötigst die Berechtigung "Server verwalten".',
            });
        }

        const channel = interaction.options.getChannel('channel', true);
        await setGuildChannel(interaction.guildId, channel.id);

        return await interaction.reply({
            embeds: [successEmbed(`Torn-Log-Channel gesetzt auf ${channel}. Mitglieder können sich jetzt mit \`/tornlogs register\` anmelden.`)],
            flags: MessageFlags.Ephemeral,
        });
    }
};
