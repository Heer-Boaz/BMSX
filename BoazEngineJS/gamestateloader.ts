import { GameModel } from "../src/sintervaniamodel";
import { Constants as CS } from "./constants";
import { Savegame } from "./savegame";
import { saveGame } from "./gamesaver";

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
	throw "Not implemented yet :(";
}

export function SlotExists(slot: number): boolean {
	let file = GetSavepath(slot);
	throw "Not implemented yet :(";
	// 	return Directory.Exists("./Saves") && File.Exists(file);
}

export function GetCheckpoint(m: GameModel): Savegame {
	saveGame(m, CS.SaveSlotCheckpoint);
	return LoadGame(CS.SaveSlotCheckpoint);
}

export function GetSavepath(slot: number): string {
	return slot !== CS.SaveSlotCheckpoint ? `${CS.SaveGamePath}${slot}` : CS.CheckpointGamePath;
}
