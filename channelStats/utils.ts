/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

export const cl = classNameFactory("vc-chanstats-");

export type Period = "day" | "week" | "month" | "year" | "all";

export const PERIODS: { value: Period; label: string; }[] = [
    { value: "day", label: "Today" },
    { value: "week", label: "7 days" },
    { value: "month", label: "30 days" },
    { value: "year", label: "Year" },
    { value: "all", label: "All time" },
];
