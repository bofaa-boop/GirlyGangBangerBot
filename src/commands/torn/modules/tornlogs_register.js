// src/commands/torn/modules/tornlogs_register.js
import { MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildSettings, registerUser, verifyTornApiKey } from '../../../utils/tornLogTracker.js';

const CONFIRMATION_CHANNEL_NAME = 'log-bot';

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
        const providedUserId = interaction.options.getString('userid') || null;

        const verification = await verifyTornApiKey(apiKey);

        if (verification.apiError) {
            return await replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: `Der API Key konnte nicht verifiziert werden: ${verification.apiError.error || 'Ungültiger Key.'}`,
            });
        }

        if (!verification.playerId) {
            return await replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: 'Der API Key konnte nicht verifiziert werden. Bitte prüfe den Key und versuche es erneut.',
            });
        }

        if (providedUserId && String(providedUserId).trim() !== String(verification.playerId)) {
            return await replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: `Die angegebene User-ID (${providedUserId}) passt nicht zum API Key (gehört zu Torn-ID ${verification.playerId}). Bitte die korrekte ID angeben oder das Feld leer lassen.`,
            });
        }

        const verifiedUserId = String(verification.playerId);

        await registerUser(interaction.guildId, interaction.user.id, {
            apiKey,
            tornUserId: verifiedUserId,
        });

        await interaction.reply({
            embeds: [successEmbed(`Registriert als **${verification.name}** [${verifiedUserId}]. Sobald das Tracking läuft (\`/tornlogs start\`), werden deine neuen Log-Einträge im konfigurierten Channel gepostet.`)],
            flags: MessageFlags.Ephemeral,
        });

        const confirmationChannel = interaction.guild.channels.cache.find(
            (c) => c.name?.toLowerCase() === CONFIRMATION_CHANNEL_NAME && c.isTextBased()
        );

        if (confirmationChannel) {
            const confirmationEmbed = createEmbed({
                title: '✅ Torn-Registrierung verifiziert',
                description: [
                    `**Discord-Mitglied:** <@${interaction.user.id}>`,
                    `**Torn-Spieler:** ${verification.name} [${verifiedUserId}]`,
                ].join('\n'),
                color: 'success',
            });

            try {
                await confirmationChannel.send({ embeds: [confirmationEmbed] });
            } catch (err) {
                // Nicht kritisch — die ephemer Bestätigung an den Nutzer ist schon raus.
            }
        }
    }
};
