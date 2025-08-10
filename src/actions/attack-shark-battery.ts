import { action } from "@elgato/streamdeck";
import attackSharkModels from "../config/attack-shark-mice.json";
import { MouseModelConfig } from "../lib/mouse-shared";
import { MouseBatteryAction } from "../lib/action";

@action({ UUID: "tech.flowei.gaming-mouse-battery.attack-shark" })
export class AttackSharkBatteryAction extends MouseBatteryAction {
    override get models(): MouseModelConfig[] {
        return attackSharkModels as MouseModelConfig[];
    }
}
