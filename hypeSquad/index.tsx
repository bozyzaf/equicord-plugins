/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, Toasts } from "@webpack/common";

const HOUSES = [
    { id: 1, name: "Bravery" },
    { id: 2, name: "Brilliance" },
    { id: 3, name: "Balance" },
    { id: 0, name: "None (Remove Badge)" },
];

async function applyHypeSquad(value: number) {
    try {
        if (value === 0) {
            await RestAPI.del({ url: "/hypesquad/online" });
            Toasts.show({ message: "HypeSquad badge removed!", type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            return;
        }
        await RestAPI.post({ url: "/hypesquad/online", body: { house_id: value } });
        const name = HOUSES.find(h => h.id === value)?.name;
        Toasts.show({ message: `Joined House ${name}!`, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
    } catch {
        Toasts.show({ message: "Request failed!", type: Toasts.Type.FAILURE, id: Toasts.genId() });
    }
}

const settings = definePluginSettings({
    house: {
        type: OptionType.SELECT,
        description: "Select your HypeSquad house",
        options: HOUSES.map(h => ({ label: h.name, value: h.id, default: h.id === 0 })),
        onChange: (value: number) => applyHypeSquad(value),
    },
});

export default definePlugin({
    name: "HypeSquadSwitcher",
    description: "Change or remove your HypeSquad badge from plugin settings.",
    authors: [EquicordDevs.sketchmyname],
    settings,
});