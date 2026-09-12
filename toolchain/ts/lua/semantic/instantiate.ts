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
import { SemanticDependencyIndex, type SemanticQueryDependencies } from './query_dependencies';
import { BidirectionalTermRelation, TermRelation } from './term_relation';
import type { CallValueEntry, DeclarationValueEntry } from './value_graph';

export class WriteSet {
	private readonly baseDependencies: SemanticDependencyIndex;
	private readonly nameDependencies: SemanticDependencyIndex;
	private readonly firstByBase: number[] = [];
	private readonly lastByBase: number[] = [];
	private readonly firstByName: number[] = [];
	private readonly lastByName: number[] = [];
	private readonly bases: TermID[] = [];
	private readonly names: SemanticNameID[] = [];
	private readonly values: TermID[] = [];
	private readonly declarations: SymbolID[] = [];
	private readonly sources: (DeclarationValueEntry | undefined)[] = [];
	private readonly frames: number[] = [];
	private readonly nextByBase: number[] = [];
	private readonly nextByName: number[] = [];

	constructor(dependencies: SemanticQueryDependencies) {
		this.baseDependencies = new SemanticDependencyIndex(dependencies);
		this.nameDependencies = new SemanticDependencyIndex(dependencies);
	}

	public add(write: SummaryWrite, frame: number): boolean {
		for (let link = this.firstByBase[write.base] || 0; link !== 0; link = this.next(link)) {
			if (this.name(link) === write.name
				&& this.value(link) === write.value
				&& this.declaration(link) === write.declaration
				&& this.source(link) === write.source && this.frame(link) === frame) {
				return false;
			}
		}
		const index = this.values.length;
		this.bases.push(write.base);
		this.names.push(write.name);
		this.values.push(write.value);
		this.declarations.push(write.declaration);
		this.sources.push(write.source);
		this.frames.push(frame);
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
		this.baseDependencies.changed(write.base);
		this.nameDependencies.changed(write.name);
		return true;
	}

	public first(base: TermID): number {
		this.baseDependencies.read(base);
		return this.firstByBase[base] || 0;
	}

	public next(link: number): number {
		return this.nextByBase[link - 1];
	}

	public firstName(name: SemanticNameID): number {
		this.nameDependencies.read(name);
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

	public source(link: number): DeclarationValueEntry | undefined {
		return this.sources[link - 1];
	}

	/** Module 0, projected body -summary, or an admitted positive invocation frame. */
	public frame(link: number): number {
		return this.frames[link - 1];
	}
}

export class InstantiationFrames {
	private readonly summaryDependencies: SemanticDependencyIndex;
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

	constructor(dependencies: SemanticQueryDependencies) {
		this.summaryDependencies = new SemanticDependencyIndex(dependencies);
	}

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
		this.summaryDependencies.changed(summary);
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

	public first(summary: FunctionSummaryID): number {
		this.summaryDependencies.read(summary);
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

/** Contextual value terms; deliberately not a static SummaryCall selection key. */
export type CallInputs = Pick<SummaryCall, 'callee' | 'arguments' | 'result'>;

export class SemanticInstantiationQuery {
	public readonly values: BidirectionalTermRelation;
	/** Read answers flow forward; they are not assignments or reverse storage aliases. */
	public readonly readValues: TermRelation;
	public readonly metatables: BidirectionalTermRelation;
	public readonly prototypes: BidirectionalTermRelation;
	public readonly writes: WriteSet;
	public readonly frames: InstantiationFrames;
	private readonly instantiatedFrames: boolean[] = [];
	private readonly activeFrames: number[] = [];
	private readonly projectedSummaries: boolean[] = [];
	private readonly projectedSummaryList: FunctionSummaryID[] = [];
	private readonly projectedNames: boolean[] = [];
	private readonly projectedNameList: SemanticNameID[] = [];
	private readonly demandedNames: boolean[] = [];
	private readonly demandedNameList: SemanticNameID[] = [];
	private readonly effectNames: boolean[] = [];
	private readonly effectNameList: SemanticNameID[] = [];
	private readonly demandedValues: boolean[] = [];
	private readonly frameArguments: TermID[] = [];
	private readonly prototypeOwnerQueue: TermID[] = [];
	private readonly prototypeTargetQueue: TermID[] = [];
	private prototypeQueueHead = 0;
	private propagatingPrototypes = false;

	constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly demand: SemanticDemandIndex,
		private readonly enqueueCall: InstantiatedCallSink,
	) {
		const dependencies = summaries.terms.dependencies;
		this.values = new BidirectionalTermRelation(dependencies);
		this.readValues = new TermRelation(dependencies);
		this.metatables = new BidirectionalTermRelation(dependencies);
		this.prototypes = new BidirectionalTermRelation(dependencies);
		this.writes = new WriteSet(dependencies);
		this.frames = new InstantiationFrames(dependencies);
		for (let aliasIndex = 0; aliasIndex < demand.aliases.length; aliasIndex += 1) {
			this.addAlias(demand.aliases[aliasIndex]);
		}
	}

	public getRevision(): number {
		return this.summaries.terms.dependencies.getRevision();
	}

	public demandName(name: SemanticNameID): boolean {
		if (this.demandedNames[name]) {
			return false;
		}
		this.demandedNames[name] = true;
		this.demandedNameList.push(name);
		const staticWrites = this.demand.staticWrites(name);
		for (let writeIndex = 0; writeIndex < staticWrites.length; writeIndex += 1) {
			this.addWrite(staticWrites[writeIndex], 0);
		}
		for (let frameIndex = 0; frameIndex < this.activeFrames.length; frameIndex += 1) {
			this.materializeFrameWrites(this.activeFrames[frameIndex], name);
		}
		return true;
	}

	/** Source navigation includes projected bodies, independently of instantiated calls. */
	public projectName(name: SemanticNameID): void {
		if (this.projectedNames[name]) {
			return;
		}
		this.demandName(name);
		this.projectedNames[name] = true;
		this.projectedNameList.push(name);
		for (let summaryIndex = 0; summaryIndex < this.projectedSummaryList.length; summaryIndex += 1) {
			this.materializeProjectedWrites(this.projectedSummaryList[summaryIndex], name);
		}
		const writers = this.demand.receiverWriters(name);
		for (let writerIndex = 0; writerIndex < writers.length; writerIndex += 1) {
			this.compose(writers[writerIndex]);
		}
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

	/** A read retains the call producing that value, not every call with a matching name. */
	public demandValue(term: TermID): void {
		if (this.demandedValues[term]) {
			return;
		}
		this.demandedValues[term] = true;
		const topLevelCalls = this.demand.topLevelResultCallsForTerm(term);
		for (let callIndex = 0; callIndex < topLevelCalls.length; callIndex += 1) {
			this.enqueueCall(topLevelCalls[callIndex], 0);
		}
		const terms = this.summaries.terms;
		if (terms.kind(term) === TermKind.ContextRoot) {
			const calls = this.demand.resultCallsForTerm(terms.base(term));
			const frame = terms.operand(term);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.enqueueCall(calls[callIndex], frame);
			}
		} else {
			const calls = this.demand.resultCallsForTerm(term);
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				this.compose(calls[callIndex].owner);
				this.enqueueCall(calls[callIndex], -calls[callIndex].owner);
			}
		}
	}

	public addReadValue(target: TermID, source: TermID): void {
		if (target !== source) this.readValues.add(target, source);
	}

	public compose(summaryId: FunctionSummaryID): boolean {
		if (this.projectedSummaries[summaryId]) {
			return false;
		}
		this.projectedSummaries[summaryId] = true;
		this.projectedSummaryList.push(summaryId);
		const summary = this.summaries.get(summaryId);
		if (summary.lexicalOwner !== undefined) {
			this.compose(summary.lexicalOwner);
		}
		for (let aliasIndex = 0; aliasIndex < summary.aliases.length; aliasIndex += 1) {
			const alias = summary.aliases[aliasIndex];
			this.addAlias({
				target: this.summaries.projectExternalTerm(alias.target),
				source: this.summaries.projectExternalTerm(alias.source),
				relation: alias.relation,
			});
		}
		for (let nameIndex = 0; nameIndex < this.projectedNameList.length; nameIndex += 1) {
			this.materializeProjectedWrites(summaryId, this.projectedNameList[nameIndex]);
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
		this.frameArguments.length = summary.parameters.length;
		for (let parameterIndex = 0; parameterIndex < summary.parameters.length; parameterIndex += 1) {
			this.frameArguments[parameterIndex] = parameterIndex < args.length
				? args[parameterIndex]
				: this.summaries.terms.unknown();
		}
		const cycleFrame = this.frames.findCycleFrame(callerFrame, summaryId);
		if (cycleFrame !== 0) {
			// Reuse the context point, not its first argument. Cyclic reads must
			// still receive the values supplied by the recursive call edge.
			this.publishArguments(summary.parameters, cycleFrame);
			this.publishReturns(summary.returns, cycleFrame, result);
			return cycleFrame;
		}
		const frame = this.frames.intern(site, summaryId, closure, callerFrame, this.frameArguments);
		if (!this.instantiatedFrames[frame]) {
			this.instantiatedFrames[frame] = true;
			this.activeFrames.push(frame);
			this.publishArguments(summary.parameters, frame);
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
			case TermKind.Parameter:
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

	/** Immutable input tuple, retained by the site/owner-frame work item. */
	public bindCall(call: SummaryCall, ownerFrame: number): CallInputs {
		if (ownerFrame === 0) return call;
		const args: TermID[] = [];
		if (ownerFrame < 0) {
			for (const argument of call.arguments) args.push(this.summaries.projectExternalTerm(argument));
			return {
				callee: this.summaries.projectExternalTerm(call.callee),
				arguments: args,
				result: call.result === undefined ? undefined : this.summaries.projectExternalTerm(call.result),
			};
		}
		for (const argument of call.arguments) args.push(this.contextualize(argument, ownerFrame));
		return {
			callee: this.contextualize(call.callee, ownerFrame),
			arguments: args,
			result: call.result === undefined ? undefined : this.contextualize(call.result, ownerFrame),
		};
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

	private publishArguments(parameters: readonly TermID[], frame: number): void {
		for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
			this.addValue(
				this.summaries.terms.contextRoot(parameters[parameterIndex], frame),
				this.frameArguments[parameterIndex],
			);
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
					source: write.source,
				}, frame);
			}
		}
	}

	private materializeProjectedWrites(summaryId: FunctionSummaryID, name: SemanticNameID): void {
		const writes = this.summaries.get(summaryId).writes;
		for (let writeIndex = 0; writeIndex < writes.length; writeIndex += 1) {
			const write = writes[writeIndex];
			if (write.name === name) {
				this.addWrite({
					base: this.summaries.projectExternalTerm(write.base),
					name,
					value: this.summaries.projectExternalTerm(write.value),
					declaration: write.declaration,
					source: write.source,
				}, -summaryId);
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
				this.metatables.add(alias.target, alias.source);
				break;
			case 'prototype':
				this.addPrototype(alias.target, alias.source);
				break;
		}
	}

	private addWrite(write: SummaryWrite, frame: number): void {
		if (!this.writes.add(write, frame)) {
			return;
		}
		this.addValue(this.summaries.terms.member(write.base, write.name), write.value);
	}

	private addValue(target: TermID, source: TermID): void {
		if (!this.summaries.terms.hasLocationIdentity(target) || target === source || !this.values.add(target, source)) {
			return;
		}
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
			if (!this.summaries.terms.hasLocationIdentity(retainedOwner) || !this.prototypes.add(retainedOwner, retainedTarget)) {
				continue;
			}
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
