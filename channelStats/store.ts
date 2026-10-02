/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore } from "@webpack/common";

import { Period } from "./utils";

const DS_KEY = "ChannelStats_v2";
const SAVE_DELAY = 5000;
const DAY_MS = 86_400_000;

export interface DayData {
    total: number;
    hourly: number[];
    users: Record<string, number>;
}

export interface ChannelData {
    /** guild ID, "dm" for DMs/group DMs. */
    guildId?: string;
    days: Record<string, DayData>;
}

export type StatsStore = Record<string, ChannelData>;

export interface SeriesPoint {
    key: string;
    count: number;
}

let cache: StatsStore = {};
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function scheduleSave() {
    dirty = true;
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void flushStats();
    }, SAVE_DELAY);
}

export async function flushStats() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if (!dirty) return;
    dirty = false;
    await DataStore.set(DS_KEY, cache);
}

export async function loadStats() {
    cache = (await DataStore.get<StatsStore>(DS_KEY)) ?? {};
    dirty = false;
}

export async function resetStats() {
    cache = {};
    dirty = true;
    await flushStats();
}

export async function exportStats(): Promise<string> {
    return JSON.stringify(cache, null, 2);
}

function isValidDay(d: any): d is DayData {
    return !!d
        && typeof d.total === "number"
        && Array.isArray(d.hourly)
        && d.hourly.length === 24
        && d.hourly.every((n: unknown) => typeof n === "number")
        && !!d.users
        && typeof d.users === "object";
}

export async function importStats(data: unknown): Promise<number> {
    if (!data || typeof data !== "object") throw new Error("Invalid stats file");

    let imported = 0;
    for (const [channelId, ch] of Object.entries(data as StatsStore)) {
        if (!ch || typeof ch !== "object" || !ch.days || typeof ch.days !== "object") continue;

        const target = (cache[channelId] ??= { guildId: ch.guildId, days: {} });
        if (!target.guildId && ch.guildId) target.guildId = ch.guildId;

        for (const [key, day] of Object.entries(ch.days)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isValidDay(day)) continue;
            if ((target.days[key]?.total ?? -1) >= day.total) continue;
            target.days[key] = day;
            imported++;
        }

        if (!Object.keys(target.days).length) delete cache[channelId];
    }

    if (!imported) throw new Error("Nothing to import");

    dirty = true;
    await flushStats();
    return imported;
}

// datehelper

const pad = (n: number) => String(n).padStart(2, "0");

export function getDateKey(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** parses a YYYY-MM-DD key as LOCAL midnight (new Date("YYYY-MM-DD") would be UTC) */
function parseDateKey(key: string): number {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
}

function startOfToday(): number {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

/** start (local midnight) of the given period */
export function getSinceTimestamp(period: Period | string): number {
    const back = (days: number) => {
        const d = new Date(startOfToday());
        d.setDate(d.getDate() - days);
        return d.getTime();
    };

    switch (period) {
        case "day": return startOfToday();
        case "week": return back(6);
        case "month": return back(29);
        case "year": return back(364);
        default: return 0;
    }
}

// recording

export function recordMessage(channelId: string, guildId: string, userId: string, timestamp: number) {
    const ch = (cache[channelId] ??= { guildId, days: {} });
    ch.guildId = guildId;

    const dateKey = getDateKey(timestamp);
    const day = (ch.days[dateKey] ??= { total: 0, hourly: Array(24).fill(0), users: {} });

    day.total++;
    day.hourly[new Date(timestamp).getHours()]++;
    day.users[userId] = (day.users[userId] ?? 0) + 1;

    scheduleSave();
}

// queries

function getDaysInRange(channelId: string, since: number): DayData[] {
    const ch = cache[channelId];
    if (!ch) return [];

    return Object.entries(ch.days)
        .filter(([key]) => since === 0 || parseDateKey(key) >= since)
        .map(([, data]) => data);
}

function aggregateUsers(channelId: string, since: number): [string, number][] {
    const counts: Record<string, number> = {};
    for (const day of getDaysInRange(channelId, since)) {
        for (const [userId, count] of Object.entries(day.users)) {
            counts[userId] = (counts[userId] ?? 0) + count;
        }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function getTotalMessages(channelId: string, since: number): number {
    return getDaysInRange(channelId, since).reduce((acc, d) => acc + d.total, 0);
}

export function getTodayMessages(channelId: string): number {
    return cache[channelId]?.days[getDateKey(Date.now())]?.total ?? 0;
}

export function getTopUsers(channelId: string, since: number, limit: number): { userId: string; count: number; }[] {
    return aggregateUsers(channelId, since)
        .slice(0, limit)
        .map(([userId, count]) => ({ userId, count }));
}

export function getYourRank(channelId: string, since: number, userId: string): number {
    const idx = aggregateUsers(channelId, since).findIndex(([uid]) => uid === userId);
    return idx === -1 ? -1 : idx + 1;
}

export function getHourlyActivity(channelId: string, since: number): number[] {
    const hours: number[] = Array(24).fill(0);
    for (const day of getDaysInRange(channelId, since)) {
        for (let i = 0; i < 24; i++) hours[i] += day.hourly[i] ?? 0;
    }
    return hours;
}

export function getPeakHour(channelId: string, since: number): number {
    const hourly = getHourlyActivity(channelId, since);
    return hourly.indexOf(Math.max(...hourly));
}

/** one point per calendar day, including days without messages. */
export function getDailySeries(channelId: string, since: number): SeriesPoint[] {
    const ch = cache[channelId];
    if (!ch) return [];

    const keys = Object.keys(ch.days);
    if (!keys.length) return [];

    const start = since === 0 ? Math.min(...keys.map(parseDateKey)) : since;
    const end = startOfToday();

    const out: SeriesPoint[] = [];
    const d = new Date(start);
    while (d.getTime() <= end) {
        const key = getDateKey(d.getTime());
        out.push({ key, count: ch.days[key]?.total ?? 0 });
        d.setDate(d.getDate() + 1);
    }
    return out;
}

/** one point per month (YYYY-MM) from the first month with data until now. */
export function getMonthlySeries(channelId: string, since: number): SeriesPoint[] {
    const ch = cache[channelId];
    if (!ch) return [];

    const totals: Record<string, number> = {};
    for (const [key, data] of Object.entries(ch.days)) {
        if (since !== 0 && parseDateKey(key) < since) continue;
        const month = key.slice(0, 7);
        totals[month] = (totals[month] ?? 0) + data.total;
    }

    const months = Object.keys(totals).sort();
    if (!months.length) return [];

    let [y, m] = months[0].split("-").map(Number);
    const now = new Date();
    const out: SeriesPoint[] = [];

    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const key = `${y}-${pad(m)}`;
        out.push({ key, count: totals[key] ?? 0 });
        if (++m > 12) {
            m = 1;
            y++;
        }
    }
    return out;
}

/** average per calendar day, counted from the first day with data (or period start, whichever is later) */
export function getAverageDailyMessages(channelId: string, since: number): number {
    const ch = cache[channelId];
    if (!ch) return 0;

    const keys = Object.keys(ch.days);
    if (!keys.length) return 0;

    const total = getTotalMessages(channelId, since);
    if (!total) return 0;

    const first = Math.min(...keys.map(parseDateKey));
    const from = Math.max(since, first);
    const days = Math.max(1, Math.round((startOfToday() - from) / DAY_MS) + 1);

    return Math.round(total / days);
}

export function getMostActiveDay(channelId: string, since: number): { date: string; count: number; } | null {
    const ch = cache[channelId];
    if (!ch) return null;

    let best: { date: string; count: number; } | null = null;
    for (const [date, data] of Object.entries(ch.days)) {
        if (since !== 0 && parseDateKey(date) < since) continue;
        if (!best || data.total > best.count) best = { date, count: data.total };
    }
    return best;
}

/** consecutive days with messages. Today doesnt break the streak if its still empty. */
export function getActivityStreak(channelId: string): number {
    const ch = cache[channelId];
    if (!ch) return 0;

    const d = new Date(startOfToday());
    if (!ch.days[getDateKey(d.getTime())]?.total) d.setDate(d.getDate() - 1);

    let streak = 0;
    while (ch.days[getDateKey(d.getTime())]?.total) {
        streak++;
        d.setDate(d.getDate() - 1);
    }
    return streak;
}

export function getTodayPercentage(channelId: string): number {
    const total = getTotalMessages(channelId, 0);
    if (!total) return 0;
    return Math.round((getTodayMessages(channelId) / total) * 100);
}

// mangaemnt

export function getAllTrackedChannels(): string[] {
    return Object.keys(cache);
}

export function getChannelMessageCount(channelId: string): number {
    return getTotalMessages(channelId, 0);
}

/** guild ID, "dm" or "unknown". Uses stored data first, ChannelStore as a fallback for old data. */
export function getChannelGuildId(channelId: string): string {
    const stored = cache[channelId]?.guildId;
    if (stored) return stored;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "unknown";
    if (channel.guild_id) return channel.guild_id;
    return channel.isDM?.() || channel.isGroupDM?.() ? "dm" : "unknown";
}

export async function deleteChannelStats(channelId: string) {
    delete cache[channelId];
    dirty = true;
    await flushStats();
}

export async function deleteGuildStats(guildId: string) {
    for (const channelId of Object.keys(cache)) {
        if (getChannelGuildId(channelId) === guildId) delete cache[channelId];
    }
    dirty = true;
    await flushStats();
}
