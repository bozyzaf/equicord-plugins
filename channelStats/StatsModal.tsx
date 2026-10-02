/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Forms, GuildMemberStore, React, Text, Toasts, UserStore } from "@webpack/common";

import { settings } from "./settings";
import {
    getActivityStreak,
    getAverageDailyMessages,
    getDailySeries,
    getHourlyActivity,
    getMonthlySeries,
    getMostActiveDay,
    getPeakHour,
    getSinceTimestamp,
    getTodayMessages,
    getTodayPercentage,
    getTopUsers,
    getTotalMessages,
    getYourRank,
    SeriesPoint
} from "./store";
import { cl, Period, PERIODS } from "./utils";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CHART_HEIGHT = 80;

interface ChannelLike {
    id: string;
    name?: string;
    guild_id?: string;
    recipients?: string[];
}

// date keys are local dates, so build them as local dates too
function fromKey(key: string) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function formatDate(key: string): string {
    return `${key} (${DAY_NAMES[fromKey(key).getDay()]})`;
}

function defaultAvatar(userId: string): string {
    try {
        return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> 22n) % 6n)}.png`;
    } catch {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
}

function StatCard({ title, value, sub }: { title: string; value: React.ReactNode; sub?: string; }) {
    return (
        <div className={cl("stat-card")}>
            <Forms.FormTitle>{title}</Forms.FormTitle>
            <Text variant="heading-xxl/bold">{value}</Text>
            {sub && <Forms.FormText>{sub}</Forms.FormText>}
        </div>
    );
}

interface BarItem {
    key: string;
    label: string;
    title: string;
    count: number;
    highlight?: boolean;
}

function BarChart({ items }: { items: BarItem[]; }) {
    const max = Math.max(...items.map(i => i.count), 1);

    return (
        <div className={cl("chart")}>
            {items.map(item => (
                <div key={item.key} className={cl("chart-col")} title={item.title}>
                    <div
                        className={`${cl("chart-bar")} ${item.highlight ? cl("chart-bar-peak") : ""} ${item.count === 0 ? cl("chart-bar-empty") : ""}`}
                        style={{ height: Math.max(2, Math.round((item.count / max) * CHART_HEIGHT)) }}
                    />
                    <span className={cl("chart-label")}>{item.label}</span>
                </div>
            ))}
        </div>
    );
}

function labelEvery(items: SeriesPoint[], max = 12) {
    return Math.max(1, Math.ceil(items.length / max));
}

function ActivityChart({ channelId, period, since, peakHour, hasData }: {
    channelId: string;
    period: Period;
    since: number;
    peakHour: number;
    hasData: boolean;
}) {
    if (period === "day") {
        const hourly = getHourlyActivity(channelId, since);
        return (
            <BarChart items={hourly.map((count, hour) => ({
                key: String(hour),
                label: hour % 6 === 0 ? `${hour}h` : "",
                title: `${hour}:00 — ${count} messages`,
                count,
                highlight: hasData && hour === peakHour,
            }))} />
        );
    }

    if (period === "week" || period === "month") {
        const daily = getDailySeries(channelId, since);
        const step = period === "week" ? 1 : 5;
        return (
            <BarChart items={daily.map(({ key, count }, i) => {
                const d = fromKey(key);
                return {
                    key,
                    label: i % step === 0 ? (period === "week" ? DAY_NAMES[d.getDay()] : String(d.getDate())) : "",
                    title: `${formatDate(key)} — ${count} messages`,
                    count,
                };
            })} />
        );
    }

    const monthly = getMonthlySeries(channelId, since);
    const step = labelEvery(monthly);
    const multiYear = monthly.length > 12;
    return (
        <BarChart items={monthly.map(({ key, count }, i) => {
            const d = fromKey(`${key}-01`);
            const short = d.toLocaleString("default", { month: "short" });
            return {
                key,
                label: i % step === 0 ? (multiYear ? `${short} ${String(d.getFullYear()).slice(2)}` : short) : "",
                title: `${key} — ${count} messages`,
                count,
            };
        })} />
    );
}

function TopUserRow({ userId, count, rank, total, maxCount, guildId, me }: {
    userId: string;
    count: number;
    rank: number;
    total: number;
    maxCount: number;
    guildId?: string;
    me?: string;
}) {
    const user = UserStore.getUser(userId);
    const member = guildId ? GuildMemberStore?.getMember?.(guildId, userId) : null;
    const username = member?.nick ?? user?.globalName ?? user?.username ?? userId;
    const avatar = (user as any)?.getAvatarURL?.(guildId, 32, false) ?? defaultAvatar(userId);
    const isMe = userId === me;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;

    return (
        <div className={`${cl("user-row")} ${isMe ? cl("user-row-me") : ""}`}>
            <span className={cl("rank")}>#{rank}</span>
            <img
                className={cl("avatar")}
                src={avatar}
                alt=""
                onError={e => { (e.target as HTMLImageElement).src = defaultAvatar(userId); }}
            />
            <span className={cl("username")}>
                {username}{isMe ? " (you)" : ""}
                {!user && (
                    <button
                        className={cl("copy-mention")}
                        onClick={e => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(`<@${userId}>`);
                            Toasts.show({ message: "Copied mention!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                        }}
                    >
                        copy mention
                    </button>
                )}
            </span>
            <span className={cl("count")}>
                {count.toLocaleString()} <span className={cl("count-pct")}>({pct}%)</span>
            </span>
            <div className={cl("bar-wrap")}>
                <div className={cl("bar")} style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
        </div>
    );
}

export function StatsModal({ modalProps, channel }: { modalProps: ModalProps; channel: ChannelLike; }) {
    const [period, setPeriod] = React.useState<Period>(settings.store.defaultPeriod as Period);

    const me = UserStore.getCurrentUser()?.id;
    const isDM = !channel.guild_id;
    const channelName = channel.name
        || channel.recipients?.map(id => UserStore.getUser(id)?.username).filter(Boolean).join(", ")
        || "DM";

    const topCount = Math.min(50, Math.max(1, settings.store.topUsersCount ?? 10));
    const since = getSinceTimestamp(period);

    const total = getTotalMessages(channel.id, since);
    const hasData = total > 0;
    const todayTotal = getTodayMessages(channel.id);
    const avg = getAverageDailyMessages(channel.id, since);
    const peakHour = getPeakHour(channel.id, since);
    const topUsers = getTopUsers(channel.id, since, topCount);
    const bestDay = getMostActiveDay(channel.id, since);
    const myRank = me ? getYourRank(channel.id, since, me) : -1;
    const streak = getActivityStreak(channel.id);
    const todayPct = getTodayPercentage(channel.id);

    const chartTitle = period === "day"
        ? "Activity by Hour"
        : period === "week" || period === "month"
            ? "Activity by Day"
            : "Activity by Month";

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator={false}>
                <Text variant="heading-lg/semibold" style={{ flex: 1 }}>
                    {isDM ? "" : "#"}{channelName} — Statistics
                </Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("modal")}>
                <div className={cl("period-row")}>
                    {PERIODS.map(p => (
                        <button
                            key={p.value}
                            className={`${cl("period-btn")} ${period === p.value ? cl("period-btn-active") : ""}`}
                            onClick={() => setPeriod(p.value)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                <div className={cl("stats-row")}>
                    <StatCard title="Total Messages" value={total.toLocaleString()} />
                    {period !== "day" && <StatCard title="Today" value={todayTotal.toLocaleString()} />}
                    <StatCard title="Avg / Day" value={avg.toLocaleString()} />
                    <StatCard title="Peak Hour" value={hasData ? `${peakHour}:00` : "—"} />
                </div>

                <div className={cl("stats-row")}>
                    {bestDay && (
                        <div className={cl("stat-card")}>
                            <Forms.FormTitle>Most Active Day</Forms.FormTitle>
                            <Text variant="heading-md/bold">{formatDate(bestDay.date)}</Text>
                            <Forms.FormText>{bestDay.count.toLocaleString()} messages</Forms.FormText>
                        </div>
                    )}
                    {myRank > 0 && <StatCard title="Your Rank" value={`#${myRank}`} />}
                    <StatCard title="Channel Streak" value={`${streak} ${streak === 1 ? "day" : "days"}`} />
                    {period !== "day" && hasData && <StatCard title="Today vs All time" value={`${todayPct}%`} />}
                </div>

                <div className={cl("stat-card")}>
                    <Forms.FormTitle>Top Users</Forms.FormTitle>
                    {topUsers.length === 0 ? (
                        <Forms.FormText className={cl("empty")}>No data yet.</Forms.FormText>
                    ) : (
                        <div className={cl("top-users")}>
                            {topUsers.map(({ userId, count }, i) => (
                                <TopUserRow
                                    key={userId}
                                    userId={userId}
                                    count={count}
                                    rank={i + 1}
                                    total={total}
                                    maxCount={topUsers[0].count}
                                    guildId={channel.guild_id}
                                    me={me}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {hasData && (
                    <div className={cl("stat-card")}>
                        <Forms.FormTitle>{chartTitle}</Forms.FormTitle>
                        <ActivityChart
                            channelId={channel.id}
                            period={period}
                            since={since}
                            peakHour={peakHour}
                            hasData={hasData}
                        />
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}
