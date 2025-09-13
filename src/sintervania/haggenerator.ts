import { Hag } from "./hag";
import { WorldObject, model } from 'bmsx';
import { Direction, Point } from "bmsx/common";
import { mdef } from 'bmsx';
import { belmont } from "./gamemodel";
import { GameConstants } from "./gameconstants";

export class HagGenerator extends mdef implements WorldObject {
	public disposeFlag: boolean;
	public id: string;
	public pos: Point;
	public disposeOnSwitchRoom?: boolean;

	constructor() {
		super();
		this.disposeOnSwitchRoom = true;
		let state0 = this.add(0);
		state0.ticks2move = 100;
		state0.onrun = (s) => ++s.nudges;
		state0.onnext = (s) => {
			// Poop hags based on where Belmont is
			let spawnPoint = { x: 0, y: this.y };
			if (belmont.x <= GameConstants.ViewportWidth / 2) {
				spawnPoint.x = GameConstants.ViewportWidth - Hag.HagSize.y;
				new Hag('left').spawn(spawnPoint);
			}
			else {
				spawnPoint.x = 0;
				new Hag('right').spawn(spawnPoint);
			}
		};
	}

	spawn(pos?: Point): HagGenerator {
		world.spawn(this, pos);
		return this;
	}

	run(): void {
		this.run();
	}

	onspawn(spawningPos?: Point): void {
		if (spawningPos) this.pos = spawningPos;
	}
}
