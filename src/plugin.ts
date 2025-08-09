import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { AttackSharkBatteryAction } from "./actions/attack-shark-battery";
import { WlMouseBatteryAction } from "./actions/wl-mouse-battery";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register actions
streamDeck.actions.registerAction(new AttackSharkBatteryAction());
streamDeck.actions.registerAction(new WlMouseBatteryAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();