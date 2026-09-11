import type { FunctionSummaryID, SummaryCall, TermID } from './function_summary';
import type { CallInputs } from './instantiate';

export type CallApplication = {
	readonly callee: FunctionSummaryID;
	readonly callable: TermID;
	readonly targetFrame: number;
};

/** One site in one analysis context, independent of target-frame interning. */
export class SemanticCallContext {
	private readonly targets: CallApplication[] = [];

	public constructor(
		public readonly call: SummaryCall,
		public readonly inputs: CallInputs,
		/** 0: module; negative: body projection; positive: instantiated analysis frame. */
		public readonly ownerFrame: number,
	) {}

	public get applications(): readonly CallApplication[] { return this.targets; }

	public addApplication(callee: FunctionSummaryID, callable: TermID, targetFrame: number): void {
		for (const target of this.targets) {
			if (target.callee === callee && target.callable === callable && target.targetFrame === targetFrame) return;
		}
		this.targets.push({ callee, callable, targetFrame });
	}
}
