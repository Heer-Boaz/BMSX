import { AudioId } from "../src/resourceids";
import { BStopwatch } from "./btimer";

/*[Serializable]*/
export class Savegame {
	public Model: any;
	public Timestamp: Date;
	public Slot: number;
	public RegisteredWatches: BStopwatch[];
	public MusicBeingPlayed: AudioId;
}