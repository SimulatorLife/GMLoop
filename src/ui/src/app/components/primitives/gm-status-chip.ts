import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Closed set of status labels supported by the shared UI status badge.
 */
export type GmStatusChipStatus =
    "not-running" | "running" | "starting" | "stopped" | "offline" | "error" | "scanning" | "success";

type GmStatusChipConfig = Readonly<{
    label: string;
}>;

const STATUS_CHIP_CONFIG: Readonly<Record<GmStatusChipStatus, GmStatusChipConfig>> = Object.freeze({
    error: { label: "Error" },
    "not-running": { label: "Not running" },
    offline: { label: "Offline" },
    running: { label: "Running" },
    scanning: { label: "Scanning" },
    starting: { label: "Starting" },
    stopped: { label: "Stopped" },
    success: { label: "Success" }
});

function isGmStatusChipStatus(value: string): value is GmStatusChipStatus {
    return Object.hasOwn(STATUS_CHIP_CONFIG, value);
}

/**
 * Reusable status badge with repository-owned labels instead of feature-defined free-form text.
 */
export class GmStatusChip extends LightDomLitElement {
    public static properties = {
        status: { reflect: true, type: String }
    };

    public accessor status: GmStatusChipStatus = "not-running";

    protected render() {
        // Keep status badge copy centralized so feature pages select states instead of inventing labels.
        const status = isGmStatusChipStatus(this.status) ? this.status : "not-running";
        const config = STATUS_CHIP_CONFIG[status];

        return html`
            <span
                class=${`gm-status-chip gm-status-chip--${status}`}
                role="status"
                aria-label=${`Status: ${config.label}`}
            >
                <span class="gm-status-chip__dot" aria-hidden="true"></span>
                <strong>${config.label}</strong>
            </span>
        `;
    }
}
