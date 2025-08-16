import streamDeck, {
    action,
    DidReceiveSettingsEvent,
    KeyDownEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import { blank, icons, iconUnknown, settingsIcon } from "../assets/battery-svg";
import {
    MouseModelConfig,
    MouseHidManager,
    computeTitle,
    getIconSvg,
    getDetectedPairs,
    buildDetectedItemsFromModels,
} from "../lib/mouse-shared";

type Settings = {
    iconMode?: boolean; // true = icon, false = text
    iconColor: string;
    modelKey?: string; // one or more "VID-PID" tokens joined by '|'
};

export abstract class MouseBatteryAction extends SingletonAction<Settings> {
    private refreshTimer: NodeJS.Timeout | null = null;
    private lastBatteryState: {
        percentage: number;
        isCharging: boolean;
    } | null = null;
    private hid: MouseHidManager | null = null;
    private currentSettings: Partial<Settings> | null = null;

    get models(): MouseModelConfig[] {
        throw new Error("Not implemented");
    }

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        this.currentSettings = ev.payload.settings;
        if (!(await this.checkConfig(ev))) {
            return;
        }
        await this.renderUnknown(ev);
        try {
            this.hid = new MouseHidManager(
                this.models,
                ev.payload.settings.modelKey as string
            );
        } catch {
            await this.renderUnknown(ev);
            await ev.action.showAlert();
            return;
        }
        this.hid.setOnConnectionChange((isConnected) => {
            if (isConnected) {
                this.updateState(ev);
            } else {
                this.renderUnknown(ev);
            }
        });
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
        if (this.hid) {
            this.hid.closeAll();
            this.hid = null;
        }
    }

    override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
        if (
            !(await this.checkConfig(
                ev as unknown as WillAppearEvent<Settings>
            ))
        ) {
            return;
        }
        await this.updateState(ev as unknown as WillAppearEvent<Settings>);
        if (ev.payload.settings.iconMode) {
            const title = computeTitle(this.lastBatteryState?.percentage);
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(
                    svgText(title, this.currentSettings?.iconColor ?? "#FFFFFF")
                )}`
            );
            setTimeout(() => {
                void this.updateState(
                    ev as unknown as WillAppearEvent<Settings>
                );
            }, 5000);
        }
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<Settings>
    ): Promise<void> {
        this.currentSettings = ev.payload.settings;
        if (
            !(await this.checkConfig(
                ev as unknown as WillAppearEvent<Settings>
            ))
        ) {
            return;
        }
        if (
            ev.payload.settings.modelKey !== this.hid?.currentModelKey &&
            ev.payload.settings.modelKey
        ) {
            this.hid?.closeAll();
            try {
                this.hid = new MouseHidManager(
                    this.models,
                    ev.payload.settings.modelKey
                );
            } catch (error) {
                await this.renderUnknown(ev);
                await ev.action.showAlert();
                return;
            }
            this.hid.setOnConnectionChange((isConnected) => {
                if (isConnected) {
                    void this.updateState(
                        ev as unknown as WillAppearEvent<Settings>
                    );
                } else {
                    void this.renderUnknown(
                        ev as unknown as WillAppearEvent<Settings>
                    );
                }
            });
        }

        if (this.lastBatteryState) {
            await this.renderKey(
                ev as unknown as WillAppearEvent<Settings>,
                this.lastBatteryState.percentage,
                this.lastBatteryState.isCharging
            );
            return;
        }
    }

    override async onSendToPlugin(
        ev: import("@elgato/streamdeck").SendToPluginEvent<any, Settings>
    ): Promise<void> {
        const { event } = ev.payload || {};
        if (event === "getDetectedModels") {
            const data = buildDetectedItemsFromModels(this.models);
            streamDeck.ui.current?.sendToPropertyInspector({
                event: "getDetectedModels",
                items: [
                    {
                        label: "Unknown",
                        value: "",
                    },
                    ...data,
                ],
            });
        }
    }

    private async renderKey(ev: any, percentage: number, isCharging: boolean) {
        const showIcon = this.currentSettings?.iconMode ?? false;
        const title = computeTitle(percentage);
        if (!showIcon) {
            await ev.action.setTitle(title);
            await ev.action.setImage(blank);
        } else {
            await ev.action.setTitle("");
            const svg = getIconSvg(
                icons,
                iconUnknown,
                this.currentSettings?.iconColor ?? "#FFFFFF",
                percentage,
                isCharging
            );
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(svg)}`
            );
        }
    }

    private async renderUnknown(ev: any) {
        const showIcon = this.currentSettings?.iconMode ?? false;
        if (showIcon) {
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(
                    iconUnknown.replace(
                        "{{COLOR}}",
                        this.currentSettings?.iconColor ?? "#FFFFFF"
                    )
                )}`
            );
            await ev.action.setTitle("");
        } else {
            await ev.action.setTitle("--%");
            await ev.action.setImage(blank);
        }
    }

    private async renderSettings(ev: any) {
        await ev.action.setTitle("");
        await ev.action.setImage(
            `data:image/svg+xml,${encodeURIComponent(
                settingsIcon.replace(
                    "{{COLOR}}",
                    this.currentSettings?.iconColor ?? "#FFFFFF"
                )
            )}`
        );
    }

    private async updateState(ev: WillAppearEvent<Settings>): Promise<void> {
        try {
            if (!this.hid) {
                await this.renderUnknown(ev);
                await ev.action.showAlert();
                return;
            }
            const { isCharging, percentage } = this.hid.readBattery() ?? {};
            if (
                typeof isCharging !== "boolean" ||
                typeof percentage !== "number"
            ) {
                await this.renderUnknown(ev);
                this.lastBatteryState = null;
            } else {
                await this.renderKey(ev, percentage, isCharging);
                this.lastBatteryState = { percentage, isCharging };
            }
        } catch {
            await this.renderUnknown(ev);
            this.lastBatteryState = null;
        }
    }

    private async checkConfig(ev: WillAppearEvent<Settings>): Promise<boolean> {
        const { modelKey } = this.currentSettings ?? {};
        if (!modelKey) {
            await this.renderSettings(ev);
            return false;
        }
        return true;
    }
}

const svgText = (text: string, color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="${color}" viewBox="-6 -6 36 36"><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-size="12" font-family="Arial, sans-serif">${text}</text></svg>`;
