/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { OptionType } from "@utils/types";
import { Alerts, ChannelStore, Forms, GuildStore, React, Toasts } from "@webpack/common";

import {
    deleteChannelStats,
    deleteGuildStats,
    exportStats,
    getAllTrackedChannels,
    getChannelGuildId,
    getChannelMessageCount,
    importStats,
    resetStats
} from "./store";
import { cl } from "./utils";

const toast = (message: string, type = Toasts.Type.SUCCESS) =>
    Toasts.show({ message, type, id: Toasts.genId() });

function channelLabel(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (channel?.name) return `#${channel.name}`;
    if (channel?.isDM?.() || channel?.isGroupDM?.()) return `DM (${channelId})`;
    return `Unknown channel (${channelId})`;
}

function guildLabel(guildId: string): string {
    if (guildId === "dm") return "Direct Messages";
    if (guildId === "unknown") return "Unknown Server";
    return GuildStore.getGuild(guildId)?.name ?? `Unknown Server (${guildId})`;
}

function GuildSection({ guildId, channelIds, onChange }: { guildId: string; channelIds: string[]; onChange(): void; }) {
    const [open, setOpen] = React.useState(false);

    const name = guildLabel(guildId);
    const counts = new Map(channelIds.map(id => [id, getChannelMessageCount(id)]));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const sorted = [...channelIds].sort((a, b) => counts.get(b)! - counts.get(a)!);

    return (
        <div className={cl("manage-guild")}>
            <div className={cl("manage-header")}>
                <button className={cl("manage-toggle")} onClick={() => setOpen(o => !o)}>
                    <span>{open ? "▾" : "▸"}</span>
                    <span className={cl("manage-name")}>{name}</span>
                    <span className={cl("manage-muted")}>
                        {channelIds.length} channels · {total.toLocaleString()} messages
                    </span>
                </button>
                <Button
                    variant="dangerPrimary"
                    onClick={() => Alerts.show({
                        title: `Delete ${name} stats?`,
                        body: `This will delete all statistics for ${name}.`,
                        confirmText: "Delete",
                        cancelText: "Cancel",
                        onConfirm: async () => {
                            await deleteGuildStats(guildId);
                            onChange();
                            toast("Deleted!");
                        },
                    })}
                >
                    Delete All
                </Button>
            </div>

            {open && sorted.map(channelId => {
                const label = channelLabel(channelId);
                return (
                    <div key={channelId} className={cl("manage-channel")}>
                        <span className={cl("manage-name")}>
                            {label}{" "}
                            <span className={cl("manage-muted")}>({counts.get(channelId)!.toLocaleString()} messages)</span>
                        </span>
                        <Button
                            onClick={() => {
                                navigator.clipboard.writeText(`<#${channelId}>`);
                                toast("Copied mention!");
                            }}
                        >
                            Copy
                        </Button>
                        <Button
                            variant="dangerPrimary"
                            onClick={() => Alerts.show({
                                title: "Delete channel stats?",
                                body: `This will delete all statistics for ${label}.`,
                                confirmText: "Delete",
                                cancelText: "Cancel",
                                onConfirm: async () => {
                                    await deleteChannelStats(channelId);
                                    onChange();
                                    toast("Deleted!");
                                },
                            })}
                        >
                            Delete
                        </Button>
                    </div>
                );
            })}
        </div>
    );
}

function ManageData() {
    const [, setTick] = React.useState(0);
    const refresh = () => setTick(t => t + 1);

    const groups = new Map<string, string[]>();
    for (const channelId of getAllTrackedChannels()) {
        const guildId = getChannelGuildId(channelId);
        const list = groups.get(guildId) ?? [];
        list.push(channelId);
        groups.set(guildId, list);
    }

    const guildTotal = (ids: string[]) => ids.reduce((acc, id) => acc + getChannelMessageCount(id), 0);
    const sorted = [...groups.entries()].sort((a, b) => guildTotal(b[1]) - guildTotal(a[1]));

    return (
        <div className={cl("manage")}>
            <Forms.FormTitle>Tracked Channels</Forms.FormTitle>
            {sorted.length === 0 && <Forms.FormText>No channels tracked yet.</Forms.FormText>}
            {sorted.map(([guildId, channelIds]) => (
                <GuildSection key={guildId} guildId={guildId} channelIds={channelIds} onChange={refresh} />
            ))}
        </div>
    );
}

function ImportButton() {
    return (
        <Button onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json";
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const days = await importStats(JSON.parse(await file.text()));
                    toast(`Imported ${days} days!`);
                } catch (e) {
                    toast(e instanceof Error ? e.message : "Invalid file!", Toasts.Type.FAILURE);
                }
            };
            input.click();
        }}>
            Import Statistics
        </Button>
    );
}

function ExportButton() {
    return (
        <Button onClick={async () => {
            const blob = new Blob([await exportStats()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "channel-stats.json";
            a.click();
            URL.revokeObjectURL(url);
            toast("Exported!");
        }}>
            Export Statistics
        </Button>
    );
}

function ResetButton() {
    return (
        <Button
            variant="dangerPrimary"
            onClick={() => Alerts.show({
                title: "Reset Statistics?",
                body: "This will permanently delete all collected channel statistics.",
                confirmText: "Reset",
                cancelText: "Cancel",
                onConfirm: async () => {
                    await resetStats();
                    toast("Statistics reset!");
                },
            })}
        >
            Reset All Statistics
        </Button>
    );
}

export const settings = definePluginSettings({
    defaultPeriod: {
        type: OptionType.SELECT,
        description: "Default time period for statistics",
        options: [
            { label: "Today", value: "day", default: true },
            { label: "Last 7 days", value: "week" },
            { label: "Last 30 days", value: "month" },
            { label: "Last year", value: "year" },
            { label: "All time", value: "all" },
        ],
    },
    topUsersCount: {
        type: OptionType.NUMBER,
        description: "Number of users to show in the top list (1-50)",
        default: 10,
    },
    trackDMs: {
        type: OptionType.BOOLEAN,
        description: "Track DMs and group DMs",
        default: false,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Don't count messages from bots",
        default: true,
    },
    guildWhitelist: {
        type: OptionType.STRING,
        description: "Comma-separated list of server IDs to track. Leave empty to track no servers.",
        default: "",
    },
    manageData: {
        type: OptionType.COMPONENT,
        description: "Manage statistics per channel or server",
        component: ManageData,
    },
    importData: {
        type: OptionType.COMPONENT,
        description: "Import statistics from JSON",
        component: ImportButton,
    },
    exportData: {
        type: OptionType.COMPONENT,
        description: "Export all statistics to JSON",
        component: ExportButton,
    },
    resetData: {
        type: OptionType.COMPONENT,
        description: "Reset all collected statistics",
        component: ResetButton,
    },
});
