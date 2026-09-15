// src/commands/torn/modules/tornlogs_register.js
import { MessageFlags } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildSettings, registerUser } from '../../../utils/tornLogTracker.js';

export default {
    async execute(interaction) {
        const settings = await getGuildSettings(interaction.guildId);
        if (!settings) {
            return await replyUserError(interaction, {
                type: ErrorTypes.CONFIGURATION,
                message: 'Für diesen Server wurde noch kein Log-Channel eingerichtet. Ein Admin muss zuerst `/tornlogs setchannel` ausführen.',
            });
        }

        const apiKey = interaction.options.getString('apikey', true);
        const tornUserId = interaction.options.getString('userid') || null;

        await registerUser(interaction.guildId, interaction.user.id, { apiKey, tornUserId });

        return await interaction.reply({
            embeds: [successEmbed('Registriert! Sobald das Tracking läuft (`/tornlogs start`), werden deine neuen Log-Einträge im konfigurierten Channel gepostet.')],
            flags: MessageFlags.Ephemeral,
        });
    }
};
