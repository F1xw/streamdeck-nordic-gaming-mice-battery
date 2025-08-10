import streamDeck, {
    action,
    DidReceiveSettingsEvent,
    KeyDownEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import { blank, icons, iconUnknown } from "../assets/battery-svg";
import {
    MouseModelConfig,
    buildDetectedItemsFromModels,
    readBatteryStateFromModels,
    computeTitle,
    getIconSvg,
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

    get models(): MouseModelConfig[] {
        throw new Error("Not implemented");
    }

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        await this.renderUnknown(ev);
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
            const items = buildDetectedItemsFromModels(this.models);
            streamDeck.ui.current?.sendToPropertyInspector({
                event: "getDetectedModels",
                items,
            });
        }
    }

    private async renderKey(ev: any, percentage: number, isCharging: boolean) {
        const showIcon = ev.payload.settings.iconMode ?? false;
        const title = computeTitle(percentage);
        if (!showIcon) {
            await ev.action.setTitle(title);
            await ev.action.setImage(blank);
        } else {
            await ev.action.setTitle("");
            const svg = getIconSvg(
                icons,
                iconUnknown,
                ev.payload.settings.iconColor,
                percentage,
                isCharging
            );
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(svg)}`
            );
        }
    }

    private async renderUnknown(ev: any) {
        const showIcon = ev.payload.settings.iconMode ?? false;
        if (showIcon) {
            await ev.action.setImage(
                `data:image/svg+xml,${encodeURIComponent(
                    iconUnknown.replace(
                        "{{COLOR}}",
                        ev.payload.settings.iconColor
                    )
                )}`
            );
            await ev.action.setTitle("");
        } else {
            await ev.action.setTitle("--%");
            await ev.action.setImage(blank);
        }
    }

    private async updateState(ev: WillAppearEvent<Settings>): Promise<void> {
        try {
            const { isCharging, percentage } =
                readBatteryStateFromModels(
                    this.models,
                    ev.payload.settings.modelKey
                ) ?? {};
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
}
