import {
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type TermID,
	TermKind,
} from './function_summary';
import { SemanticInstantiationQuery } from './instantiate';
import type { SymbolID } from './model';
import { SemanticQueryEvaluation, SemanticQueryResults, updateQueryResult } from './query_dependencies';
import { SemanticQueryWorklist } from './query_worklist';
import { TermRelation } from './term_relation';
import type { SemanticValueSource } from './value_graph';

type MemberRead = {
	readonly id: number;
	readonly name: SemanticNameID;
	readonly values: TermID[];
	readonly declarations: SymbolID[];
};

export class SemanticMemberQuery {
	private readonly alternatives: SemanticQueryResults<TermID>;
	/** Forward read dependencies only, excluding location/prototype candidate comparisons. */
	private readonly alternativeInputs: TermID[][] = [];
	private readonly alternativeQueues: TermID[][] = [];
	private readonly alternativeSeen: number[][] = [];
	private readonly alternativeGeneration: number[] = [];
	private readonly memberValues: TermID[][] = [];
	private readonly memberDeclarations: SymbolID[][] = [];
	private readonly memberReads: MemberRead[][] = [];
	private readonly memberReadEvaluation: SemanticQueryEvaluation;
	private memberReadCount = 0;
	private readonly pendingMemberBases: TermID[][] = [];
	private readonly memberWriteMatches: number[][] = [];
	private readonly memberWriteIndex: SemanticQueryEvaluation;
	private readonly memberWritesByValue = new Map<SemanticNameID, TermRelation<number>>();
	private readonly memberSeen: number[][] = [];
	private readonly memberGeneration: number[] = [];
	private readonly locations: SemanticQueryResults<TermID>;
	private readonly locationPaths: TermID[][] = [];
	private readonly locationSeen: number[][] = [];
	private readonly locationGeneration: number[] = [];
	private readonly rootAliases: SemanticQueryResults<TermID>;
	private readonly locationRootAliasSeen: number[] = [];
	private locationRootAliasGeneration = 0;
	private readonly locationBaseQueue: TermID[] = [];
	private readonly locationBaseSeen: number[] = [];
	private locationBaseGeneration = 0;
	private readonly prototypeOwners: SemanticQueryResults<TermID>;
	private readonly prototypeSources: SemanticQueryResults<TermID>;
	private readonly semanticPrototypeOwners: SemanticQueryResults<TermID>;
	private readonly semanticPrototypeSources: SemanticQueryResults<TermID>;
	private readonly prototypeOwnerIndex: SemanticQueryEvaluation;
	private readonly prototypeSourceIndex: SemanticQueryEvaluation;
	private readonly prototypeOwnerWork: SemanticQueryWorklist;
	private readonly prototypeSourceWork: SemanticQueryWorklist;
	private indexedPrototypeOwners = 0;
	private indexedPrototypeSources = 0;
	private readonly prototypeOwnersByValue: TermRelation;
	private readonly prototypeSourcesByLocation: TermRelation;
	private readonly queryTerms: TermID[] = [];
	private readonly functionSummaries: FunctionSummaryID[] = [];
	private readonly functionDeclarations: (SymbolID | undefined)[] = [];
	private readonly callableTerms: TermID[] = [];
	private readonly queryTermSeen: number[] = [];
	private queryTermGeneration = 0;
	private readonly valueDemand: SemanticQueryEvaluation;
	private readonly valueDemandTerms: TermID[] = [];
	private readonly valueDemandInputIndices: number[] = [];
	private readonly symbolSeen: Map<SymbolID, number> = new Map();
	private symbolGeneration = 0;

	constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly instantiation: SemanticInstantiationQuery,
	) {
		const dependencies = summaries.terms.dependencies;
		this.valueDemand = new SemanticQueryEvaluation(dependencies);
		this.memberReadEvaluation = new SemanticQueryEvaluation(dependencies);
		this.memberWriteIndex = new SemanticQueryEvaluation(dependencies);
		this.alternatives = new SemanticQueryResults<TermID>(dependencies);
		this.locations = new SemanticQueryResults<TermID>(dependencies);
		this.rootAliases = new SemanticQueryResults<TermID>(dependencies);
		this.prototypeOwners = new SemanticQueryResults<TermID>(dependencies);
		this.prototypeSources = new SemanticQueryResults<TermID>(dependencies);
		this.semanticPrototypeOwners = new SemanticQueryResults<TermID>(dependencies);
		this.semanticPrototypeSources = new SemanticQueryResults<TermID>(dependencies);
		this.prototypeOwnerIndex = new SemanticQueryEvaluation(dependencies);
		this.prototypeSourceIndex = new SemanticQueryEvaluation(dependencies);
		this.prototypeOwnerWork = new SemanticQueryWorklist(dependencies);
		this.prototypeSourceWork = new SemanticQueryWorklist(dependencies);
		this.prototypeOwnersByValue = new TermRelation(dependencies);
		this.prototypeSourcesByLocation = new TermRelation(dependencies);
	}

	public nameId(name: string): SemanticNameID {
		return this.summaries.terms.nameId(name);
	}

	public get valueEvaluations(): number { return this.alternatives.count; }
	public get memberEvaluations(): number { return this.memberReadEvaluation.count; }
	public get locationEvaluations(): number { return this.locations.count; }
	public get prototypeEvaluations(): number {
		return this.prototypeOwners.count + this.prototypeSources.count
			+ this.semanticPrototypeOwners.count + this.semanticPrototypeSources.count;
	}
	public get indexEvaluations(): number {
		return this.memberWriteIndex.count + this.prototypeOwnerIndex.count + this.prototypeSourceIndex.count;
	}
	public get prototypeJoinEvaluations(): number {
		return this.prototypeOwnerWork.evaluation.count + this.prototypeSourceWork.evaluation.count;
	}

	public resolveMembers(
		source: SemanticValueSource,
		name: SemanticNameID,
		out: SymbolID[],
	): void {
		this.instantiation.projectName(name);
		this.collectQueryTerms(this.summaries.terms.compileSource(source));
		out.length = 0;
		this.symbolGeneration += 1;
		for (let queryIndex = 0; queryIndex < this.queryTerms.length; queryIndex += 1) {
			this.demandValue(this.queryTerms[queryIndex]);
			const declarations = this.collectMemberValues(this.queryTerms[queryIndex], name, 0).declarations;
			for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
				const declaration = declarations[declarationIndex];
				if (this.symbolSeen.get(declaration) !== this.symbolGeneration) {
					this.symbolSeen.set(declaration, this.symbolGeneration);
					out.push(declaration);
				}
			}
		}
	}

	public resolveFunctionDeclarations(source: SemanticValueSource, out: SymbolID[]): void {
		this.collectQueryTerms(this.summaries.terms.compileSource(source));
		out.length = 0;
		this.symbolGeneration += 1;
		const summaries = this.functionSummaries;
		const declarations = this.functionDeclarations;
		const callableTerms = this.callableTerms;
		for (let queryIndex = 0; queryIndex < this.queryTerms.length; queryIndex += 1) {
			this.resolveCallable(this.queryTerms[queryIndex], summaries, declarations, callableTerms);
			for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
				const declaration = declarations[declarationIndex];
				if (declaration !== undefined
					&& this.symbolSeen.get(declaration) !== this.symbolGeneration) {
					this.symbolSeen.set(declaration, this.symbolGeneration);
					out.push(declaration);
				}
			}
		}
	}

	public resolveCallable(
		term: TermID,
		summaryOut: FunctionSummaryID[],
		declarationOut: (SymbolID | undefined)[],
		termOut: TermID[],
	): void {
		summaryOut.length = 0;
		declarationOut.length = 0;
		termOut.length = 0;
		this.demandValue(term);
		const alternatives = this.collectAlternatives(term, 0);
		for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
			const alternative = alternatives[alternativeIndex];
			const summaryIds = this.summaries.summaryIdsForTerm(alternative);
			for (let summaryIndex = 0; summaryIndex < summaryIds.length; summaryIndex += 1) {
				const summary = summaryIds[summaryIndex];
				let retained = false;
				for (let resultIndex = 0; resultIndex < summaryOut.length; resultIndex += 1) {
					if (summaryOut[resultIndex] === summary && termOut[resultIndex] === alternative) {
						retained = true;
						break;
					}
				}
				if (!retained) {
					summaryOut.push(summary);
					declarationOut.push(this.summaries.declarationForSummary(summary));
					termOut.push(alternative);
				}
			}
		}
	}

	private demandValue(term: TermID): void {
		if (this.valueDemand.isCurrent(term) || this.valueDemand.isComputing(term)) return;
		let depth = 0;
		this.valueDemandTerms[depth] = term;
		this.valueDemandInputIndices[depth] = -1;
		while (depth >= 0) {
			const current = this.valueDemandTerms[depth];
			if (this.valueDemandInputIndices[depth] === -1) {
				this.valueDemand.begin(current);
				const alternatives = this.collectAlternatives(current, 0);
				for (let index = 0; index < alternatives.length; index += 1) {
					this.instantiation.demandValue(alternatives[index]);
				}
				this.valueDemandInputIndices[depth] = 0;
			}
			const inputs = this.alternativeInputs[current];
			const inputIndex = this.valueDemandInputIndices[depth];
			if (inputIndex === inputs.length) {
				this.valueDemand.end(current);
				depth -= 1;
				continue;
			}
			const input = inputs[inputIndex];
			this.valueDemandInputIndices[depth] += 1;
			if (!this.valueDemand.isCurrent(input) && !this.valueDemand.isComputing(input)) {
				depth += 1;
				this.valueDemandTerms[depth] = input;
				this.valueDemandInputIndices[depth] = -1;
			}
		}
	}

	private collectQueryTerms(raw: TermID): void {
		this.queryTerms.length = 0;
		this.queryTermGeneration += 1;
		this.appendQueryTerm(raw);
		this.appendQueryTerm(this.summaries.projectExternalTerm(raw));
		const owner = this.summaries.terms.summaryOwner(raw);
		if (owner === undefined) {
			return;
		}
		for (
			let frame = this.instantiation.frames.first(owner);
			frame !== 0;
			frame = this.instantiation.frames.next(frame)
		) {
			this.appendQueryTerm(this.instantiation.contextualize(raw, frame));
		}
	}

	private appendQueryTerm(term: TermID): void {
		if (this.queryTermSeen[term] === this.queryTermGeneration) {
			return;
		}
		this.queryTermSeen[term] = this.queryTermGeneration;
		this.queryTerms.push(term);
	}

	private collectAlternatives(term: TermID, depth: number): readonly TermID[] {
		if (this.alternatives.isCurrent(term) || this.alternatives.isComputing(term)) {
			return this.alternatives.values(term);
		}
		this.alternatives.begin(term);
		const retained = this.alternatives.buffer(depth);
		let inputs = this.alternativeInputs[term];
		if (!inputs) {
			inputs = [];
			this.alternativeInputs[term] = inputs;
		}
		inputs.length = 0;
		const queue = this.alternativeQueueAtDepth(depth);
		const seen = this.alternativeSeenAtDepth(depth);
		const generation = this.nextAlternativeGeneration(depth);
		queue.length = 1;
		queue[0] = term;
		let head = 0;
		while (head < queue.length) {
			const current = queue[head];
			head += 1;
			if (seen[current] === generation) {
				continue;
			}
			seen[current] = generation;
			retained.push(current);
			const values = this.instantiation.values;
			for (let link = values.first(current); link !== 0; link = values.next(link)) {
				queue.push(values.target(link));
			}
			const reads = this.instantiation.readValues;
			for (let link = reads.first(current); link !== 0; link = reads.next(link)) {
				queue.push(reads.target(link));
			}
			const terms = this.summaries.terms;
			if (terms.kind(current) >= TermKind.Member) {
				inputs.push(terms.base(current));
				if (terms.kind(current) === TermKind.Index) inputs.push(terms.operand(current) as TermID);
			}
			switch (terms.kind(current)) {
				case TermKind.Member: {
					const name = terms.operand(current) as SemanticNameID;
					this.instantiation.projectName(name);
					const memberValues = this.collectMemberValues(
						terms.base(current),
						name,
						depth,
					).values;
					for (let valueIndex = 0; valueIndex < memberValues.length; valueIndex += 1) {
						this.instantiation.addReadValue(current, memberValues[valueIndex]);
						queue.push(memberValues[valueIndex]);
					}
					break;
				}
				case TermKind.Index: {
					const bases = this.collectLocationAlternatives(terms.base(current), depth + 1);
					// Keys are values, not reverse aliases of storage containing them.
					const keys = this.collectAlternatives(
						terms.operand(current) as TermID,
						depth + 2,
					);
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						if (terms.isBasedOn(bases[baseIndex], current)) {
							continue;
						}
						for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
							if (terms.isBasedOn(keys[keyIndex], current)) {
								continue;
							}
							const indexed = terms.retainedIndex(bases[baseIndex], keys[keyIndex]);
							if (indexed !== undefined) {
								this.instantiation.addReadValue(current, indexed);
								queue.push(indexed);
							}
							if (terms.isNumericLiteral(keys[keyIndex])
								&& (indexed === undefined || this.instantiation.values.first(indexed) === 0)) {
								const element = terms.retainedElement(bases[baseIndex]);
								if (element !== undefined) {
									this.instantiation.addReadValue(current, element);
									queue.push(element);
								}
							}
						}
						const retainedIndices = terms.indices(bases[baseIndex]);
						const retainedIndexCount = retainedIndices.length;
						for (
							let retainedIndex = 0;
							retainedIndex < retainedIndexCount;
							retainedIndex += 1
						) {
							const candidate = retainedIndices[retainedIndex];
							if (this.instantiation.values.first(candidate) === 0
								&& this.instantiation.writes.first(candidate) === 0
								&& this.instantiation.metatables.first(candidate) === 0
								&& this.instantiation.prototypes.first(candidate) === 0) {
								continue;
							}
							const candidateKeys = this.collectAlternatives(
								terms.operand(candidate) as TermID,
								depth + 3,
							);
							let matches = false;
							for (
								let candidateKeyIndex = 0;
								candidateKeyIndex < candidateKeys.length && !matches;
								candidateKeyIndex += 1
							) {
								for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
									if (candidateKeys[candidateKeyIndex] === keys[keyIndex]) {
										matches = true;
										break;
									}
								}
							}
							if (matches) {
								this.instantiation.addReadValue(current, candidate);
								queue.push(candidate);
							}
						}
					}
					break;
				}
				case TermKind.Element: {
					const bases = this.collectAlternatives(terms.base(current), depth + 1);
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						const element = terms.retainedElement(bases[baseIndex]);
						if (element !== undefined) {
							this.instantiation.addReadValue(current, element);
							queue.push(element);
						}
					}
					break;
				}
				case TermKind.Call: {
					const bases = this.collectAlternatives(terms.base(current), depth + 1);
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						if (!terms.isBasedOn(bases[baseIndex], current)) {
							queue.push(terms.call(bases[baseIndex]));
						}
					}
					break;
				}
				case TermKind.Instance: {
					const bases = this.collectAlternatives(terms.base(current), depth + 1);
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						if (!terms.isBasedOn(bases[baseIndex], current)) {
							queue.push(terms.instance(bases[baseIndex]));
						}
					}
					break;
				}
				case TermKind.Metatable: {
					const bases = this.collectAlternatives(terms.base(current), depth + 1);
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						const base = bases[baseIndex];
						if (terms.isBasedOn(base, current)) {
							continue;
						}
						const metatable = terms.retainedMetatable(base);
						if (metatable !== undefined) {
							queue.push(metatable);
						}
						const metatables = this.instantiation.metatables;
						for (let link = metatables.first(base); link !== 0; link = metatables.next(link)) {
							queue.push(metatables.target(link));
						}
					}
					break;
				}
				case TermKind.Root:
				case TermKind.Parameter:
				case TermKind.Local:
				case TermKind.ContextRoot:
					break;
			}
		}
		return this.alternatives.publish(term, retained);
	}

	private collectMemberValues(
		base: TermID,
		name: SemanticNameID,
		depth: number,
	): MemberRead {
		let reads = this.memberReads[base];
		if (!reads) {
			reads = [];
			this.memberReads[base] = reads;
		}
		let read: MemberRead | undefined;
		for (let index = 0; index < reads.length; index += 1) {
			if (reads[index].name === name) {
				read = reads[index];
				break;
			}
		}
		if (!read) {
			read = { id: this.memberReadCount++, name, values: [], declarations: [] };
			reads.push(read);
		}
		if (this.memberReadEvaluation.isCurrent(read.id) || this.memberReadEvaluation.isComputing(read.id)) return read;
		this.memberReadEvaluation.begin(read.id);
		const values = this.memberValuesAtDepth(depth);
		const declarations = this.memberDeclarationsAtDepth(depth);
		values.length = 0;
		declarations.length = 0;
		const seen = this.memberSeenAtDepth(depth);
		const generation = this.nextMemberGeneration(depth);
		this.collectMemberValuesRecursive(base, name, values, declarations, seen, generation, depth, false, true);
		const valuesChanged = updateQueryResult(read.values, values);
		const declarationsChanged = updateQueryResult(read.declarations, declarations);
		this.memberReadEvaluation.end(read.id, valuesChanged || declarationsChanged);
		return read;
	}

	private collectMemberValuesRecursive(
		base: TermID,
		name: SemanticNameID,
		values: TermID[],
		declarations: SymbolID[],
		seen: number[],
		generation: number,
		depth: number,
		instanceShape: boolean,
		locationAliases: boolean,
	): void {
		const alternatives = locationAliases
			? this.collectLocationAlternatives(base, depth + 1)
			: this.collectAlternatives(base, depth + 1);
		const terms = this.summaries.terms;
		const pending = this.pendingMemberBasesAtDepth(depth);
		pending.length = 0;
		const relations = this.instantiation.values;
		const writes = this.instantiation.writes;
		const initialValueCount = values.length;
		for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
			const alternative = alternatives[alternativeIndex];
			if (seen[alternative] === generation) {
				continue;
			}
			seen[alternative] = generation;
			if (terms.isUnknown(alternative)) {
				values.push(terms.unknown());
				continue;
			}
			let direct = false;
			for (let link = writes.first(alternative); link !== 0; link = writes.next(link)) {
				if (writes.name(link) === name) {
					direct = true;
					values.push(writes.value(link));
					declarations.push(writes.declaration(link));
				}
			}
			const member = terms.retainedMember(alternative, name);
			if (member !== undefined) {
				for (let link = relations.first(member); link !== 0; link = relations.next(link)) {
					direct = true;
					values.push(relations.target(link));
				}
			}
			const instance = instanceShape ? terms.retainedInstance(alternative) : undefined;
			if (!direct && instance !== undefined && terms.kind(alternative) !== TermKind.Instance) {
				for (let link = writes.first(instance); link !== 0; link = writes.next(link)) {
					if (writes.name(link) === name) {
						direct = true;
						values.push(writes.value(link));
						declarations.push(writes.declaration(link));
					}
				}
				const instanceMember = terms.retainedMember(instance, name);
				if (instanceMember !== undefined) {
					for (let link = relations.first(instanceMember); link !== 0; link = relations.next(link)) {
						direct = true;
						values.push(relations.target(link));
					}
				}
			}
			if (direct) {
				continue;
			}
			if (relations.first(alternative) === 0) {
				pending.push(alternative);
			}
		}
		if (values.length === initialValueCount) {
			const queryValues = this.collectAlternatives(base, depth + 1);
			const index = this.indexMemberWrites(name, depth + 1);
			let matches = this.memberWriteMatches[depth];
			if (!matches) {
				matches = [];
				this.memberWriteMatches[depth] = matches;
			}
			matches.length = 0;
			for (let queryIndex = 0; queryIndex < queryValues.length; queryIndex += 1) {
				for (let link = index.first(queryValues[queryIndex]); link !== 0; link = index.next(link)) {
					const write = index.target(link);
					if (!matches.includes(write)) matches.push(write);
				}
			}
			for (let match = 0; match < matches.length; match += 1) {
				values.push(writes.value(matches[match]));
				declarations.push(writes.declaration(matches[match]));
			}
			if (values.length !== initialValueCount) {
				return;
			}
		}
		for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
			const alternative = pending[pendingIndex];
			if (terms.kind(alternative) === TermKind.Instance) {
				const before = values.length;
				this.collectMemberValuesRecursive(
					terms.base(alternative),
					name,
					values,
					declarations,
					seen,
					generation,
					depth + 1,
					true,
					true,
				);
				if (values.length !== before) {
					continue;
				}
				if (this.instantiation.prototypes.empty) continue;
				const prototypeOwners = this.collectPrototypeOwners(terms.base(alternative), depth + 1);
				for (let ownerIndex = 0; ownerIndex < prototypeOwners.length; ownerIndex += 1) {
					this.collectMemberValuesRecursive(
						prototypeOwners[ownerIndex],
						name,
						values,
						declarations,
						seen,
						generation,
						depth + 1,
						false,
						true,
					);
				}
				const semanticOwners = this.collectSemanticPrototypeOwners(
					terms.base(alternative),
					depth + 1,
				);
				for (let ownerIndex = 0; ownerIndex < semanticOwners.length; ownerIndex += 1) {
					this.collectMemberValuesRecursive(
						semanticOwners[ownerIndex],
						name,
						values,
						declarations,
						seen,
						generation,
						depth + 1,
						false,
						true,
					);
				}
				continue;
			}
			if (this.instantiation.prototypes.empty) continue;
			const before = values.length;
			const prototypeSources = this.collectPrototypeSources(alternative, depth + 1);
			for (let sourceIndex = 0; sourceIndex < prototypeSources.length; sourceIndex += 1) {
				this.collectMemberValuesRecursive(
					prototypeSources[sourceIndex],
					name,
					values,
					declarations,
					seen,
					generation,
					depth + 1,
					true,
					false,
				);
			}
			if (values.length === before) {
				const semanticSources = this.collectSemanticPrototypeSources(
					alternative,
					depth + 1,
				);
				for (let sourceIndex = 0; sourceIndex < semanticSources.length; sourceIndex += 1) {
					this.collectMemberValuesRecursive(
						semanticSources[sourceIndex],
						name,
						values,
						declarations,
						seen,
						generation,
						depth + 1,
						true,
						false,
					);
				}
			}
		}
	}

	private indexMemberWrites(name: SemanticNameID, depth: number): TermRelation<number> {
		// Materialize the value/write join once per demanded name. A read consumes
		// matching fact rows instead of comparing every same-name writer again.
		let index = this.memberWritesByValue.get(name);
		if (!index) {
			index = new TermRelation<number>(this.summaries.terms.dependencies);
			this.memberWritesByValue.set(name, index);
		}
		if (this.memberWriteIndex.isCurrent(name) || this.memberWriteIndex.isComputing(name)) return index;
		this.memberWriteIndex.begin(name);
		const writes = this.instantiation.writes;
		for (let link = writes.firstName(name); link !== 0; link = writes.nextName(link)) {
			const values = this.collectAlternatives(writes.base(link), depth + 1);
			for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
				const value = values[valueIndex];
				if (this.summaries.terms.hasLocationIdentity(value)) index.add(value, link);
			}
		}
		this.memberWriteIndex.end(name);
		return index;
	}

	private alternativeQueueAtDepth(depth: number): TermID[] {
		let queue = this.alternativeQueues[depth];
		if (!queue) {
			queue = [];
			this.alternativeQueues[depth] = queue;
		}
		return queue;
	}

	private pendingMemberBasesAtDepth(depth: number): TermID[] {
		let pending = this.pendingMemberBases[depth];
		if (!pending) {
			pending = [];
			this.pendingMemberBases[depth] = pending;
		}
		return pending;
	}

	private collectLocationAlternatives(term: TermID, depth: number): readonly TermID[] {
		if (this.locations.isCurrent(term) || this.locations.isComputing(term)) {
			return this.locations.values(term);
		}
		this.locations.begin(term);
		const values = this.locations.buffer(depth);
		let path = this.locationPaths[depth];
		if (!path) {
			path = [];
			this.locationPaths[depth] = path;
		}
		let seen = this.locationSeen[depth];
		if (!seen) {
			seen = [];
			this.locationSeen[depth] = seen;
		}
		const generation = (this.locationGeneration[depth] || 0) + 1;
		this.locationGeneration[depth] = generation;
		const alternatives = this.collectAlternatives(term, depth + 1);
		for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
			const alternative = alternatives[alternativeIndex];
			if (this.summaries.terms.hasLocationIdentity(alternative) && seen[alternative] !== generation) {
				seen[alternative] = generation;
				values.push(alternative);
			}
		}
		const relations = this.instantiation.values;
		const valueCount = values.length;
		let head = 0;
		while (head < values.length) {
			const current = values[head];
			const queryValue = head < valueCount;
			head += 1;
			for (
				let link = relations.firstReverse(current);
				link !== 0;
				link = relations.nextReverse(link)
			) {
				const owner = relations.owner(link);
				if (seen[owner] !== generation) {
					seen[owner] = generation;
					values.push(owner);
				}
			}
			const terms = this.summaries.terms;
			path.length = 0;
			let base = current;
			while (terms.kind(base) >= TermKind.Member) {
				path.push(base);
				base = terms.base(base);
				const bases = this.locationBaseQueue;
				bases.length = 1;
				bases[0] = base;
				if (queryValue) {
					// Resolve the read's base before looking for storage aliases. Once
					// walking back to aliases, do not follow their other possible values.
					const baseGeneration = ++this.locationBaseGeneration;
					this.locationBaseSeen[base] = baseGeneration;
					for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
						for (let link = relations.first(bases[baseIndex]); link !== 0; link = relations.next(link)) {
							const value = relations.target(link);
							if (this.locationBaseSeen[value] !== baseGeneration) {
								this.locationBaseSeen[value] = baseGeneration;
								bases.push(value);
							}
						}
						const reads = this.instantiation.readValues;
						for (let link = reads.first(bases[baseIndex]); link !== 0; link = reads.next(link)) {
							const value = reads.target(link);
							if (this.locationBaseSeen[value] !== baseGeneration) {
								this.locationBaseSeen[value] = baseGeneration;
								bases.push(value);
							}
						}
					}
				}
				for (let baseIndex = 0; baseIndex < bases.length; baseIndex += 1) {
					const roots = this.collectLocationRootAliases(bases[baseIndex]);
					for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
						let projected: TermID | undefined = roots[rootIndex];
						for (let pathIndex = path.length - 1; pathIndex >= 0 && projected !== undefined; pathIndex -= 1) {
							projected = terms.retainedAccessWithBase(path[pathIndex], projected);
						}
						if (projected !== undefined && seen[projected] !== generation) {
							seen[projected] = generation;
							values.push(projected);
						}
					}
				}
			}
			const metatables = this.instantiation.metatables;
			for (
				let link = metatables.firstReverse(current);
				link !== 0;
				link = metatables.nextReverse(link)
			) {
				const owner = metatables.owner(link);
				if (terms.isBasedOn(owner, current)) {
					continue;
				}
				const metatable = terms.retainedMetatable(owner);
				if (metatable !== undefined && seen[metatable] !== generation) {
					seen[metatable] = generation;
					values.push(metatable);
				}
			}
		}
		return this.locations.publish(term, values);
	}

	private collectLocationRootAliases(term: TermID): readonly TermID[] {
		if (this.rootAliases.isCurrent(term)) return this.rootAliases.values(term);
		this.rootAliases.begin(term);
		const roots = this.rootAliases.buffer(0);
		if (!this.summaries.terms.hasLocationIdentity(term)) {
			roots.length = 0;
			return this.rootAliases.publish(term, roots);
		}
		roots.length = 1;
		roots[0] = term;
		const generation = ++this.locationRootAliasGeneration;
		this.locationRootAliasSeen[term] = generation;
		const relations = this.instantiation.values;
		for (let head = 0; head < roots.length; head += 1) {
			for (let link = relations.firstReverse(roots[head]); link !== 0; link = relations.nextReverse(link)) {
				const owner = relations.owner(link);
				// Root aliases are transitive even when an intermediate root has no
				// retained access path. A table containing the value is not a root alias.
				if (this.summaries.terms.kind(owner) < TermKind.Member
					&& this.locationRootAliasSeen[owner] !== generation) {
					this.locationRootAliasSeen[owner] = generation;
					roots.push(owner);
				}
			}
		}
		return this.rootAliases.publish(term, roots);
	}

	private collectPrototypeOwners(classTerm: TermID, depth: number): readonly TermID[] {
		if (this.prototypeOwners.isCurrent(classTerm) || this.prototypeOwners.isComputing(classTerm)) {
			return this.prototypeOwners.values(classTerm);
		}
		this.prototypeOwners.begin(classTerm);
		const owners = this.prototypeOwners.buffer(depth);
		const classes = this.collectLocationAlternatives(classTerm, depth + 1);
		const prototypes = this.instantiation.prototypes;
		for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
			for (
				let link = prototypes.firstReverse(classes[classIndex]);
				link !== 0;
				link = prototypes.nextReverse(link)
			) {
				if (!owners.includes(prototypes.owner(link))) {
					owners.push(prototypes.owner(link));
				}
			}
		}
		return this.prototypeOwners.publish(classTerm, owners);
	}

	private collectPrototypeSources(objectTerm: TermID, depth: number): readonly TermID[] {
		if (this.prototypeSources.isCurrent(objectTerm) || this.prototypeSources.isComputing(objectTerm)) {
			return this.prototypeSources.values(objectTerm);
		}
		this.prototypeSources.begin(objectTerm);
		const sources = this.prototypeSources.buffer(depth);
		const objects = this.collectLocationAlternatives(objectTerm, depth + 1);
		const prototypes = this.instantiation.prototypes;
		for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
			for (
				let link = prototypes.first(objects[objectIndex]);
				link !== 0;
				link = prototypes.next(link)
			) {
				if (!sources.includes(prototypes.target(link))) {
					sources.push(prototypes.target(link));
				}
			}
		}
		return this.prototypeSources.publish(objectTerm, sources);
	}

	private collectSemanticPrototypeOwners(classTerm: TermID, depth: number): readonly TermID[] {
		if (this.semanticPrototypeOwners.isCurrent(classTerm) || this.semanticPrototypeOwners.isComputing(classTerm)) {
			return this.semanticPrototypeOwners.values(classTerm);
		}
		this.semanticPrototypeOwners.begin(classTerm);
		const owners = this.semanticPrototypeOwners.buffer(depth);
		const classes = this.collectLocationAlternatives(classTerm, depth + 1);
		this.indexPrototypeOwners(depth + 1);
		const index = this.prototypeOwnersByValue;
		for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
			for (let link = index.first(classes[classIndex]); link !== 0; link = index.next(link)) {
				const owner = index.target(link);
				if (!owners.includes(owner)) owners.push(owner);
			}
		}
		return this.semanticPrototypeOwners.publish(classTerm, owners);
	}

	private indexPrototypeOwners(depth: number): void {
		// Values and locations grow monotonically within this term universe. These
		// derived indices retain joins; they are not additional assignment aliases.
		if (this.prototypeOwnerIndex.isCurrent(0) || this.prototypeOwnerIndex.isComputing(0)) return;
		this.prototypeOwnerIndex.begin(0);
		const prototypes = this.instantiation.prototypes;
		const count = prototypes.count;
		const work = this.prototypeOwnerWork;
		while (this.indexedPrototypeOwners < count) work.add(++this.indexedPrototypeOwners);
		const pending = work.pendingCount;
		for (let item = 0; item < pending; item += 1) {
			const link = work.take();
			if (work.evaluation.isCurrent(link)) continue;
			work.evaluation.begin(link);
			const targets = this.collectAlternatives(prototypes.target(link), depth + 1);
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const target = targets[targetIndex];
				if (this.summaries.terms.hasLocationIdentity(target)) {
					this.prototypeOwnersByValue.add(target, prototypes.owner(link));
				}
			}
			work.evaluation.end(link);
		}
		this.prototypeOwnerIndex.end(0);
	}

	private collectSemanticPrototypeSources(objectTerm: TermID, depth: number): readonly TermID[] {
		if (this.semanticPrototypeSources.isCurrent(objectTerm) || this.semanticPrototypeSources.isComputing(objectTerm)) {
			return this.semanticPrototypeSources.values(objectTerm);
		}
		this.semanticPrototypeSources.begin(objectTerm);
		const sources = this.semanticPrototypeSources.buffer(depth);
		const objects = this.collectLocationAlternatives(objectTerm, depth + 1);
		this.indexPrototypeSources(depth + 1);
		const index = this.prototypeSourcesByLocation;
		for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
			for (let link = index.first(objects[objectIndex]); link !== 0; link = index.next(link)) {
				const source = index.target(link);
				if (!sources.includes(source)) sources.push(source);
			}
		}
		return this.semanticPrototypeSources.publish(objectTerm, sources);
	}

	private indexPrototypeSources(depth: number): void {
		if (this.prototypeSourceIndex.isCurrent(0) || this.prototypeSourceIndex.isComputing(0)) return;
		this.prototypeSourceIndex.begin(0);
		const prototypes = this.instantiation.prototypes;
		const count = prototypes.count;
		const work = this.prototypeSourceWork;
		while (this.indexedPrototypeSources < count) {
			const link = ++this.indexedPrototypeSources;
			if (prototypes.first(prototypes.owner(link)) === link) work.add(link);
		}
		const pending = work.pendingCount;
		for (let item = 0; item < pending; item += 1) {
			const link = work.take();
			if (work.evaluation.isCurrent(link)) continue;
			work.evaluation.begin(link);
			const owner = prototypes.owner(link);
			const first = prototypes.first(owner);
			const owners = this.collectLocationAlternatives(owner, depth + 1);
			for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
				for (let target = first; target !== 0; target = prototypes.next(target)) {
					this.prototypeSourcesByLocation.add(owners[ownerIndex], prototypes.target(target));
				}
			}
			work.evaluation.end(link);
		}
		this.prototypeSourceIndex.end(0);
	}

	private alternativeSeenAtDepth(depth: number): number[] {
		let seen = this.alternativeSeen[depth];
		if (!seen) {
			seen = [];
			this.alternativeSeen[depth] = seen;
		}
		return seen;
	}

	private nextAlternativeGeneration(depth: number): number {
		const generation = (this.alternativeGeneration[depth] || 0) + 1;
		this.alternativeGeneration[depth] = generation;
		return generation;
	}

	private memberValuesAtDepth(depth: number): TermID[] {
		let values = this.memberValues[depth];
		if (!values) {
			values = [];
			this.memberValues[depth] = values;
		}
		return values;
	}

	private memberDeclarationsAtDepth(depth: number): SymbolID[] {
		let declarations = this.memberDeclarations[depth];
		if (!declarations) {
			declarations = [];
			this.memberDeclarations[depth] = declarations;
		}
		return declarations;
	}

	private memberSeenAtDepth(depth: number): number[] {
		let seen = this.memberSeen[depth];
		if (!seen) {
			seen = [];
			this.memberSeen[depth] = seen;
		}
		return seen;
	}

	private nextMemberGeneration(depth: number): number {
		const generation = (this.memberGeneration[depth] || 0) + 1;
		this.memberGeneration[depth] = generation;
		return generation;
	}
}
