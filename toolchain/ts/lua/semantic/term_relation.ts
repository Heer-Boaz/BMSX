import type { TermID } from './function_summary';

/** Monotone forward value relation. Links are retained, one-based indices. */
export class TermRelation {
	private readonly firstByOwner: number[] = [];
	private readonly lastByOwner: number[] = [];
	private readonly targets: TermID[] = [];
	private readonly nextByOwner: number[] = [];

	public add(owner: TermID, target: TermID): boolean {
		for (let link = this.first(owner); link !== 0; link = this.next(link)) {
			if (this.target(link) === target) return false;
		}
		const index = this.targets.length;
		this.targets.push(target);
		this.nextByOwner.push(0);
		const tail = this.lastByOwner[owner] || 0;
		if (tail === 0) {
			this.firstByOwner[owner] = index + 1;
		} else {
			this.nextByOwner[tail - 1] = index + 1;
		}
		this.lastByOwner[owner] = index + 1;
		return true;
	}

	public first(owner: TermID): number {
		return this.firstByOwner[owner] || 0;
	}

	public next(link: number): number {
		return this.nextByOwner[link - 1];
	}

	public target(link: number): TermID {
		return this.targets[link - 1];
	}

	public get count(): number {
		return this.targets.length;
	}
}

/** Storage/prototype relations additionally need the inverse location index. */
export class BidirectionalTermRelation extends TermRelation {
	private readonly firstByTarget: number[] = [];
	private readonly lastByTarget: number[] = [];
	private readonly owners: TermID[] = [];
	private readonly nextByTarget: number[] = [];

	public override add(owner: TermID, target: TermID): boolean {
		if (!super.add(owner, target)) return false;
		const index = this.owners.length;
		this.owners.push(owner);
		this.nextByTarget.push(0);
		const tail = this.lastByTarget[target] || 0;
		if (tail === 0) {
			this.firstByTarget[target] = index + 1;
		} else {
			this.nextByTarget[tail - 1] = index + 1;
		}
		this.lastByTarget[target] = index + 1;
		return true;
	}

	public firstReverse(target: TermID): number {
		return this.firstByTarget[target] || 0;
	}

	public nextReverse(link: number): number {
		return this.nextByTarget[link - 1];
	}

	public owner(link: number): TermID {
		return this.owners[link - 1];
	}
}
