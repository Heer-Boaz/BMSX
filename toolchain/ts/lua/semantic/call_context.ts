import type { FunctionSummaryID, SummaryCall, TermID } from './function_summary';
import type { CallInputs } from './instantiate';

export type CallApplication = {
	readonly callee: FunctionSummaryID;
	readonly callable: TermID;
	readonly targetFrame: number;
};

export type CallApplicationEdge = {
	readonly context: SemanticCallContext;
	readonly application: CallApplication;
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

	public addApplication(callee: FunctionSummaryID, callable: TermID, targetFrame: number): CallApplication | undefined {
		for (const target of this.targets) {
			if (target.callee === callee && target.callable === callable && target.targetFrame === targetFrame) return;
		}
		const application = { callee, callable, targetFrame };
		this.targets.push(application);
		return application;
	}
}
