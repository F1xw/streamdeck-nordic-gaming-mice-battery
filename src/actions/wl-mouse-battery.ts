import { action } from "@elgato/streamdeck";
import wlMouseModels from "../config/wl-mouse-mice.json";
import { MouseModelConfig } from "../lib/mouse-shared";
import { MouseBatteryAction } from "../lib/action";

@action({ UUID: "tech.flowei.gaming-mouse-battery.wl-mouse" })
export class WlMouseBatteryAction extends MouseBatteryAction {
    override get models(): MouseModelConfig[] {
        return wlMouseModels as MouseModelConfig[];
    }
}
