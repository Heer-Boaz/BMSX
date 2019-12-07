import { Model } from "../src/gamemodel";
import { Constants as CS } from "./constants";
import { Savegame } from "./savegame";
import { GameSaver } from './gamesaver';

export function LoadGame(slot: number): Savegame {
	// 	IFormatter formatter = new BinaryFormatter();

	// 	Savegame result = null;
	// 	try {
	// 		string savepath = GetSavepath(slot);
	// 		if (!File.Exists(savepath)) return null; // Used for when loading a checkpoint-file that does not exist

	// 		using(Stream stream = new FileStream(savepath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
	// 			result = (Savegame)formatter.Deserialize(stream);
	// 			stream.Close();
	// 		}
	// 	}
	// 	catch (Exception e) {
	// 		#if DEBUG
	// 				throw e;
	// 		#else
	// 		// TODO: DO SOMETHING!!!
	// 		#endif
	// 	}
	// 	return result;
	console.warn("Not implemented yet :(");
	// throw "Not implemented yet :(";
	return null;
}

export function SlotExists(slot: number): boolean {
	let file = GetSavepath(slot);
	console.warn("Not implemented yet :(");

	return false;
	// throw "Not implemented yet :(";
	// 	return Directory.Exists("./Saves") && File.Exists(file);
}

export function GetCheckpoint(m: Model): Savegame {
	GameSaver.saveGame(m, CS.SaveSlotCheckpoint);
	return LoadGame(CS.SaveSlotCheckpoint);
}

export function GetSavepath(slot: number): string {
	return slot !== CS.SaveSlotCheckpoint ? `${CS.SaveGamePath}${slot}` : CS.CheckpointGamePath;
}
