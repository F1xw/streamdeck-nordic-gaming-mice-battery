import streamDeck, {
    action,
    DidReceiveSettingsEvent,
    KeyDownEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
    SendToPluginEvent,
} from "@elgato/streamdeck";
import { icons, iconUnknown } from "../assets/battery-svg";
import attackSharkModels from "../config/attack-shark-mice.json";
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

@action({ UUID: "tech.flowei.gaming-mouse-battery.attack-shark" })
export class AttackSharkBatteryAction extends SingletonAction<Settings> {
    private refreshTimer: NodeJS.Timeout | null = null;

    override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
        await ev.action.setImage(
            `data:image/svg+xml,${encodeURIComponent(
                iconUnknown.replace("{{COLOR}}", ev.payload.settings.iconColor)
            )}`
        );
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

    override async onSendToPlugin(
        ev: SendToPluginEvent<any, Settings>
    ): Promise<void> {
        const { event } = ev.payload || {};
        if (event === "getDetectedModels") {
            const items = buildDetectedItemsFromModels(
                attackSharkModels as MouseModelConfig[]
            );
            streamDeck.ui.current?.sendToPropertyInspector({
                event: "getDetectedModels",
                items,
            });
        }
    }

    private async updateState(ev: WillAppearEvent<Settings>): Promise<void> {
        try {
            const { isCharging, percentage } =
                readBatteryStateFromModels(
                    attackSharkModels as MouseModelConfig[],
                    ev.payload.settings.modelKey
                ) ?? {};
            const showIcon = ev.payload.settings.iconMode ?? false;
            const title = computeTitle(percentage);
            // Enforce exclusive modes: icon OR text
            if (!showIcon) {
                await ev.action.setTitle(title);
                await ev.action.setImage(
                    `data:image/svg+xml,${encodeURIComponent(
                        iconUnknown.replace(
                            "{{COLOR}}",
                            ev.payload.settings.iconColor
                        )
                    )}`
                );
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
        } catch {
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
}

// Shared HID and parsing logic moved to ../lib/mouse-shared
