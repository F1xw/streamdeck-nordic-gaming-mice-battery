import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { AttackSharkBatteryAction } from "./actions/attack-shark-battery";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register the Attack Shark battery action.
streamDeck.actions.registerAction(new AttackSharkBatteryAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
