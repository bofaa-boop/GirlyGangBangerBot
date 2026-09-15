// src/commands/torn/modules/tornlogs_unregister.js
import { MessageFlags } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { unregisterUser } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        const removed = await unregisterUser(interaction.guildId, interaction.user.id);

        if (!removed) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Du warst nicht registriert.',
            });
        }

        return await interaction.reply({
            embeds: [successEmbed('Deine Registrierung wurde entfernt.')],
            flags: MessageFlags.Ephemeral,
        });
    }
};
