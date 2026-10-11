/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, React, Text, TextInput, Toasts } from "@webpack/common";

const cl = classNameFactory("vc-cliphist-");
const DS_KEY = "ClipboardHistory_v1";
const SAVE_DELAY = 2000;

interface Entry {
    id: string;
    text: string;
    time: number;
    pinned: boolean;
}

let history: Entry[] = [];
let loaded = false;
let canSave = false; // false when loading from disk failed, so we never overwrite old data
let pending: string[] = [];
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

function useHistory() {
    const [, force] = React.useState(0);
    React.useEffect(() => {
        const l = () => force(x => x + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return history;
}

function scheduleSave() {
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        void flush();
    }, SAVE_DELAY);
}

async function flush() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    if (!loaded || !canSave) return;

    try {
        if (settings.store.saveToDisk) await DataStore.set(DS_KEY, history);
        else await DataStore.del(DS_KEY);
    } catch (e) {
        console.error("[ClipboardHistory] Failed to save", e);
    }
}

async function load() {
    try {
        const data = await DataStore.get<Entry[]>(DS_KEY);
        history = Array.isArray(data)
            ? data.filter(e => e && typeof e.text === "string" && typeof e.time === "number")
            : [];
        canSave = true;
    } catch (e) {
        console.error("[ClipboardHistory] Failed to load, history won't be saved this session", e);
        history = [];
        canSave = false;
    }

    loaded = true;
    const queued = pending;
    pending = [];
    queued.forEach(addEntry);
    emit();
}

// history logic

function trim() {
    const max = Math.max(1, settings.store.maxItems);
    const pinned = history.filter(e => e.pinned);
    const rest = history.filter(e => !e.pinned).slice(0, Math.max(0, max - pinned.length));
    history = [...pinned, ...rest].sort((a, b) => b.time - a.time);
}

function addEntry(text: string) {
    if (!text || !text.trim()) return;
    if (text.length > settings.store.maxLength) return;

    // copied before the saved history finished loading
    if (!loaded) {
        pending.push(text);
        return;
    }

    const existing = history.find(e => e.text === text);
    history = history.filter(e => e.text !== text);
    history.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text,
        time: Date.now(),
        pinned: existing?.pinned ?? false,
    });

    trim();
    emit();
    scheduleSave();
}

function removeEntry(id: string) {
    history = history.filter(e => e.id !== id);
    emit();
    scheduleSave();
}

function togglePin(id: string) {
    const e = history.find(x => x.id === id);
    if (!e) return;
    e.pinned = !e.pinned;
    emit();
    scheduleSave();
}

function clearUnpinned() {
    history = history.filter(e => e.pinned);
    emit();
    scheduleSave();
}

function clearAll() {
    history = [];
    emit();
    scheduleSave();
}

// clipboard hooks

function getSelectedText(): string {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === "password") return "";

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return active.value.substring(active.selectionStart ?? 0, active.selectionEnd ?? 0);
    }
    return window.getSelection()?.toString() ?? "";
}

function onCopy() {
    const text = getSelectedText();
    if (text) addEntry(text);
}

function onKeyDown(e: KeyboardEvent) {
    const isCopy = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
        && (e.key === "c" || e.key === "C" || e.key === "Insert");
    if (!isCopy) return;

    // read the selection right away, before anything can clear it
    const text = getSelectedText();
    if (text) addEntry(text);
}

function hookClipboard() {
    // Ctrl+C / selection copy
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("keydown", onKeyDown, true);

    // anything that uses the async clipboard API
    try {
        const cb = navigator.clipboard;
        const original = cb.writeText.bind(cb);
        cb.writeText = (text: string) => {
            if (typeof text === "string") addEntry(text);
            return original(text);
        };
    } catch (e) {
        console.warn("[ClipboardHistory] Couldn't hook navigator.clipboard", e);
    }
}

function unhookClipboard() {
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("keydown", onKeyDown, true);

    try {
        // removes our instance-level override, the original prototype method is used again
        delete (navigator.clipboard as any).writeText;
    } catch { }
}

// ---------- UI ----------

function copyEntry(text: string) {
    navigator.clipboard.writeText(text);
    Toasts.show({ message: "Copied!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

function EntryRow({ entry }: { entry: Entry; }) {
    const preview = entry.text.length > 300 ? entry.text.slice(0, 300) + "…" : entry.text;

    return (
        <div className={cl("row")}>
            <div className={cl("row-body")}>
                <div className={cl("text")}>{preview}</div>
                <div className={cl("meta")}>
                    {entry.pinned ? "📌 " : ""}{new Date(entry.time).toLocaleString()} · {entry.text.length} chars
                </div>
            </div>
            <div className={cl("actions")}>
                <Button onClick={() => copyEntry(entry.text)}>Copy</Button>
                <Button onClick={() => togglePin(entry.id)}>{entry.pinned ? "Unpin" : "Pin"}</Button>
                <Button variant="dangerPrimary" onClick={() => removeEntry(entry.id)}>Delete</Button>
            </div>
        </div>
    );
}

function HistoryModal({ modalProps }: { modalProps: ModalProps; }) {
    const items = useHistory();
    const [query, setQuery] = React.useState("");

    const q = query.trim().toLowerCase();
    const shown = items
        .filter(e => !q || e.text.toLowerCase().includes(q))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time);

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <Text variant="heading-lg/semibold" style={{ flex: 1 }}>Clipboard History</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("modal")}>
                <TextInput
                    value={query}
                    placeholder="Search..."
                    onChange={(v: string) => setQuery(v)}
                />

                <div className={cl("list")}>
                    {shown.length === 0 && (
                        <Text variant="text-md/normal" className={cl("empty")}>
                            {items.length === 0 ? "Nothing copied yet." : "No results."}
                        </Text>
                    )}
                    {shown.map(e => <EntryRow key={e.id} entry={e} />)}
                </div>

                {items.some(e => !e.pinned) && (
                    <div className={cl("footer")}>
                        <Button
                            variant="dangerPrimary"
                            onClick={() => Alerts.show({
                                title: "Clear history?",
                                body: "This removes all unpinned entries.",
                                confirmText: "Clear",
                                cancelText: "Cancel",
                                onConfirm: clearUnpinned,
                            })}
                        >
                            Clear unpinned
                        </Button>
                    </div>
                )}
            </ModalContent>
        </ModalRoot>
    );
}

function ClipboardIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 4h-1.18A3 3 0 0 0 12 2a3 3 0 0 0-2.82 2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm-4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4 16H8V6h1v2h6V6h1v14Z" />
        </svg>
    );
}

const HistoryButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip="Clipboard History"
            onClick={() => openModal(props => <HistoryModal modalProps={props} />)}
        >
            <ClipboardIcon />
        </ChatBarButton>
    );
};

// plugin settings

const settings = definePluginSettings({
    maxItems: {
        type: OptionType.NUMBER,
        description: "Maximum number of entries to keep (pinned entries count too)",
        default: 50,
    },
    maxLength: {
        type: OptionType.NUMBER,
        description: "Ignore copied text longer than this many characters",
        default: 5000,
    },
    saveToDisk: {
        type: OptionType.BOOLEAN,
        description: "Keep history after restarting Discord (stored unencrypted on this device)",
        default: true,
    },
    clearData: {
        type: OptionType.COMPONENT,
        description: "Remove everything, including pinned entries",
        component: () => (
            <Button
                variant="dangerPrimary"
                onClick={() => Alerts.show({
                    title: "Delete all clipboard history?",
                    body: "This permanently removes all entries, including pinned ones.",
                    confirmText: "Delete",
                    cancelText: "Cancel",
                    onConfirm: clearAll,
                })}
            >
                Delete All History
            </Button>
        ),
    },
});

export default definePlugin({
    name: "ClipboardHistory",
    description: "Keeps a searchable history of things you copied in Discord, with pinning and quick re-copy.",
    authors: [EquicordDevs.sketchmyname],
    tags: ["Utility"],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    patches: [
        {
            // discord's internal copy function
            find: "clipboardHasMixedContent",
            replacement: {
                match: /async copy\((\i)\)\{/,
                replace: "async copy($1){$self.onDiscordCopy($1);"
            }
        }
    ],

    onDiscordCopy(text: unknown) {
        try {
            if (typeof text === "string") addEntry(text);
        } catch (e) {
            console.error("[ClipboardHistory] onDiscordCopy failed", e);
        }
    },

    chatBarButton: {
        icon: ClipboardIcon,
        render: HistoryButton,
    },

    async start() {
        hookClipboard();
        await load();
    },

    stop() {
        unhookClipboard();
        void flush();
    },
});
