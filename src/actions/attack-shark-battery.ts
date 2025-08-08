import {
    action,
    DidReceiveSettingsEvent,
    KeyDownEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import { createRequire } from "node:module";
import { icons, iconUnknown } from "../assets/battery-svg";

// Dynamically require native module at runtime to avoid bundling issues
const requireNative = createRequire(import.meta.url);
// Use `any` to avoid bringing in types for node-hid
let HID: any;

type Settings = {
    renderTitle: boolean;
    renderIcon: boolean;
    iconColor: string;
};

@action({ UUID: "tech.flowei.gaming-mouse-battery.attack-shark" })
export class AttackSharkBatteryAction extends SingletonAction<Settings> {
    private refreshTimer: NodeJS.Timeout | null = null;

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        await this.updateState(ev);
        this.refreshTimer = setInterval(() => {
            void this.updateState(ev);
        }, 60_000);
    }

    override onWillDisappear(_ev: WillDisappearEvent<Settings>): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        await this.updateState(ev as unknown as WillAppearEvent<Settings>);
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<Settings>
    ): Promise<void> {
        await this.updateState(ev as unknown as WillAppearEvent<Settings>);
    }

    private async updateState(ev: WillAppearEvent<Settings>): Promise<void> {
        try {
            const { isCharging, percentage } = readBatteryState() ?? {};
            const title =
                typeof percentage === "number" && percentage > 0
                    ? `${percentage}%`
                    : "--%";
            if (ev.payload.settings.renderTitle) {
                await ev.action.setTitle(title);
            }
            if (ev.payload.settings.renderIcon) {
                let icon = icons.low;
                if (!percentage || typeof percentage !== "number") {
                    await ev.action.setImage(
                        `data:image/svg+xml,${encodeURIComponent(
                            iconUnknown.replace(
                                "{{COLOR}}",
                                ev.payload.settings.iconColor
                            )
                        )}`
                    );
                    return;
                }
                if (percentage > 90) {
                    icon = icons.full;
                } else if (percentage > 80) {
                    icon = icons[90];
                } else if (percentage > 70) {
                    icon = icons[80];
                } else if (percentage > 50) {
                    icon = icons[60];
                } else if (percentage > 40) {
                    icon = icons[50];
                } else if (percentage > 20) {
                    icon = icons[30];
                } else if (percentage > 10) {
                    icon = icons[20];
                }
                const svg = isCharging
                    ? icon.charging.replace(
                          "{{COLOR}}",
                          ev.payload.settings.iconColor
                      )
                    : icon.default.replace(
                          "{{COLOR}}",
                          ev.payload.settings.iconColor
                      );
                await ev.action.setImage(
                    `data:image/svg+xml,${encodeURIComponent(svg)}`
                );
            }
        } catch {
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(
                    iconUnknown.replace(
                        "{{COLOR}}",
                        ev.payload.settings.iconColor
                    )
                )}`
            );
        }
    }
}

// ===== Attack Shark battery reader (adapted from battery-logger-node.js) =====

const CONFIG = {
    vendorId: 0x373e,
    productIds: [0x0021, 0x0022, 0x003a, 0x003b, 0x0046, 0x0047],
    featureReportIdsToTry: [0, 4],
    featureReportLengthsToTry: [64, 65, 128],
    initialDelaysMsToTry: [120, 250, 400],
};

function ensureHidLoaded(): void {
    if (!HID) {
        // Load lazily so the module is only required when needed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        HID = requireNative("node-hid");
    }
}

function enumerateCandidateDevices(): any[] {
    ensureHidLoaded();
    const all = HID.devices();
    return all.filter(
        (d: any) =>
            d.vendorId === CONFIG.vendorId &&
            CONFIG.productIds.includes(d.productId)
    );
}

function openDeviceByPath(devicePath: string): any | null {
    ensureHidLoaded();
    try {
        return new HID.HID(devicePath);
    } catch {
        return null;
    }
}

function buildBatteryRequestBuffer(reportId: number): Buffer {
    const totalLen = 1 + 64;
    const buf = Buffer.alloc(totalLen, 0);
    buf[0] = reportId;
    buf[1 + 2] = 2;
    buf[1 + 3] = 2;
    buf[1 + 5] = 131;
    return buf;
}

function parseBatteryStateFromResponse(
    responseBuffer: Buffer | Uint8Array | undefined | null
): { isCharging: boolean; percentage: number } {
    if (!responseBuffer || (responseBuffer as any).length === 0)
        return { isCharging: false, percentage: 0 };
    const bytes = Uint8Array.from(responseBuffer as Uint8Array);

    try {
        if (
            bytes.length >= 9 &&
            bytes[1] === 0xa1 &&
            bytes[4] === 2 &&
            bytes[6] === 131
        ) {
            const isCharging = bytes[7] === 1;
            const soc = bytes[8];
            const value = Number(soc);
            return {
                isCharging,
                percentage: Number.isFinite(value) ? Math.round(value) : 0,
            };
        }

        if (
            bytes.length >= 8 &&
            bytes[0] === 0xa1 &&
            bytes[3] === 2 &&
            bytes[5] === 131
        ) {
            const isCharging = bytes[6] === 1;
            const soc = bytes[7];
            const value = Number(soc);
            return {
                isCharging,
                percentage: Number.isFinite(value) ? Math.round(value) : 0,
            };
        }
    } catch {
        // ignore
    }

    return { isCharging: false, percentage: 0 };
}

function sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // busy-wait; short delays only (<= 400ms)
    }
}

function tryReadBatteryOnce(
    deviceInfo: any
): { isCharging: boolean; percentage: number } | null {
    const device = openDeviceByPath(deviceInfo.path);
    if (!device) return null;

    try {
        for (const reportId of CONFIG.featureReportIdsToTry) {
            const request = buildBatteryRequestBuffer(reportId);
            try {
                device.sendFeatureReport(request);
            } catch {
                continue;
            }

            for (const delayMs of CONFIG.initialDelaysMsToTry) {
                sleepSync(delayMs);

                for (const readLen of CONFIG.featureReportLengthsToTry) {
                    let response: Buffer | undefined;
                    try {
                        response = device.getFeatureReport(reportId, readLen);
                    } catch {
                        continue;
                    }

                    const { isCharging, percentage } =
                        parseBatteryStateFromResponse(response);
                    if (typeof percentage === "number" && percentage > 0) {
                        return { isCharging, percentage };
                    }
                }
            }
        }
        return null;
    } finally {
        try {
            device.close();
        } catch {
            // ignore
        }
    }
}

function readBatteryState(): {
    isCharging: boolean;
    percentage: number;
} | null {
    const candidates = enumerateCandidateDevices();
    if (!candidates.length) return null;

    for (const info of candidates) {
        const state = tryReadBatteryOnce(info);
        if (
            state &&
            typeof state.percentage === "number" &&
            state.percentage > 0
        ) {
            return state;
        }
    }
    return null;
}
