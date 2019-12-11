// import { Model } from "../src/gamemodel";
import { Constants as CS, BaseModel, BStopwatch } from "./engine";

export class Savegame {
	public Model: any;
	public Timestamp: Date;
	public Slot: number;
	public RegisteredWatches: BStopwatch[];
	// public MusicBeingPlayed: AudioId;
}

export namespace GameSaver {
	export function saveGame(m: BaseModel, slot: number): void {
		console.warn("Not implemented yet :(");
	}

	export function GetCheckpoint(m: BaseModel): Savegame {
		saveGame(m, CS.SaveSlotCheckpoint);
		return LoadGame(CS.SaveSlotCheckpoint);
	}
}

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

export function GetCheckpoint(m: BaseModel): Savegame {
	GameSaver.saveGame(m, CS.SaveSlotCheckpoint);
	return LoadGame(CS.SaveSlotCheckpoint);
}

export function GetSavepath(slot: number): string {
	return slot !== CS.SaveSlotCheckpoint ? `${CS.SaveGamePath}${slot}` : CS.CheckpointGamePath;
}


// export class GameSaver {
// 	public static SaveGame(m: GameModel, slot: number): void {
// 		let formatter: IFormatter = new BinaryFormatter();
// 		if (!Directory.Exists("./Saves"))
// 			Directory.CreateDirectory("./Saves");
// 		let savepath: string = GameLoader.GetSavepath(slot);
// 		try {
// 			let stream: Stream = new FileStream(savepath, FileMode.Create, FileAccess.Write, FileShare.None)
// 			try {
// 				let sg = __init(new Savegame(), { Model: m, RegisteredWatches: BStopwatchWatches, Timestamp: Date.Now, MusicBeingPlayed: T.S.MusicBeingPlayed, Slot: slot });
// 				formatter.Serialize(stream, sg);
// 				stream.Close();
// 			}
// 			finally {
// 				if (stream != null) stream.Dispose();
// 			}
// 		}
// 		catch (e) {

// 		}

// 	}
// 	public static GetCheckpoint(m: GameModel): Savegame {
// 		SaveGame(m, CS.SaveSlotCheckpoint);
// 		return GameLoader.LoadGame(CS.SaveSlotCheckpoint);
// 	}
// }