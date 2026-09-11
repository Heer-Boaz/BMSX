import { SemanticQueryEvaluation, type SemanticQueryDependencies } from './query_dependencies';

/** Changed inputs schedule their query; publication never evaluates synchronously. */
export class SemanticQueryWorklist {
	public readonly evaluation: SemanticQueryEvaluation;
	private readonly pending: number[] = [];
	private readonly queued: boolean[] = [];
	private head = 0;

	constructor(dependencies: SemanticQueryDependencies) {
		this.evaluation = new SemanticQueryEvaluation(dependencies, key => this.add(key));
	}

	public add(key: number): void {
		if (this.queued[key]) return;
		this.queued[key] = true;
		this.pending.push(key);
	}

	public get pendingCount(): number {
		return this.pending.length - this.head;
	}

	public take(): number {
		const key = this.pending[this.head++];
		this.queued[key] = false;
		if (this.head === this.pending.length) {
			this.pending.length = 0;
			this.head = 0;
		}
		return key;
	}
}
