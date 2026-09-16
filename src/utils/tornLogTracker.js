// src/utils/tornLogTracker.js
import { EmbedBuilder } from 'discord.js';
import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';
import { formatDuration } from './embeds.js';

const SETTINGS_TABLE = 'torn_guild_settings';
const USERS_TABLE = 'torn_user_configs';
const ONLINE_TABLE = 'torn_online_status';
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
            channel_id VARCHAR(20),
            online_channel_id VARCHAR(20),
            enabled BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Migration für ältere Installationen: channel_id war ursprünglich NOT NULL
    // und online_channel_id gab es noch nicht.
    await pgDb.pool.query(`ALTER TABLE ${SETTINGS_TABLE} ALTER COLUMN channel_id DROP NOT NULL`).catch(() => {});
    await pgDb.pool.query(`ALTER TABLE ${SETTINGS_TABLE} ADD COLUMN IF NOT EXISTS online_channel_id VARCHAR(20)`).catch(() => {});

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

    await pgDb.pool.query(`
        CREATE TABLE IF NOT EXISTS ${ONLINE_TABLE} (
            guild_id VARCHAR(20) NOT NULL,
            discord_user_id VARCHAR(20) NOT NULL,
            is_online BOOLEAN NOT NULL DEFAULT FALSE,
            last_status_ts BIGINT NOT NULL DEFAULT 0,
            today_date VARCHAR(10) NOT NULL DEFAULT '',
            today_seconds BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (guild_id, discord_user_id)
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
// Guild-Einstellungen (Channels, an/aus)
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

export async function setOnlineChannel(guildId, channelId) {
    await ensureTables();
    assertDbAvailable();
    await pgDb.pool.query(
        `INSERT INTO ${SETTINGS_TABLE} (guild_id, online_channel_id, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (guild_id) DO UPDATE SET online_channel_id = $2, updated_at = CURRENT_TIMESTAMP`,
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
    await pgDb.pool.query(
        `DELETE FROM ${ONLINE_TABLE} WHERE guild_id = $1 AND discord_user_id = $2`,
        [guildId, discordUserId]
    ).catch(() => {});
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
// Online-Status (separat pro Guild+Mitglied)
// ---------------------------------------------------------------------------
async function getOnlineStatus(guildId, discordUserId) {
    if (!pgDb.isAvailable()) return null;
    const result = await pgDb.pool.query(
        `SELECT is_online, last_status_ts, today_date, today_seconds FROM ${ONLINE_TABLE} WHERE guild_id = $1 AND discord_user_id = $2`,
        [guildId, discordUserId]
    );
    return result.rows[0] || null;
}

async function upsertOnlineStatus(guildId, discordUserId, { isOnline, lastStatusTs, todayDate, todaySeconds }) {
    if (!pgDb.isAvailable()) return;
    await pgDb.pool.query(
        `INSERT INTO ${ONLINE_TABLE} (guild_id, discord_user_id, is_online, last_status_ts, today_date, today_seconds, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
           is_online = $3, last_status_ts = $4, today_date = $5, today_seconds = $6, updated_at = CURRENT_TIMESTAMP`,
        [guildId, discordUserId, isOnline, lastStatusTs, todayDate, todaySeconds]
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

async function fetchOnlineStatus({ apiKey, tornUserId }) {
    const params = new URLSearchParams({ selections: 'basic', key: apiKey });
    const url = `${TORN_API_BASE}${tornUserId || ''}?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();

    if (data.error) {
        logger.warn(`[TornLogTracker] API-Fehler (Online-Status) ${data.error.code}: ${data.error.error}`);
        return { status: null, apiError: data.error };
    }

    // Torn liefert last_action.status als "Online" / "Idle" / "Offline"
    const status = data.last_action?.status || 'Offline';
    return { status, apiError: null };
}

function buildEmbed(entry, discordUserId) {
    const embed = new EmbedBuilder()
        .setTitle(entry.title || 'Torn Log Eintrag')
        .setColor(0x5865f2)
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

function buildOnlineEventEmbed(discordUserId, type) {
    const isOnline = type === 'online';
    return new EmbedBuilder()
        .setTitle(isOnline ? '🟢 Online' : '⚪ Offline')
        .setDescription(`<@${discordUserId}> ist jetzt **${isOnline ? 'online' : 'offline'}**.`)
        .setColor(isOnline ? 0x43b581 : 0x747f8d);
}

function buildDailySummaryEmbed(discordUserId, dateStr, totalSeconds) {
    return new EmbedBuilder()
        .setTitle('📊 Tages-Zusammenfassung: Online-Zeit')
        .setDescription(`<@${discordUserId}> war am **${dateStr}** insgesamt **${formatDuration(totalSeconds * 1000)}** online.`)
        .setColor(0x5865f2);
}

// ---------------------------------------------------------------------------
// Polling: Xanax-Logs
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
        return;
    }

    if (result.entries.length === 0) return;

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

// ---------------------------------------------------------------------------
// Polling: Online-Status + Tagesgesamtzeit
// ---------------------------------------------------------------------------
async function pollUserOnlineStatus(channel, guildId, userConfig) {
    const { discord_user_id: discordUserId, api_key: apiKey, torn_user_id: tornUserId } = userConfig;

    let result;
    try {
        result = await fetchOnlineStatus({ apiKey, tornUserId });
    } catch (err) {
        logger.error(`[TornLogTracker] Fehler beim Abrufen des Online-Status für Discord-User ${discordUserId} (Guild ${guildId}):`, err);
        return;
    }

    if (result.apiError || !result.status) return;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const currentDate = new Date(nowSeconds * 1000).toISOString().slice(0, 10);

    const stored = await getOnlineStatus(guildId, discordUserId);
    let wasOnline = stored ? Boolean(stored.is_online) : false;
    let lastTs = stored && Number.isFinite(Number(stored.last_status_ts)) ? Number(stored.last_status_ts) : nowSeconds;
    let todayDate = stored && stored.today_date ? stored.today_date : currentDate;
    let todaySeconds = stored && Number.isFinite(Number(stored.today_seconds)) ? Number(stored.today_seconds) : 0;

    // Tageswechsel: alten Tag als Zusammenfassung posten, dann zurücksetzen
    if (todayDate !== currentDate) {
        if (todaySeconds > 0) {
            try {
                await channel.send({ embeds: [buildDailySummaryEmbed(discordUserId, todayDate, todaySeconds)] });
            } catch (err) {
                logger.error('[TornLogTracker] Konnte Tages-Zusammenfassung nicht senden:', err);
            }
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MESSAGES_MS));
        }
        todayDate = currentDate;
        todaySeconds = 0;
    }

    // Verstrichene Zeit seit letzter Prüfung gutschreiben, falls der Nutzer online war.
    // Gedeckelt auf das 3-fache des Poll-Intervalls, damit z.B. nach einem Bot-Neustart
    // keine riesige, künstliche Online-Zeit gutgeschrieben wird.
    if (wasOnline) {
        const cap = (DEFAULT_INTERVAL_MS / 1000) * 3;
        const elapsed = Math.max(0, Math.min(nowSeconds - lastTs, cap));
        todaySeconds += elapsed;
    }

    const isOnlineNow = result.status === 'Online';

    if (isOnlineNow !== wasOnline) {
        try {
            await channel.send({ embeds: [buildOnlineEventEmbed(discordUserId, isOnlineNow ? 'online' : 'offline')] });
        } catch (err) {
            logger.error('[TornLogTracker] Konnte Online-Status-Nachricht nicht senden:', err);
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MESSAGES_MS));
    }

    await upsertOnlineStatus(guildId, discordUserId, {
        isOnline: isOnlineNow,
        lastStatusTs: nowSeconds,
        todayDate,
        todaySeconds,
    });
}

// ---------------------------------------------------------------------------
// Haupt-Poll-Schleife
// ---------------------------------------------------------------------------
async function poll(client, guildId) {
    const settings = await getGuildSettings(guildId);
    if (!settings || !settings.enabled) return;

    const logChannel = settings.channel_id ? client.channels.cache.get(settings.channel_id) : null;
    if (settings.channel_id && (!logChannel || !logChannel.isTextBased())) {
        logger.warn(`[TornLogTracker] Log-Channel ${settings.channel_id} für Guild ${guildId} nicht gefunden.`);
    }

    const onlineChannel = settings.online_channel_id ? client.channels.cache.get(settings.online_channel_id) : null;
    if (settings.online_channel_id && (!onlineChannel || !onlineChannel.isTextBased())) {
        logger.warn(`[TornLogTracker] Online-Channel ${settings.online_channel_id} für Guild ${guildId} nicht gefunden.`);
    }

    const users = await listRegisteredUsers(guildId);
    if (users.length === 0) return;

    for (const user of users) {
        const fullConfig = await getUserConfig(guildId, user.discord_user_id);
        if (!fullConfig) continue;

        if (logChannel && logChannel.isTextBased()) {
            await pollUser(logChannel, guildId, fullConfig);
        }

        if (onlineChannel && onlineChannel.isTextBased()) {
            await pollUserOnlineStatus(onlineChannel, guildId, fullConfig);
        }

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
