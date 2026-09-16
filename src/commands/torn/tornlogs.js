// src/commands/torn/tornlogs.js
import tornlogsOnlinechannel from './modules/tornlogs_onlinechannel.js';
import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import tornlogsSetchannel from './modules/tornlogs_setchannel.js';
import tornlogsRegister from './modules/tornlogs_register.js';
import tornlogsUnregister from './modules/tornlogs_unregister.js';
import tornlogsStart from './modules/tornlogs_start.js';
import tornlogsStop from './modules/tornlogs_stop.js';
import tornlogsStatus from './modules/tornlogs_status.js';

export default {
    data: new SlashCommandBuilder()
        .setName('tornlogs')
        .setDescription('Torn.com Log-Tracking verwalten')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Channel für Log-Einträge festlegen (Manage Server erforderlich)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Channel für Log-Einträge').addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('register')
                .setDescription('Deinen eigenen Torn API Key registrieren')
                .addStringOption(option =>
                    option.setName('apikey').setDescription('Dein Torn API Key (Full Access oder Custom mit log-Selection)').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('userid').setDescription('Deine Torn User-ID (leer = automatisch aus dem Key)').setRequired(false)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('unregister').setDescription('Deine Registrierung entfernen'))
        .addSubcommand(subcommand => subcommand.setName('start').setDescription('Log-Tracking für den Server starten (Manage Server erforderlich)'))
        .addSubcommand(subcommand => subcommand.setName('stop').setDescription('Log-Tracking für den Server stoppen (Manage Server erforderlich)'))
                .addSubcommand(subcommand =>
            subcommand
                .setName('onlinechannel')
                .setDescription('Channel für Online/Offline-Status & Tages-Zusammenfassung festlegen (Manage Server erforderlich)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Channel für Online-Status').addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('status').setDescription('Status anzeigen')),

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
                        case 'onlinechannel':
                return await tornlogsOnlinechannel.execute(interaction, config, client);
            case 'setchannel':
                return await tornlogsSetchannel.execute(interaction, config, client);
            case 'register':
                return await tornlogsRegister.execute(interaction, config, client);
            case 'unregister':
                return await tornlogsUnregister.execute(interaction, config, client);
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
