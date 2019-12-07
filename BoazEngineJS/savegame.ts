import { BStopwatch } from "./btimer";
import { BaseModel } from "./model";
import { Song } from "./soundmaster";

/*[Serializable]*/
export class Savegame {
	public Model: any;
	public Timestamp: Date;
	public Slot: number;
	public RegisteredWatches: BStopwatch[];
	public MusicBeingPlayed: Song;
}