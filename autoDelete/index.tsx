/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, Menu, React, RestAPI, SelectedChannelStore, Text, TextInput, Toasts, useEffect, UserStore, useState } from "@webpack/common";

const settings = definePluginSettings({
    delay: {
        type: OptionType.NUMBER,
        description: "Base delay between deletions in milliseconds (random extra 0-2000ms will be added, minimum 1000)",
        default: 2000,
    }
});

// message types that users can actually delete: default, reply, chat input command, context menu command
const DELETABLE_TYPES = new Set([0, 19, 20, 23]);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const humanDelay = () => Math.max(1000, settings.store.delay) + Math.random() * 2000;
const batchDelay = () => 3000 + Math.random() * 3000;

// shared progress state

interface Progress {
    running: boolean;
    channelId: string | null;
    target: number; // Infinity = all
    deleted: number;
    failed: number;
    stopRequested: boolean;
}

const progress: Progress = {
    running: false,
    channelId: null,
    target: 0,
    deleted: 0,
    failed: 0,
    stopRequested: false,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function useProgress() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(x => x + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return progress;
}

function stopDeleting() {
    if (!progress.running) return;
    progress.stopRequested = true;
    emit();
    Toasts.show({ message: "Stopping deletion...", type: Toasts.Type.MESSAGE, id: Toasts.genId() });
}

// deletion logic

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (e: any) {
            if (e?.status === 429 && attempt < maxRetries) {
                const wait = (e?.body?.retry_after ?? 5) * 1000 + 500;
                console.warn(`[AutoDelete] Rate limited, waiting ${wait}ms`);
                await sleep(wait);
                continue;
            }
            throw e;
        }
    }
}

async function deleteMessages(channelId: string, target: number) {
    if (progress.running) return;

    Object.assign(progress, { running: true, channelId, target, deleted: 0, failed: 0, stopRequested: false });
    emit();

    const userId = UserStore.getCurrentUser().id;
    let before: string | undefined;

    try {
        while (!progress.stopRequested && progress.deleted < target) {
            const res = await withRetry(() => RestAPI.get({
                url: `/channels/${channelId}/messages`,
                query: { limit: 100, ...(before ? { before } : {}) }
            }));

            const messages: any[] = res.body;
            if (!messages.length) break;

            const mine = messages.filter(m => m.author.id === userId && DELETABLE_TYPES.has(m.type));

            for (const msg of mine) {
                if (progress.stopRequested || progress.deleted >= target) break;

                try {
                    await withRetry(() => RestAPI.del({ url: `/channels/${channelId}/messages/${msg.id}` }));
                    progress.deleted++;
                } catch (e) {
                    progress.failed++;
                    console.error("[AutoDelete] Failed to delete", msg.id, e);
                }
                emit();

                await sleep(humanDelay());
            }

            before = messages[messages.length - 1].id;
            if (messages.length < 100) break;

            await sleep(batchDelay());
        }
    } catch (e) {
        console.error("[AutoDelete] Fatal error", e);
        Toasts.show({ message: "AutoDelete: error, check the console.", type: Toasts.Type.FAILURE, id: Toasts.genId() });
    } finally {
        const { deleted, stopRequested } = progress;
        progress.running = false;
        emit();

        Toasts.show({
            message: stopRequested ? `Stopped! Deleted ${deleted} messages.` : `Done! Deleted ${deleted} messages.`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    }
}

// ui

const PRESETS: { label: string; value: number; }[] = [
    { label: "10", value: 10 },
    { label: "50", value: 50 },
    { label: "100", value: 100 },
    { label: "500", value: 500 },
    { label: "All", value: 0 },
];

function ConfigView({ channelId, onClose }: { channelId: string; onClose(): void; }) {
    const [count, setCount] = useState(50);
    const [text, setText] = useState("50");

    const set = (n: number) => {
        setCount(n);
        setText(String(n));
    };

    const deleteAll = count === 0;

    return (
        <>
            <ModalContent style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <Forms.FormText>
                    How many of your messages should be deleted in this channel?
                </Forms.FormText>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {PRESETS.map(p => (
                        <Button
                            key={p.label}
                            size={Button.Sizes.SMALL}
                            color={count === p.value ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                            onClick={() => set(p.value)}
                        >
                            {p.label}
                        </Button>
                    ))}
                </div>

                <TextInput
                    type="number"
                    value={text}
                    placeholder="Custom amount (0 = all)"
                    onChange={(v: string) => {
                        setText(v);
                        const n = parseInt(v, 10);
                        setCount(Number.isNaN(n) || n < 0 ? 0 : n);
                    }}
                />

                <Text
                    variant="text-sm/normal"
                    style={{ color: deleteAll ? "var(--status-danger)" : "var(--text-muted)" }}
                >
                    {deleteAll
                        ? "⚠️ This will delete EVERY message you ever sent in this channel. It cannot be undone."
                        : "Deleted messages cannot be recovered."}
                </Text>
            </ModalContent>

            <ModalFooter style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button color={Button.Colors.TRANSPARENT} onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    color={Button.Colors.RED}
                    onClick={() => deleteMessages(channelId, deleteAll ? Infinity : count)}
                >
                    {deleteAll ? "Delete ALL" : `Delete ${count}`}
                </Button>
            </ModalFooter>
        </>
    );
}

function ProgressView({ onClose }: { onClose(): void; }) {
    const p = useProgress();
    const infinite = p.target === Infinity;
    const percent = infinite ? 0 : Math.min(100, Math.round((p.deleted / p.target) * 100));

    return (
        <>
            <ModalContent style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <Text variant="text-md/semibold">
                    {p.running
                        ? (p.stopRequested ? "Stopping..." : "Deleting messages...")
                        : "Finished"}
                </Text>

                {!infinite && (
                    <div style={{
                        height: 8,
                        borderRadius: 4,
                        background: "var(--background-modifier-accent)",
                        overflow: "hidden"
                    }}>
                        <div style={{
                            width: `${percent}%`,
                            height: "100%",
                            background: "var(--brand-500)",
                            transition: "width 0.3s"
                        }} />
                    </div>
                )}

                <Text variant="text-sm/normal">
                    Deleted: <strong>{p.deleted}</strong>
                    {!infinite && <> / {p.target}</>}
                    {p.failed > 0 && <> · Failed: <strong style={{ color: "var(--status-danger)" }}>{p.failed}</strong></>}
                </Text>

                <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                    You can close this window, deletion keeps running in the background.
                </Text>
            </ModalContent>

            <ModalFooter style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button color={Button.Colors.TRANSPARENT} onClick={onClose}>
                    Close
                </Button>
                {p.running && (
                    <Button color={Button.Colors.RED} disabled={p.stopRequested} onClick={stopDeleting}>
                        Stop
                    </Button>
                )}
            </ModalFooter>
        </>
    );
}

function DeleteModal({ modalProps, channelId }: { modalProps: ModalProps; channelId: string; }) {
    const p = useProgress();
    // show progress if a run is active (also when reopening the modal mid-run)
    const showProgress = p.running || p.deleted > 0 || p.failed > 0;

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>AutoDelete Messages</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            {showProgress
                ? <ProgressView onClose={modalProps.onClose} />
                : <ConfigView channelId={channelId} onClose={modalProps.onClose} />}
        </ModalRoot>
    );
}

const openDeleteModal = (channelId: string) => {
    // reset the "finished" state so a new config screen shows up
    if (!progress.running) {
        progress.deleted = 0;
        progress.failed = 0;
    }
    openModal(props => <DeleteModal modalProps={props} channelId={channelId} />);
};

function buildMenuItems(idPrefix: string, channelId: string) {
    return [
        <Menu.MenuSeparator key="sep" />,
        <Menu.MenuItem
            key="start"
            id={`${idPrefix}-start`}
            label="Delete my messages..."
            color="danger"
            action={() => openDeleteModal(channelId)}
        />,
        <Menu.MenuItem
            key="stop"
            id={`${idPrefix}-stop`}
            label="Stop deleting"
            disabled={!progress.running}
            action={stopDeleting}
        />
    ];
}

export default definePlugin({
    name: "AutoDelete",
    description: "Delete your messages in a channel with human-like delays.",
    authors: [{ name: "sketchmyname", id: 1412164910443663491n }],
    settings,

    contextMenus: {
        "user-context": children => {
            const channelId = SelectedChannelStore.getChannelId();
            if (!channelId) return;
            children.push(...buildMenuItems("autodelete", channelId));
        },
        "channel-context": (children, { channel }) => {
            if (!channel?.id) return;
            children.push(...buildMenuItems("autodelete-channel", channel.id));
        }
    }
});
