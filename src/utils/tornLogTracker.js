// src/utils/tornLogTracker.js
import { EmbedBuilder } from 'discord.js';
import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';

const SETTINGS_TABLE = 'torn_guild_settings';
const USERS_TABLE = 'torn_user_configs';
const TORN_API_BASE = 'https://api.torn.com/user/';
const DEFAULT_INTERVAL_MS = 60000;
const DELAY_BETWEEN_USERS_MS = 1500; // schont sowohl Torn- als auch Discord-Rate-Limits
const DELAY_BETWEEN_MESSAGES_MS = 500;
const ACTION_KEYWORDS = ['buy', 'bought', 'purchase', 'purchased', 'receive', 'received', 'send', 'sent'];
const ITEM_KEYWORDS = ['xanax'];

let tablesEnsured = false;
const activeIntervals = new Map(); // guildId -> interval handle

function textIncludesAny(text, keywords) {
    const lower = text.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
}

function isTrackedEntry(entry) {
    const title = entry.title || '';
    const dataText = entry.data && typeof entry.data === 'object' ? JSON.stringify(entry.data) : '';
    const combined = `${title} ${dataText}`;

    return textIncludesAny(combined, ACTION_KEYWORDS) && textIncludesAny(combined, ITEM_KEYWORDS);
}

async function ensureTables() {
    if (tablesEnsured || !pgDb.isAvailable()) return;
    await pgDb.pool.query(`
        CREATE TABLE IF NOT EXISTS ${SETTINGS_TABLE} (
            guild_id VARCHAR(20) PRIMARY KEY,
            channel_id VARCHAR(20) NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await pgDb.pool.query(`
        CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
            id SERIAL PRIMARY KEY,
            guild_id VARCHAR(20) NOT NULL,
            discord_user_id VARCHAR(20) NOT NULL,
            api_key VARCHAR(64) NOT NULL,
            torn_user_id VARCHAR(32),
            categories VARCHAR(255),
            last_timestamp BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(guild_id, discord_user_id)
        )
    `);
    tablesEnsured = true;
}

function assertDbAvailable() {
    if (!pgDb.isAvailable()) {
        throw new Error('Database is currently unavailable. Please try again in a moment.');
    }
}

// ---------------------------------------------------------------------------
// Guild-Einstellungen (Channel, an/aus)
// ---------------------------------------------------------------------------
export async function getGuildSettings(guildId) {
    await ensureTables();
    if (!pgDb.isAvailable()) return null;
    const result = await pgDb.pool.query(`SELECT * FROM ${SETTINGS_TABLE} WHERE guild_id = $1`, [guildId]);
    return result.rows[0] || null;
}

export async function setGuildChannel(guildId, channelId) {
    await ensureTables();
    assertDbAvailable();
    await pgDb.pool.query(
        `INSERT INTO ${SETTINGS_TABLE} (guild_id, channel_id, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (guild_id) DO UPDATE SET channel_id = $2, updated_at = CURRENT_TIMESTAMP`,
        [guildId, channelId]
    );
}

export async function setGuildEnabled(guildId, enabled) {
    await ensureTables();
    assertDbAvailable();
    await pgDb.pool.query(
        `UPDATE ${SETTINGS_TABLE} SET enabled = $2, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1`,
        [guildId, enabled]
    );
}

// ---------------------------------------------------------------------------
// Pro-Mitglied-Registrierung
// ---------------------------------------------------------------------------
export async function registerUser(guildId, discordUserId, { apiKey, tornUserId = null, categories = null }) {
    await ensureTables();
    assertDbAvailable();
    await pgDb.pool.query(
        `INSERT INTO ${USERS_TABLE} (guild_id, discord_user_id, api_key, torn_user_id, categories, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
           api_key = $3, torn_user_id = $4, categories = $5, updated_at = CURRENT_TIMESTAMP`,
        [guildId, discordUserId, apiKey, tornUserId, categories]
    );
}

export async function unregisterUser(guildId, discordUserId) {
    await ensureTables();
    assertDbAvailable();
    const result = await pgDb.pool.query(
        `DELETE FROM ${USERS_TABLE} WHERE guild_id = $1 AND discord_user_id = $2`,
        [guildId, discordUserId]
    );
    return result.rowCount > 0;
}

export async function getUserConfig(guildId, discordUserId) {
    await ensureTables();
    if (!pgDb.isAvailable()) return null;
    const result = await pgDb.pool.query(
        `SELECT * FROM ${USERS_TABLE} WHERE guild_id = $1 AND discord_user_id = $2`,
        [guildId, discordUserId]
    );
    return result.rows[0] || null;
}

export async function listRegisteredUsers(guildId) {
    await ensureTables();
    if (!pgDb.isAvailable()) return [];
    const result = await pgDb.pool.query(
        `SELECT discord_user_id, torn_user_id, last_timestamp FROM ${USERS_TABLE} WHERE guild_id = $1 ORDER BY created_at ASC`,
        [guildId]
    );
    return result.rows;
}

async function setUserLastTimestamp(guildId, discordUserId, ts) {
    if (!pgDb.isAvailable()) return;
    await pgDb.pool.query(
        `UPDATE ${USERS_TABLE} SET last_timestamp = $3, updated_at = CURRENT_TIMESTAMP
         WHERE guild_id = $1 AND discord_user_id = $2`,
        [guildId, discordUserId, ts]
    );
}

// ---------------------------------------------------------------------------
// Torn API
// ---------------------------------------------------------------------------
async function fetchLogs({ apiKey, tornUserId, fromTs, categories }) {
    const params = new URLSearchParams({ selections: 'log', key: apiKey, sort: 'ASC' });
    if (fromTs) params.set('from', String(fromTs + 1));
    if (categories) params.set('cat', categories);

    const url = `${TORN_API_BASE}${tornUserId || ''}?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();

    if (data.error) {
        logger.warn(`[TornLogTracker] API-Fehler ${data.error.code}: ${data.error.error}`);
        return { entries: [], apiError: data.error };
    }

    const entries = Object.entries(data.log || {})
        .map(([ts, entry]) => ({ ...entry, timestamp: Number(ts) }))
        .filter((entry) => Number.isFinite(entry.timestamp))
        .sort((a, b) => a.timestamp - b.timestamp);

    return { entries, apiError: null };
}

function buildEmbed(entry, discordUserId) {
    const embed = new EmbedBuilder()
        .setTitle(entry.title || 'Torn Log Eintrag')
        .setColor(0x5865f2)
        .setTimestamp(entry.timestamp * 1000)
        .setFooter({ text: `Mitglied: ${discordUserId}` });

    embed.setDescription(`<@${discordUserId}>`);

    if (entry.data && typeof entry.data === 'object') {
        const text = Object.entries(entry.data)
            .map(([k, v]) => `**${k}:** ${v}`)
            .join('\n')
            .slice(0, 1024);
        if (text) embed.addFields({ name: 'Details', value: text });
    }

    return embed;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
async function pollUser(channel, guildId, userConfig) {
    const { discord_user_id: discordUserId, api_key: apiKey, torn_user_id: tornUserId, categories } = userConfig;

    let result;
    try {
        result = await fetchLogs({
            apiKey,
            tornUserId,
            fromTs: Number(userConfig.last_timestamp),
            categories,
        });
    } catch (err) {
        logger.error(`[TornLogTracker] Fehler beim Abrufen der Logs für Discord-User ${discordUserId} (Guild ${guildId}):`, err);
        return;
    }

    if (result.apiError) {
        // Ungültiger Key o.ä. -> nicht jeden Poll-Zyklus erneut versuchen und spammen,
        // aber auch nicht automatisch löschen; einfach überspringen.
        return;
    }

    if (result.entries.length === 0) return;

    // Wichtig: last_timestamp trotzdem auf ALLE abgerufenen Einträge setzen,
    // nicht nur die gefilterten — sonst würden beim nächsten Poll die
    // herausgefilterten Einträge erneut abgerufen (unnötige API-Last).
    const relevantEntries = result.entries.filter(isTrackedEntry);

    for (const entry of relevantEntries) {
        try {
            await channel.send({ embeds: [buildEmbed(entry, discordUserId)] });
        } catch (err) {
            logger.error('[TornLogTracker] Konnte Nachricht nicht senden:', err);
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MESSAGES_MS));
    }

    const newLastTimestamp = result.entries[result.entries.length - 1].timestamp;
    if (Number.isFinite(newLastTimestamp)) {
        await setUserLastTimestamp(guildId, discordUserId, newLastTimestamp);
    } else {
        logger.warn(`[TornLogTracker] Ungültiger Zeitstempel bei Discord-User ${discordUserId} (Guild ${guildId}), überspringe Update.`);
    }

    if (relevantEntries.length > 0) {
        logger.info(`[TornLogTracker] ${relevantEntries.length} neue Xanax-Log-Einträge für Discord-User ${discordUserId} (Guild ${guildId}) gepostet.`);
    }
}

async function poll(client, guildId) {
    const settings = await getGuildSettings(guildId);
    if (!settings || !settings.enabled) return;

    const channel = client.channels.cache.get(settings.channel_id);
    if (!channel || !channel.isTextBased()) {
        logger.warn(`[TornLogTracker] Channel ${settings.channel_id} für Guild ${guildId} nicht gefunden.`);
        return;
    }

    const users = await listRegisteredUsers(guildId);
    if (users.length === 0) return;

    for (const user of users) {
        const fullConfig = await getUserConfig(guildId, user.discord_user_id);
        if (!fullConfig) continue;
        await pollUser(channel, guildId, fullConfig);
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_USERS_MS));
    }
}

export function isTracking(guildId) {
    return activeIntervals.has(guildId);
}

export function startTracking(client, guildId, intervalMs = DEFAULT_INTERVAL_MS) {
    if (activeIntervals.has(guildId)) return false;
    poll(client, guildId);
    const handle = setInterval(() => poll(client, guildId), intervalMs);
    activeIntervals.set(guildId, handle);
    return true;
}

export function stopTracking(guildId) {
    const handle = activeIntervals.get(guildId);
    if (!handle) return false;
    clearInterval(handle);
    activeIntervals.delete(guildId);
    return true;
}

// Beim Bot-Start aufrufen, um zuvor aktivierte Guilds wieder zu tracken.
export async function initTornLogTracker(client) {
    await ensureTables();
    if (!pgDb.isAvailable()) return;
    const result = await pgDb.pool.query(`SELECT guild_id FROM ${SETTINGS_TABLE} WHERE enabled = TRUE`);
    for (const row of result.rows) {
        startTracking(client, row.guild_id);
    }
    if (result.rows.length > 0) {
        logger.info(`[TornLogTracker] ${result.rows.length} Guild(s) beim Start wieder aktiviert.`);
    }
}
