import { GameModel } from "../src/sintervaniamodel";
import { Constants as CS } from "./constants";
import { Savegame } from "./savegame";
import { LoadGame } from "./gamestateloader";

export namespace GameSaver {
	export function saveGame(m: GameModel, slot: number): void {
		throw "Not implemented yet :(";
	}

	export function GetCheckpoint(m: GameModel): Savegame {
		saveGame(m, CS.SaveSlotCheckpoint);
		return LoadGame(CS.SaveSlotCheckpoint);
	}
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