import { createRequire } from "node:module";

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

export type DataSourceItem = { label?: string; value: string } | { label?: string; children: Array<{ label?: string; value: string }> };

export function buildModelItemsFromConfig(models: MouseModelConfig[]): DataSourceItem[] {
  return models.map((m) => {
    const keys: string[] = [];
    if (m.VIDWired && m.PIDWired) keys.push(`${m.VIDWired}-${m.PIDWired}`);
    if (m.VIDWireless && m.PIDWireless) keys.push(`${m.VIDWireless}-${m.PIDWireless}`);
    if (m.VIDWireless4K8K && m.PIDWireless4K8K) keys.push(`${m.VIDWireless4K8K}-${m.PIDWireless4K8K}`);
    return { label: m.ModelEN || m.ModelCN || "Unknown", value: keys.join("|") };
  });
}

export function buildDetectedItemsFromModels(models: MouseModelConfig[]): DataSourceItem[] {
  const detected = getDetectedPairs(models);
  if (!detected.length) return [];

  // Build label map from model configs
  const labelFor = (vp: VidPid): string => {
    const vidHex = vp.vid.toString(16).toUpperCase().padStart(4, "0");
    const pidHex = vp.pid.toString(16).toUpperCase().padStart(4, "0");
    for (const m of models) {
      if ((m.VIDWired === vidHex && m.PIDWired === pidHex) ||
          (m.VIDWireless === vidHex && m.PIDWireless === pidHex) ||
          (m.VIDWireless4K8K === vidHex && m.PIDWireless4K8K === pidHex)) {
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

export function loadPairsFrom(models: MouseModelConfig[], modelKey?: string): VidPid[] {
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

const FEATURE_REPORT_IDS = [0, 4];
const FEATURE_REPORT_LENGTHS = [64, 65, 128];
const INITIAL_DELAYS_MS = [120, 250, 400];

function buildBatteryRequestBuffer(reportId: number): Buffer {
  const totalLen = 1 + 64;
  const buf = Buffer.alloc(totalLen, 0);
  buf[0] = reportId;
  buf[1 + 2] = 2;
  buf[1 + 3] = 2;
  buf[1 + 5] = 131;
  return buf;
}

export function parseBatteryStateFromResponse(responseBuffer: Buffer | Uint8Array | undefined | null): { isCharging: boolean; percentage: number } {
  if (!responseBuffer || (responseBuffer as any).length === 0) return { isCharging: false, percentage: 0 };
  const bytes = Uint8Array.from(responseBuffer as Uint8Array);

  try {
    if (bytes.length >= 9 && bytes[1] === 0xa1 && bytes[4] === 2 && bytes[6] === 131) {
      const isCharging = bytes[7] === 1;
      const soc = bytes[8];
      const value = Number(soc);
      return { isCharging, percentage: Number.isFinite(value) ? Math.round(value) : 0 };
    }

    if (bytes.length >= 8 && bytes[0] === 0xa1 && bytes[3] === 2 && bytes[5] === 131) {
      const isCharging = bytes[6] === 1;
      const soc = bytes[7];
      const value = Number(soc);
      return { isCharging, percentage: Number.isFinite(value) ? Math.round(value) : 0 };
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

function tryReadBatteryOnce(deviceInfo: any): { isCharging: boolean; percentage: number } | null {
  const device = openDeviceByPath(deviceInfo.path);
  if (!device) return null;

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
          let response: Buffer | undefined;
          try {
            response = device.getFeatureReport(reportId, readLen);
          } catch {
            continue;
          }

          const { isCharging, percentage } = parseBatteryStateFromResponse(response);
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
    } catch {}
  }
}

export function readBatteryStateForPairs(pairs: VidPid[]): { isCharging: boolean; percentage: number } | null {
  ensureHidLoaded();
  const all = HID.devices();
  const supportedSet = new Set(pairs.map((p) => `${p.vid}:${p.pid}`));
  const candidates = all.filter((d: any) => supportedSet.has(`${d.vendorId}:${d.productId}`));
  for (const info of candidates) {
    const state = tryReadBatteryOnce(info);
    if (state && typeof state.percentage === "number" && state.percentage > 0) return state;
  }
  return null;
}

export function readBatteryStateFromModels(models: MouseModelConfig[], modelKey?: string): { isCharging: boolean; percentage: number } | null {
  const pairs = loadPairsFrom(models, modelKey);
  if (!pairs.length) return null;
  return readBatteryStateForPairs(pairs);
}

export function getDetectedPairs(models: MouseModelConfig[]): VidPid[] {
  ensureHidLoaded();
  const all = HID.devices();
  const supported = collectPairsFromModels(models);
  const supportedSet = new Set(supported.map((p) => `${p.vid}:${p.pid}`));
  const detected = all.filter((d: any) => supportedSet.has(`${d.vendorId}:${d.productId}`));
  return detected.map((d: any) => ({ vid: d.vendorId, pid: d.productId }));
}

export function computeTitle(percentage?: number): string {
  return typeof percentage === "number" && percentage > 0 ? `${percentage}%` : "--%";
}

export function getIconSvg(icons: any, iconUnknown: string, iconColor: string, percentage?: number, isCharging?: boolean): string {
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


