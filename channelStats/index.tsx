/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { EquicordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ChannelStore } from "@webpack/common";

import { settings } from "./settings";
import { StatsModal } from "./StatsModal";
import { flushStats, loadStats, recordMessage } from "./store";

// default, reply, chat input command, context menu command
const TRACKED_TYPES = new Set([0, 19, 20, 23]);

function StatsIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3v18h18V3H3zm16 16H5V5h14v14zM7 11h2v6H7v-6zm4-4h2v10h-2V7zm4 6h2v4h-2v-4z" />
        </svg>
    );
}

const StatsButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip="Channel Statistics"
            onClick={() => openModal(props => <StatsModal modalProps={props} channel={channel} />)}
        >
            <StatsIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "ChannelStats",
    description: "Shows statistics for a channel - top users, message count, activity hours.",
    authors: [EquicordDevs.sketchmyname],
    tags: ["Chat", "Utility"],
    settings,
    dependencies: ["ChatInputButtonAPI"],

    chatBarButton: {
        icon: StatsIcon,
        render: StatsButton,
    },

    flux: {
        MESSAGE_CREATE({ optimistic, message, channelId }: { optimistic: boolean; message: any; channelId: string; }) {
            if (optimistic || !message?.author?.id || message.state === "SENDING") return;
            if (!TRACKED_TYPES.has(message.type ?? 0)) return;
            if (message.webhook_id) return;
            if (settings.store.ignoreBots && message.author.bot) return;

            const channel = ChannelStore.getChannel(channelId);
            if (!channel) return;

            const isDM = channel.isDM() || channel.isGroupDM();

            if (isDM) {
                if (!settings.store.trackDMs) return;
            } else {
                const whitelist = settings.store.guildWhitelist
                    .split(",")
                    .map(id => id.trim())
                    .filter(Boolean);

                if (whitelist.length > 0 && (!channel.guild_id || !whitelist.includes(channel.guild_id))) return;
            }

            recordMessage(
                channelId,
                isDM ? "dm" : channel.guild_id ?? "unknown",
                message.author.id,
                new Date(message.timestamp).getTime()
            );
        },
    },

    async start() {
        await loadStats();
    },

    stop() {
        void flushStats();
    },
});
