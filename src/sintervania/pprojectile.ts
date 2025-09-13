import { Foe } from './foe';
import { Model } from './gamemodel';
import { Sprite, model } from 'bmsx';

export abstract class PlayerProjectile extends Sprite {
	protected foesThatWereHit: Foe[];
	constructor() {
		super();
		this.foesThatWereHit = new Array<Foe>();
	}

	public checkAndInvokeHit(): boolean {
		let enemyWasHit: boolean = false;
		(model as Model).foes.filter(f => !f.disposeFlag && f.hittable && !this.foesThatWereHit.includes(f) && this.objectCollide(f)).forEach(f => {
			this.foesThatWereHit.push(f);
			f.handleHit(this, 1);
			enemyWasHit = true;
		});
		return enemyWasHit;
	}
}
