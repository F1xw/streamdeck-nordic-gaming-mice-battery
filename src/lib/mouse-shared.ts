import { createRequire } from "node:module";
import type { HID as nHID } from "node-hid";

// Lazily load node-hid; avoids bundler issues
const requireNative = createRequire(import.meta.url);
let HID: any;

export type VidPid = { vid: number; pid: number };

export type MouseModelConfig = {
    ModelEN?: string;
    ModelCN?: string;
    VIDWired?: string;
    PIDWired?: string;
    VIDWireless?: string;
    PIDWireless?: string;
    VIDWireless4K8K?: string;
    PIDWireless4K8K?: string;
};

export type DataSourceItem =
    | { label?: string; value: string }
    | { label?: string; children: Array<{ label?: string; value: string }> };

const SET_REPORT_DEVICE = {
    usage: undefined,
    usagePage: 65535,
};

const READ_FILE_DEVICE = {
    usage: 1,
    usagePage: 65440,
};

const FEATURE_REPORT_IDS = [0, 4];
const FEATURE_REPORT_LENGTHS = [64, 65, 128];
const INITIAL_DELAYS_MS = [120, 250, 400];

export function buildDetectedItemsFromModels(
    models: MouseModelConfig[]
): DataSourceItem[] {
    const detected = getDetectedPairs(models);
    if (!detected.length) return [];

    // Build label map from model configs
    const labelFor = (vp: VidPid): string => {
        const vidHex = vp.vid.toString(16).toUpperCase().padStart(4, "0");
        const pidHex = vp.pid.toString(16).toUpperCase().padStart(4, "0");
        for (const m of models) {
            if (
                (m.VIDWired === vidHex && m.PIDWired === pidHex) ||
                (m.VIDWireless === vidHex && m.PIDWireless === pidHex) ||
                (m.VIDWireless4K8K === vidHex && m.PIDWireless4K8K === pidHex)
            ) {
                return m.ModelEN || m.ModelCN || `${vidHex}:${pidHex}`;
            }
        }
        return `${vidHex}:${pidHex}`;
    };

    // Deduplicate by VID:PID so user sees one entry per detected pair
    const uniq = new Map<string, VidPid>();
    for (const p of detected) uniq.set(`${p.vid}:${p.pid}`, p);

    return Array.from(uniq.values()).map((p) => {
        const vidHex = p.vid.toString(16).toUpperCase().padStart(4, "0");
        const pidHex = p.pid.toString(16).toUpperCase().padStart(4, "0");
        return {
            label: labelFor(p),
            value: `${vidHex}-${pidHex}`,
        };
    });
}

export function derivePairsFromModelKey(modelKey?: string): VidPid[] {
    if (!modelKey) return [];
    return modelKey.split("|").map((token) => {
        const [vidHex, pidHex] = token.split("-");
        return { vid: parseInt(vidHex, 16), pid: parseInt(pidHex, 16) };
    });
}

export function collectPairsFromModels(models: MouseModelConfig[]): VidPid[] {
    const pairs = new Set<string>();
    const addPair = (vidHex?: string, pidHex?: string) => {
        if (!vidHex || !pidHex) return;
        pairs.add(`${vidHex}-${pidHex}`.toLowerCase());
    };
    for (const e of models) {
        addPair(e.VIDWired, e.PIDWired);
        addPair(e.VIDWireless, e.PIDWireless);
        addPair(e.VIDWireless4K8K, e.PIDWireless4K8K);
    }
    return Array.from(pairs).map((key) => {
        const [vidHex, pidHex] = key.split("-");
        return { vid: parseInt(vidHex, 16), pid: parseInt(pidHex, 16) };
    });
}

export function loadPairsFrom(
    models: MouseModelConfig[],
    modelKey?: string
): VidPid[] {
    const explicit = derivePairsFromModelKey(modelKey);
    if (explicit.length) return explicit;
    return collectPairsFromModels(models);
}

function ensureHidLoaded(): void {
    if (!HID) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        HID = requireNative("node-hid");
    }
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

export function parseBatteryStateFromResponse(
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
    } catch {}

    return { isCharging: false, percentage: 0 };
}

function sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // busy wait
    }
}

export function getDetectedPairs(models: MouseModelConfig[]): VidPid[] {
    ensureHidLoaded();
    const all = HID.devices();
    const supported = collectPairsFromModels(models);
    const supportedSet = new Set(supported.map((p) => `${p.vid}:${p.pid}`));
    // Only consider the SET_REPORT interface for detection, fall back to any if none
    const matches = all.filter((d: any) =>
        supportedSet.has(`${d.vendorId}:${d.productId}`)
    );
    const detectedPref = matches.filter(
        (d: any) =>
            d.usagePage === SET_REPORT_DEVICE.usagePage &&
            (SET_REPORT_DEVICE.usage === undefined ||
                d.usage === SET_REPORT_DEVICE.usage)
    );
    const detected = detectedPref.length ? detectedPref : matches;
    return detected.map((d: any) => ({ vid: d.vendorId, pid: d.productId }));
}

export function computeTitle(percentage?: number): string {
    return typeof percentage === "number" && percentage > 0
        ? `${percentage}%`
        : "--%";
}

export function getIconSvg(
    icons: any,
    iconUnknown: string,
    iconColor: string,
    percentage?: number,
    isCharging?: boolean
): string {
    if (!percentage || typeof percentage !== "number") {
        return iconUnknown.replace("{{COLOR}}", iconColor);
    }
    let icon = icons.low;
    if (percentage > 90) icon = icons.full;
    else if (percentage > 80) icon = icons[90];
    else if (percentage > 70) icon = icons[80];
    else if (percentage > 50) icon = icons[60];
    else if (percentage > 40) icon = icons[50];
    else if (percentage > 20) icon = icons[30];
    else if (percentage > 10) icon = icons[20];

    const svg = isCharging ? icon.charging : icon.default;
    return svg.replace("{{COLOR}}", iconColor);
}

export class MouseHidManager {
    private models: MouseModelConfig[];
    private modelKey: string;
    private setReportDevice: nHID | null = null;
    private readFileDevice: nHID | null = null;

    private onConnectionChange: (isConnected: boolean) => void = () => {};

    constructor(models: MouseModelConfig[], modelKey: string) {
        this.models = models;
        this.modelKey = modelKey;
        this.tryOpenDevices();
    }

    get currentModelKey(): string {
        return this.modelKey;
    }

    setOnConnectionChange(callback: (isConnected: boolean) => void): void {
        this.onConnectionChange = callback;
    }

    private tryOpenDevices(): void {
        ensureHidLoaded();
        const pairs = loadPairsFrom(this.models, this.modelKey);
        if (!pairs.length) return;
        const all = HID.devices();
        const supportedSet = new Set(pairs.map((p) => `${p.vid}:${p.pid}`));
        const matches = all.filter((d: any) =>
            supportedSet.has(`${d.vendorId}:${d.productId}`)
        );
        const readFileCandidates = matches.filter(
            (d: any) =>
                d.usagePage === READ_FILE_DEVICE.usagePage &&
                d.usage === READ_FILE_DEVICE.usage
        );
        const setReportCandidates = matches.filter(
            (d: any) =>
                d.usagePage === SET_REPORT_DEVICE.usagePage &&
                d.usage === SET_REPORT_DEVICE.usage
        );
        if (readFileCandidates.length !== 1) {
            throw new Error(
                `Expected 1 device, got ${readFileCandidates.length}`
            );
        }
        if (setReportCandidates.length !== 1) {
            throw new Error(
                `Expected 1 device, got ${setReportCandidates.length}`
            );
        }
        this.readFileDevice = openDeviceByPath(readFileCandidates[0].path);
        this.setReportDevice = openDeviceByPath(setReportCandidates[0].path);

        if (!this.readFileDevice || !this.setReportDevice) {
            throw new Error("Failed to open devices");
        }

        this.readFileDevice.on("data", this.handleDeviceConnectionChange);
    }

    closeAll(): void {
        this.readFileDevice?.removeAllListeners();
        this.setReportDevice?.close();
        this.readFileDevice?.close();
        this.setReportDevice = null;
        this.readFileDevice = null;
    }

    readBattery(): { isCharging: boolean; percentage: number } | null {


        if (!this.setReportDevice) {
          return {
            isCharging: false,
            percentage: 50,
          }
        }

        ensureHidLoaded();
        if (!this.setReportDevice) {
            throw new Error("No set report device found");
        }
        const state = this.tryReadBatteryWithDevice(this.setReportDevice);
        if (state && state.percentage > 0) return state;
        this.setReportDevice.close();
        this.setReportDevice = null;
        return null;
    }

    private tryReadBatteryWithDevice(
        device: nHID
    ): { isCharging: boolean; percentage: number } | null {
        try {
            for (const reportId of FEATURE_REPORT_IDS) {
                const request = buildBatteryRequestBuffer(reportId);
                try {
                    device.sendFeatureReport(request);
                } catch {
                    continue;
                }
                for (const delayMs of INITIAL_DELAYS_MS) {
                    sleepSync(delayMs);
                    for (const readLen of FEATURE_REPORT_LENGTHS) {
                        let response: number[] | undefined;
                        try {
                            response = device.getFeatureReport(
                                reportId,
                                readLen
                            );
                        } catch {
                            continue;
                        }
                        const state = parseBatteryStateFromResponse(
                            Buffer.from(response)
                        );
                        if (state.percentage > 0) return state;
                    }
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    private handleDeviceConnectionChange(data: number[]) {
        if (data[1] !== 6) return;
        const isConnected = data[2] === 1;
        this.onConnectionChange(isConnected);
    }
}
