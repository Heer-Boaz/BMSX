import type { FunctionSummaryID, SemanticNameID } from './function_summary';

export type EffectRelevance = {
	readonly summaries: readonly boolean[];
	readonly names: readonly boolean[];
};

/** Immutable candidate graph, not a call graph or evidence that a body executes. */
export class SemanticEffectIndex {
	private readonly writers = new Map<SemanticNameID, FunctionSummaryID[]>();
	private readonly callers: FunctionSummaryID[][] = [];
	private readonly namedCallers = new Map<SemanticNameID, FunctionSummaryID[]>();

	constructor(private readonly functionNames: readonly (SemanticNameID | undefined)[]) {}

	public addWriter(name: SemanticNameID, summary: FunctionSummaryID): void {
		let writers = this.writers.get(name);
		if (!writers) {
			writers = [];
			this.writers.set(name, writers);
		}
		if (!writers.includes(summary)) writers.push(summary);
	}

	public addCaller(callee: FunctionSummaryID, caller: FunctionSummaryID): void {
		let callers = this.callers[callee];
		if (!callers) {
			callers = [];
			this.callers[callee] = callers;
		}
		if (!callers.includes(caller)) callers.push(caller);
	}

	public addNamedCaller(name: SemanticNameID, caller: FunctionSummaryID): void {
		let callers = this.namedCallers.get(name);
		if (!callers) {
			callers = [];
			this.namedCallers.set(name, callers);
		}
		if (!callers.includes(caller)) callers.push(caller);
	}

	public select(name: SemanticNameID): EffectRelevance {
		const summaries: boolean[] = [];
		const names: boolean[] = [];
		const pending: FunctionSummaryID[] = [];
		const writers = this.writers.get(name);
		if (writers) {
			for (const writer of writers) {
				summaries[writer] = true;
				pending.push(writer);
			}
		}
		for (let head = 0; head < pending.length; head += 1) {
			const callee = pending[head];
			const callers = this.callers[callee];
			if (callers) {
				for (const caller of callers) {
					if (summaries[caller]) continue;
					summaries[caller] = true;
					pending.push(caller);
				}
			}
			const functionName = this.functionNames[callee];
			if (functionName === undefined || names[functionName]) continue;
			names[functionName] = true;
			const named = this.namedCallers.get(functionName);
			if (named) {
				for (const caller of named) {
					if (summaries[caller]) continue;
					summaries[caller] = true;
					pending.push(caller);
				}
			}
		}
		return { summaries, names };
	}
}
