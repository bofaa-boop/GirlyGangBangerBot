// src/utils/tornLogTracker.js
import { EmbedBuilder } from 'discord.js';
import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';

const TABLE = 'torn_log_configs';
const TORN_API_BASE = 'https://api.torn.com/user/';
const DEFAULT_INTERVAL_MS = 60000;

let tableEnsured = false;
const activeIntervals = new Map(); // guildId -> interval handle

async function ensureTable() {
    if (tableEnsured || !pgDb.isAvailable()) return;
    await pgDb.pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            guild_id VARCHAR(20) PRIMARY KEY,
            api_key VARCHAR(64) NOT NULL,
            torn_user_id VARCHAR(32),
            channel_id VARCHAR(20) NOT NULL,
            categories VARCHAR(255),
            last_timestamp BIGINT NOT NULL DEFAULT 0,
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    tableEnsured = true;
}

export async function getConfig(guildId) {
    await ensureTable();
    if (!pgDb.isAvailable()) return null;
    const result = await pgDb.pool.query(`SELECT * FROM ${TABLE} WHERE guild_id = $1`, [guildId]);
    return result.rows[0] || null;
}

export async function upsertConfig(guildId, { apiKey, tornUserId = null, channelId, categories = null }) {
    await ensureTable();
    await pgDb.pool.query(
        `INSERT INTO ${TABLE} (guild_id, api_key, torn_user_id, channel_id, categories, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (guild_id) DO UPDATE SET
           api_key = $2, torn_user_id = $3, channel_id = $4, categories = $5, updated_at = CURRENT_TIMESTAMP`,
        [guildId, apiKey, tornUserId, channelId, categories]
    );
}

export async function setEnabled(guildId, enabled) {
    await ensureTable();
    await pgDb.pool.query(
        `UPDATE ${TABLE} SET enabled = $2, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1`,
        [guildId, enabled]
    );
}

async function setLastTimestamp(guildId, ts) {
    await pgDb.pool.query(
        `UPDATE ${TABLE} SET last_timestamp = $2, updated_at = CURRENT_TIMESTAMP WHERE guild_id = $1`,
        [guildId, ts]
    );
}

async function fetchLogs({ apiKey, tornUserId, fromTs, categories }) {
    const params = new URLSearchParams({ selections: 'log', key: apiKey, sort: 'ASC' });
    if (fromTs) params.set('from', String(fromTs + 1));
    if (categories) params.set('cat', categories);

    const url = `${TORN_API_BASE}${tornUserId || ''}?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();

    if (data.error) {
        logger.warn(`[TornLogTracker] API-Fehler ${data.error.code}: ${data.error.error}`);
        return [];
    }

    return Object.entries(data.log || {})
        .map(([ts, entry]) => ({ ...entry, timestamp: Number(ts) }))
        .sort((a, b) => a.timestamp - b.timestamp);
}

function buildEmbed(entry) {
    const embed = new EmbedBuilder()
        .setTitle(entry.title || 'Torn Log Eintrag')
        .setColor(0x5865f2)
        .setTimestamp(entry.timestamp * 1000);

    if (entry.data && typeof entry.data === 'object') {
        const text = Object.entries(entry.data)
            .map(([k, v]) => `**${k}:** ${v}`)
            .join('\n')
            .slice(0, 1024);
        if (text) embed.addFields({ name: 'Details', value: text });
    }
    if (entry.category) embed.setFooter({ text: `Kategorie: ${entry.category}` });

    return embed;
}

async function poll(client, guildId) {
    const config = await getConfig(guildId);
    if (!config || !config.enabled) return;

    const channel = client.channels.cache.get(config.channel_id);
    if (!channel || !channel.isTextBased()) {
        logger.warn(`[TornLogTracker] Channel ${config.channel_id} für Guild ${guildId} nicht gefunden.`);
        return;
    }

    let entries;
    try {
        entries = await fetchLogs({
            apiKey: config.api_key,
            tornUserId: config.torn_user_id,
            fromTs: Number(config.last_timestamp),
            categories: config.categories,
        });
    } catch (err) {
        logger.error(`[TornLogTracker] Fehler beim Abrufen der Logs für Guild ${guildId}:`, err);
        return;
    }

    if (entries.length === 0) return;

    for (const entry of entries) {
        try {
            await channel.send({ embeds: [buildEmbed(entry)] });
        } catch (err) {
            logger.error('[TornLogTracker] Konnte Nachricht nicht senden:', err);
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    await setLastTimestamp(guildId, entries[entries.length - 1].timestamp);
    logger.info(`[TornLogTracker] ${entries.length} neue Log-Einträge für Guild ${guildId} gepostet.`);
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
    await ensureTable();
    if (!pgDb.isAvailable()) return;
    const result = await pgDb.pool.query(`SELECT guild_id FROM ${TABLE} WHERE enabled = TRUE`);
    for (const row of result.rows) {
        startTracking(client, row.guild_id);
    }
    if (result.rows.length > 0) {
        logger.info(`[TornLogTracker] ${result.rows.length} Guild(s) beim Start wieder aktiviert.`);
    }
}
