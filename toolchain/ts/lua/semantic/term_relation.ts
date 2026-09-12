import type { TermID } from './function_summary';
import { SemanticDependencyIndex, type SemanticQueryDependencies } from './query_dependencies';

/** Monotone term-keyed relation; targets are term IDs or retained fact-row IDs. */
export class TermRelation<Target extends number = TermID> {
	private readonly forwardDependencies: SemanticDependencyIndex;
	private readonly extentDependency: SemanticDependencyIndex;
	private emptyDependency: SemanticDependencyIndex | undefined;
	private readonly firstByOwner: number[] = [];
	private readonly lastByOwner: number[] = [];
	private readonly targets: Target[] = [];
	private readonly nextByOwner: number[] = [];

	constructor(private readonly dependencies: SemanticQueryDependencies) {
		this.forwardDependencies = new SemanticDependencyIndex(dependencies);
		this.extentDependency = new SemanticDependencyIndex(dependencies);
	}

	public add(owner: TermID, target: Target): boolean {
		for (let link = this.firstByOwner[owner] || 0; link !== 0; link = this.next(link)) {
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
		this.forwardDependencies.changed(owner);
		this.extentDependency.changed(0);
		if (index === 0) this.emptyDependency?.changed(0);
		return true;
	}

	public first(owner: TermID): number {
		this.forwardDependencies.read(owner);
		return this.firstByOwner[owner] || 0;
	}

	public next(link: number): number {
		return this.nextByOwner[link - 1];
	}

	public target(link: number): Target {
		return this.targets[link - 1];
	}

	public get count(): number {
		this.extentDependency.read(0);
		return this.targets.length;
	}

	/** A monotone relation stops being empty once; its extent can keep growing. */
	public get empty(): boolean {
		if (this.targets.length !== 0) return false;
		if (this.emptyDependency === undefined) this.emptyDependency = new SemanticDependencyIndex(this.dependencies);
		this.emptyDependency.read(0);
		return true;
	}
}

/** Storage/prototype relations additionally need the inverse location index. */
export class BidirectionalTermRelation extends TermRelation {
	private readonly reverseDependencies: SemanticDependencyIndex;
	private readonly firstByTarget: number[] = [];
	private readonly lastByTarget: number[] = [];
	private readonly owners: TermID[] = [];
	private readonly nextByTarget: number[] = [];

	constructor(dependencies: SemanticQueryDependencies) {
		super(dependencies);
		this.reverseDependencies = new SemanticDependencyIndex(dependencies);
	}

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
		this.reverseDependencies.changed(target);
		return true;
	}

	public firstReverse(target: TermID): number {
		this.reverseDependencies.read(target);
		return this.firstByTarget[target] || 0;
	}

	public nextReverse(link: number): number {
		return this.nextByTarget[link - 1];
	}

	public owner(link: number): TermID {
		return this.owners[link - 1];
	}
}
