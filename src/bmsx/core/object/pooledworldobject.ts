/**
 * PooledWorldObject
 * Basis voor tijdelijke / vaak gespawnde WorldObjects (particles, decals, hitmarkers, etc.)
 * die via een Pool<T> hergebruikt worden zonder GC-churn en zonder dubbele ids in het world.
 *
 * Gebruik:
 *  - Maak een subclass die een static Pool<T> heeft.
 *  - Bij acquire(): inst.prepareForReuse(); inst.markActive(); inst.reset(...);
 *  - In run(): als effect klaar is -> this.recycle(); (en release naar pool)
 */
import { $ } from '../game';
import { WorldObject } from './worldobject';

export abstract class PooledWorldObject extends WorldObject {
	/** Subclasses geven een reset implementatie voor initialisatie van state. */
	protected abstract reset(...args: any[]): void; // eslint-disable-line @typescript-eslint/no-explicit-any
	/** Subclasses must still implement run/paint like gewone WorldObject lifecycle. */

	/** Markeer object opnieuw als actief na acquire uit pool. */
	public markActive(): void { this.active = true; }

	/** Wordt aangeroepen door pool / effect wanneer levensduur klaar is. */
	public recycle(): void { this.active = false; }

	/** Zorgt dat het object niet nog in de model space hangt voordat we hem opnieuw gebruiken. */
	protected prepareForReuse(): void {
		// Fast-path: directly find the space in which the object currently resides and exile once without disposing
		const sid = $.world.objToSpaceMap.get(this.id);
		if (!sid) return; // not attached to any space
		const sp = $.world.getSpaceOfObject(sid);
		if (sp) sp.despawn(this); // detach zonder dispose zodat allocaties behouden blijven
	}

	/** Helper die subclasses kunnen aanroepen in hun static create(). */
	public prepareAndReset(...args: any[]): void { // eslint-disable-line @typescript-eslint/no-explicit-any
		this.prepareForReuse();
		this.markActive();
		this.reset(...args);
	}
}
