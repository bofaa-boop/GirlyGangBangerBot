// src/commands/torn/tornlogs.js
import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import tornlogsSetup from './modules/tornlogs_setup.js';
import tornlogsStart from './modules/tornlogs_start.js';
import tornlogsStop from './modules/tornlogs_stop.js';
import tornlogsStatus from './modules/tornlogs_status.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tornlogs')
        .setDescription('Torn.com Log-Tracking verwalten (Manage Server erforderlich)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Torn-Log-Tracking konfigurieren')
                .addStringOption(option =>
                    option.setName('apikey').setDescription('Torn API Key (Full Access oder Custom mit log-Selection)').setRequired(true)
                )
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Channel für Log-Einträge').addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('userid').setDescription('Torn User-ID (leer = Key-Owner)').setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('categories').setDescription('Komma-getrennte Log-Kategorien (leer = alle)').setRequired(false)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('start').setDescription('Log-Tracking starten'))
        .addSubcommand(subcommand => subcommand.setName('stop').setDescription('Log-Tracking stoppen'))
        .addSubcommand(subcommand => subcommand.setName('status').setDescription('Status anzeigen')),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'setup':
                return await tornlogsSetup.execute(interaction, config, client);
            case 'start':
                return await tornlogsStart.execute(interaction, config, client);
            case 'stop':
                return await tornlogsStop.execute(interaction, config, client);
            case 'status':
                return await tornlogsStatus.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Unknown subcommand' });
        }
    }
};
