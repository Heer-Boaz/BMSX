import { SemanticDemandIndex } from './demand_index';
import {
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type SummaryAlias,
	type SummaryCall,
	type SummaryWrite,
	type TermID,
	TermKind,
} from './function_summary';
import type { SymbolID } from './model';
import type { CallValueEntry } from './value_graph';

export class TermRelation {
	private readonly firstByOwner: number[] = [];
	private readonly lastByOwner: number[] = [];
	private readonly firstByTarget: number[] = [];
	private readonly lastByTarget: number[] = [];
	private readonly owners: TermID[] = [];
	private readonly targets: TermID[] = [];
	private readonly nextByOwner: number[] = [];
	private readonly nextByTarget: number[] = [];

	public add(owner: TermID, target: TermID): boolean {
		for (let link = this.first(owner); link !== 0; link = this.next(link)) {
			if (this.target(link) === target) {
				return false;
			}
		}
		const index = this.targets.length;
		this.owners.push(owner);
		this.targets.push(target);
		this.nextByOwner.push(0);
		this.nextByTarget.push(0);
		const ownerTail = this.lastByOwner[owner] || 0;
		if (ownerTail === 0) {
			this.firstByOwner[owner] = index + 1;
		} else {
			this.nextByOwner[ownerTail - 1] = index + 1;
		}
		this.lastByOwner[owner] = index + 1;
		const targetTail = this.lastByTarget[target] || 0;
		if (targetTail === 0) {
			this.firstByTarget[target] = index + 1;
		} else {
			this.nextByTarget[targetTail - 1] = index + 1;
		}
		this.lastByTarget[target] = index + 1;
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

	public firstReverse(target: TermID): number {
		return this.firstByTarget[target] || 0;
	}

	public nextReverse(link: number): number {
		return this.nextByTarget[link - 1];
	}

	public owner(link: number): TermID {
		return this.owners[link - 1];
	}

	public get count(): number {
		return this.targets.length;
	}

}

export class WriteSet {
	private readonly firstByBase: number[] = [];
	private readonly lastByBase: number[] = [];
	private readonly firstByName: number[] = [];
	private readonly lastByName: number[] = [];
	private readonly bases: TermID[] = [];
	private readonly names: SemanticNameID[] = [];
	private readonly values: TermID[] = [];
	private readonly declarations: SymbolID[] = [];
	private readonly nextByBase: number[] = [];
	private readonly nextByName: number[] = [];

	public add(write: SummaryWrite): boolean {
		for (let link = this.first(write.base); link !== 0; link = this.next(link)) {
			if (this.name(link) === write.name
				&& this.value(link) === write.value
				&& this.declaration(link) === write.declaration) {
				return false;
			}
		}
		const index = this.values.length;
		this.bases.push(write.base);
		this.names.push(write.name);
		this.values.push(write.value);
		this.declarations.push(write.declaration);
		this.nextByBase.push(0);
		this.nextByName.push(0);
		const tail = this.lastByBase[write.base] || 0;
		if (tail === 0) {
			this.firstByBase[write.base] = index + 1;
		} else {
			this.nextByBase[tail - 1] = index + 1;
		}
		this.lastByBase[write.base] = index + 1;
		const nameTail = this.lastByName[write.name] || 0;
		if (nameTail === 0) {
			this.firstByName[write.name] = index + 1;
		} else {
			this.nextByName[nameTail - 1] = index + 1;
		}
		this.lastByName[write.name] = index + 1;
		return true;
	}

	public first(base: TermID): number {
		return this.firstByBase[base] || 0;
	}

	public next(link: number): number {
		return this.nextByBase[link - 1];
	}

	public firstName(name: SemanticNameID): number {
		return this.firstByName[name] || 0;
	}

	public nextName(link: number): number {
		return this.nextByName[link - 1];
	}

	public base(link: number): TermID {
		return this.bases[link - 1];
	}

	public name(link: number): SemanticNameID {
		return this.names[link - 1];
	}

	public value(link: number): TermID {
		return this.values[link - 1];
	}

	public declaration(link: number): SymbolID {
		return this.declarations[link - 1];
	}
}

export class InstantiationFrames {
	private readonly summaries: FunctionSummaryID[] = [0 as FunctionSummaryID];
	private readonly closures: number[] = [0];
	private readonly callers: number[] = [0];
	private readonly argumentOffsets: number[] = [0];
	private readonly argumentCounts: number[] = [0];
	private readonly arguments: TermID[] = [];
	private readonly framesBySite: Map<CallValueEntry, number[]> = new Map();
	private readonly firstBySummary: number[] = [];
	private readonly lastBySummary: number[] = [];
	private readonly nextBySummary: number[] = [0];

	public intern(
		site: CallValueEntry,
		summary: FunctionSummaryID,
		closure: number,
		caller: number,
		args: readonly TermID[],
	): number {
		let frames = this.framesBySite.get(site);
		if (!frames) {
			frames = [];
			this.framesBySite.set(site, frames);
		}
		for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
			const frame = frames[frameIndex];
			if (this.summaries[frame] !== summary
				|| this.closures[frame] !== closure
				|| this.argumentCounts[frame] !== args.length) {
				continue;
			}
			const offset = this.argumentOffsets[frame];
			let equal = true;
			for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
				if (this.arguments[offset + argumentIndex] !== args[argumentIndex]) {
					equal = false;
					break;
				}
			}
			if (equal) {
				return frame;
			}
		}
		const frame = this.summaries.length;
		const offset = this.arguments.length;
		this.summaries.push(summary);
		this.closures.push(closure);
		this.callers.push(caller);
		this.argumentOffsets.push(offset);
		this.argumentCounts.push(args.length);
		for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
			this.arguments.push(args[argumentIndex]);
		}
		frames.push(frame);
		this.nextBySummary[frame] = 0;
		const summaryTail = this.lastBySummary[summary] || 0;
		if (summaryTail === 0) {
			this.firstBySummary[summary] = frame;
		} else {
			this.nextBySummary[summaryTail] = frame;
		}
		this.lastBySummary[summary] = frame;
		return frame;
	}

	public summary(frame: number): FunctionSummaryID {
		return this.summaries[frame];
	}

	public get count(): number {
		return this.summaries.length - 1;
	}

	public closure(frame: number): number {
		return this.closures[frame];
	}

	public argument(frame: number, index: number): TermID {
		return this.arguments[this.argumentOffsets[frame] + index];
	}

	public first(summary: FunctionSummaryID): number {
		return this.firstBySummary[summary] || 0;
	}

	public next(frame: number): number {
		return this.nextBySummary[frame];
	}

	public findOwnerFrame(frame: number, summary: FunctionSummaryID): number {
		let current = frame;
		while (current !== 0) {
			if (this.summaries[current] === summary) {
				return current;
			}
			current = this.closures[current];
		}
		return 0;
	}

	public findCycleFrame(frame: number, summary: FunctionSummaryID): number {
		let current = frame;
		while (current !== 0) {
			if (this.summaries[current] === summary) {
				return current;
			}
			current = this.callers[current];
		}
		return 0;
	}
}

export type InstantiatedCallSink = (
	call: SummaryCall,
	ownerFrame: number,
) => void;

export class SemanticInstantiationQuery {
	public readonly values = new TermRelation();
	public readonly metatables = new TermRelation();
	public readonly prototypes = new TermRelation();
	public readonly writes = new WriteSet();
	public readonly frames = new InstantiationFrames();
	private readonly instantiatedFrames: boolean[] = [];
	private readonly activeFrames: number[] = [];
	private readonly projectedSummaries: boolean[] = [];
	private readonly demandedNames: boolean[] = [];
	private readonly demandedNameList: SemanticNameID[] = [];
	private readonly effectNames: boolean[] = [];
	private readonly effectNameList: SemanticNameID[] = [];
	private readonly frameArguments: TermID[] = [];
	private readonly prototypeOwnerQueue: TermID[] = [];
	private readonly prototypeTargetQueue: TermID[] = [];
	private prototypeQueueHead = 0;
	private propagatingPrototypes = false;
	private revision = 0;

	constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly demand: SemanticDemandIndex,
		private readonly enqueueCall: InstantiatedCallSink,
	) {
		for (let aliasIndex = 0; aliasIndex < demand.aliases.length; aliasIndex += 1) {
			this.addAlias(demand.aliases[aliasIndex]);
		}
	}

	public getRevision(): number {
		return this.revision;
	}

	public demandName(name: SemanticNameID): boolean {
		if (this.demandedNames[name]) {
			return false;
		}
		this.demandedNames[name] = true;
		this.demandedNameList.push(name);
		const staticWrites = this.demand.staticWrites(name);
		for (let writeIndex = 0; writeIndex < staticWrites.length; writeIndex += 1) {
			const write = staticWrites[writeIndex];
			const owner = this.summaries.terms.summaryOwner(write.value);
			if (owner !== undefined) {
				this.compose(owner);
			}
			this.addWrite(write);
		}
		for (let frameIndex = 0; frameIndex < this.activeFrames.length; frameIndex += 1) {
			this.materializeFrameWrites(this.activeFrames[frameIndex], name);
		}
		return true;
	}

	public demandEffectName(name: SemanticNameID): void {
		this.demandName(name);
		if (this.effectNames[name]) {
			return;
		}
		this.effectNames[name] = true;
		this.effectNameList.push(name);
		for (let frameIndex = 0; frameIndex < this.activeFrames.length; frameIndex += 1) {
			this.materializeFrameEffectCalls(this.activeFrames[frameIndex], name);
		}
	}

	public demandTermEffects(term: TermID): void {
		const terms = this.summaries.terms;
		let current = term;
		for (;;) {
			const kind = terms.kind(current);
			if (kind === TermKind.Member) {
				this.demandEffectName(terms.operand(current) as SemanticNameID);
			}
			if (kind === TermKind.ContextRoot || kind >= TermKind.Member) {
				current = terms.base(current);
				continue;
			}
			return;
		}
	}

	public compose(summaryId: FunctionSummaryID): boolean {
		if (this.projectedSummaries[summaryId]) {
			return false;
		}
		this.projectedSummaries[summaryId] = true;
		const summary = this.summaries.get(summaryId);
		for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
			const alias = summary.aliases[aliasIndex];
			this.addAlias({
				target: this.summaries.projectExternalTerm(alias.target),
				source: this.summaries.projectExternalTerm(alias.source),
				relation: alias.relation,
			});
		}
		for (
			let frame = this.frames.first(summaryId);
			frame !== 0;
			frame = this.frames.next(frame)
		) {
			this.materializeFrameCompositionCalls(frame);
		}
		return true;
	}

	public enqueueSummaryQueries(summary: FunctionSummaryID): void {
		const compositionCalls = this.demand.compositionCalls(summary);
		for (let callIndex = 0; callIndex < compositionCalls.length; callIndex += 1) {
			this.enqueueCall(compositionCalls[callIndex], -summary);
		}
		for (let nameIndex = 0; nameIndex < this.effectNameList.length; nameIndex += 1) {
			const calls = this.demand.callsForEffect(summary, this.effectNameList[nameIndex]);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.enqueueCall(calls[callIndex], -summary);
			}
		}
	}

	public instantiate(
		site: CallValueEntry,
		summaryId: FunctionSummaryID,
		closure: number,
		callerFrame: number,
		args: readonly TermID[],
		result: TermID | undefined,
	): number {
		const summary = this.summaries.get(summaryId);
		const cycleFrame = this.frames.findCycleFrame(callerFrame, summaryId);
		if (cycleFrame !== 0) {
			this.publishReturns(summary.returns, cycleFrame, result);
			return cycleFrame;
		}
		this.frameArguments.length = summary.parameters.length;
		for (let parameterIndex = 0; parameterIndex < summary.parameters.length; parameterIndex += 1) {
			this.frameArguments[parameterIndex] = parameterIndex < args.length
				? args[parameterIndex]
				: this.summaries.terms.unknown();
		}
		const frame = this.frames.intern(site, summaryId, closure, callerFrame, this.frameArguments);
		if (!this.instantiatedFrames[frame]) {
			this.instantiatedFrames[frame] = true;
			this.activeFrames.push(frame);
			for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
				this.addAlias(this.contextualizeAlias(summary.aliases[aliasIndex], frame));
			}
			for (let nameIndex = 0; nameIndex < this.demandedNameList.length; nameIndex += 1) {
				this.materializeFrameWrites(frame, this.demandedNameList[nameIndex]);
			}
			const returnCalls = this.demand.returnCalls(summaryId);
			for (let callIndex = 0; callIndex < returnCalls.length; callIndex += 1) {
				this.enqueueCall(returnCalls[callIndex], frame);
			}
			if (this.projectedSummaries[summaryId]) {
				this.materializeFrameCompositionCalls(frame);
			}
			for (let nameIndex = 0; nameIndex < this.effectNameList.length; nameIndex += 1) {
				this.materializeFrameEffectCalls(frame, this.effectNameList[nameIndex]);
			}
		}
		this.publishReturns(summary.returns, frame, result);
		return frame;
	}

	public contextualize(term: TermID, frame: number): TermID {
		const terms = this.summaries.terms;
		const kind = terms.kind(term);
		switch (kind) {
			case TermKind.Root:
			case TermKind.ContextRoot:
				return term;
			case TermKind.Parameter: {
				const owner = terms.summaryOwner(term) as FunctionSummaryID;
				const ownerFrame = this.frames.findOwnerFrame(frame, owner);
				return ownerFrame === 0
					? term
					: this.frames.argument(ownerFrame, terms.operand(term));
			}
			case TermKind.Local: {
				const owner = terms.summaryOwner(term) as FunctionSummaryID;
				const ownerFrame = this.frames.findOwnerFrame(frame, owner);
				return ownerFrame === 0 ? term : terms.contextRoot(term, ownerFrame);
			}
			case TermKind.Member:
				return terms.member(
					this.contextualize(terms.base(term), frame),
					terms.operand(term) as SemanticNameID,
				);
			case TermKind.Index:
				return terms.index(
					this.contextualize(terms.base(term), frame),
					this.contextualize(terms.operand(term) as TermID, frame),
				);
			case TermKind.Element:
				return terms.element(this.contextualize(terms.base(term), frame));
			case TermKind.Call:
				return terms.call(this.contextualize(terms.base(term), frame));
			case TermKind.Instance:
				return terms.instance(this.contextualize(terms.base(term), frame));
			case TermKind.Metatable:
				return terms.metatable(this.contextualize(terms.base(term), frame));
		}
	}

	public contextualizeCallArguments(
		call: SummaryCall,
		ownerFrame: number,
		out: TermID[],
	): void {
		out.length = call.arguments.length;
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			out[argumentIndex] = ownerFrame === 0
				? call.arguments[argumentIndex]
				: this.contextualize(call.arguments[argumentIndex], ownerFrame);
		}
	}

	public contextualizeCallCallee(call: SummaryCall, ownerFrame: number): TermID {
		return ownerFrame === 0 ? call.callee : this.contextualize(call.callee, ownerFrame);
	}

	public contextualizeCallResult(call: SummaryCall, ownerFrame: number): TermID | undefined {
		return call.result === undefined || ownerFrame === 0
			? call.result
			: this.contextualize(call.result, ownerFrame);
	}

	public closureForCallable(term: TermID): number {
		return this.summaries.terms.kind(term) === TermKind.ContextRoot
			? this.summaries.terms.operand(term)
			: 0;
	}

	private contextualizeAlias(alias: SummaryAlias, frame: number): SummaryAlias {
		return {
			target: this.contextualize(alias.target, frame),
			source: this.contextualize(alias.source, frame),
			relation: alias.relation,
		};
	}

	private publishReturns(
		returns: readonly TermID[],
		frame: number,
		result: TermID | undefined,
	): void {
		if (result === undefined) {
			return;
		}
		for (let returnIndex = 0; returnIndex < returns.length; returnIndex += 1) {
			this.addValue(result, this.contextualize(returns[returnIndex], frame));
		}
	}

	private materializeFrameWrites(frame: number, name: SemanticNameID): void {
		const summary = this.summaries.get(this.frames.summary(frame));
		for (let writeIndex = 0; writeIndex < summary.writes.length; writeIndex += 1) {
			const write = summary.writes[writeIndex];
			if (write.name === name) {
				this.addWrite({
					base: this.contextualize(write.base, frame),
					name,
					value: this.contextualize(write.value, frame),
					declaration: write.declaration,
				});
			}
		}
	}

	private materializeFrameEffectCalls(frame: number, name: SemanticNameID): void {
		const calls = this.demand.callsForEffect(this.frames.summary(frame), name);
		for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
			this.enqueueCall(calls[callIndex], frame);
		}
	}

	private materializeFrameCompositionCalls(frame: number): void {
		const calls = this.demand.compositionCalls(this.frames.summary(frame));
		for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
			this.enqueueCall(calls[callIndex], frame);
		}
	}

	private addAlias(alias: SummaryAlias): void {
		switch (alias.relation) {
			case 'value':
				this.addValue(alias.target, alias.source);
				break;
			case 'metatable':
				if (this.metatables.add(alias.target, alias.source)) {
					this.revision += 1;
				}
				break;
			case 'prototype':
				this.addPrototype(alias.target, alias.source);
				break;
		}
	}

	private addWrite(write: SummaryWrite): void {
		if (!this.writes.add(write)) {
			return;
		}
		this.revision += 1;
		this.addValue(this.summaries.terms.member(write.base, write.name), write.value);
	}

	private addValue(target: TermID, source: TermID): void {
		if (target === source || !this.values.add(target, source)) {
			return;
		}
		this.revision += 1;
		for (let link = this.prototypes.first(target); link !== 0; link = this.prototypes.next(link)) {
			this.addPrototype(source, this.prototypes.target(link));
		}
		for (
			let link = this.prototypes.firstReverse(target);
			link !== 0;
			link = this.prototypes.nextReverse(link)
		) {
			this.addPrototype(this.prototypes.owner(link), source);
		}
	}

	private addPrototype(owner: TermID, target: TermID): void {
		this.prototypeOwnerQueue.push(owner);
		this.prototypeTargetQueue.push(target);
		if (this.propagatingPrototypes) {
			return;
		}
		this.propagatingPrototypes = true;
		while (this.prototypeQueueHead < this.prototypeOwnerQueue.length) {
			const retainedOwner = this.prototypeOwnerQueue[this.prototypeQueueHead];
			const retainedTarget = this.prototypeTargetQueue[this.prototypeQueueHead];
			this.prototypeQueueHead += 1;
			if (!this.prototypes.add(retainedOwner, retainedTarget)) {
				continue;
			}
			this.revision += 1;
			for (let link = this.values.first(retainedOwner); link !== 0; link = this.values.next(link)) {
				this.prototypeOwnerQueue.push(this.values.target(link));
				this.prototypeTargetQueue.push(retainedTarget);
			}
			for (let link = this.values.first(retainedTarget); link !== 0; link = this.values.next(link)) {
				this.prototypeOwnerQueue.push(retainedOwner);
				this.prototypeTargetQueue.push(this.values.target(link));
			}
		}
		this.prototypeOwnerQueue.length = 0;
		this.prototypeTargetQueue.length = 0;
		this.prototypeQueueHead = 0;
		this.propagatingPrototypes = false;
	}
}
