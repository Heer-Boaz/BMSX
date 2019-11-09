import { ISong } from "./song";
import { BStopwatch } from "./btimer";
import { Model } from "./model";

/*[Serializable]*/
export class Savegame {
	public Model: any;
	public Timestamp: Date;
	public Slot: number;
	public RegisteredWatches: BStopwatch[];
	public MusicBeingPlayed: ISong;
}