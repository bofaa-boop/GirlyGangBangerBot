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
const TRACKED_KEYWORDS = ['use', 'used', 'buy', 'bought', 'purchase', 'purchased', 'send', 'sent'];

let tablesEnsured = false;
const activeIntervals = new Map(); // guildId -> interval handle

function isTrackedEntry(entry) {
    const title = (entry.title || '').toLowerCase();
    return TRACKED_KEYWORDS.some((keyword) => title.includes(keyword));
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
    const params = new URLSearchParams({ selections: 'log', key: apiKey, sort:
