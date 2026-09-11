import {
	type FunctionSummaryID,
	FunctionSummaryStore,
	type SemanticNameID,
	type TermID,
	TermKind,
} from './function_summary';
import { SemanticInstantiationQuery } from './instantiate';
import type { SymbolID } from './model';
import type { SemanticValueSource } from './value_graph';

export class SemanticMemberQuery {
	private readonly alternativeCache: TermID[][] = [];
	/** Forward read dependencies only, excluding location/prototype candidate comparisons. */
	private readonly alternativeInputs: TermID[][] = [];
	private readonly alternativeRevision: number[] = [];
	private readonly alternativeComputing: boolean[] = [];
	private readonly alternativeQueues: TermID[][] = [];
	private readonly alternativeSeen: number[][] = [];
	private readonly alternativeGeneration: number[] = [];
	private readonly memberValues: TermID[][] = [];
	private readonly memberDeclarations: SymbolID[][] = [];
	private readonly pendingMemberBases: TermID[][] = [];
	private readonly memberSeen: number[][] = [];
	private readonly memberGeneration: number[] = [];
	private readonly locationValues: TermID[][] = [];
	private readonly locationPaths: TermID[][] = [];
	private readonly locationSeen: number[][] = [];
	private readonly locationGeneration: number[] = [];
	private readonly locationRootAliases: TermID[][] = [];
	private readonly locationRootAliasRevisions: number[] = [];
	private readonly locationRootAliasSeen: number[] = [];
	private locationRootAliasGeneration = 0;
	private readonly locationBaseQueue: TermID[] = [];
	private readonly locationBaseSeen: number[] = [];
	private locationBaseGeneration = 0;
	private readonly prototypeOwners: TermID[][] = [];
	private readonly prototypeOwnerRevision: number[] = [];
	private readonly prototypeSources: TermID[][] = [];
	private readonly prototypeSourceRevision: number[] = [];
	private readonly semanticPrototypeOwners: TermID[][] = [];
	private readonly semanticPrototypeOwnerRevision: number[] = [];
	private readonly semanticPrototypeSources: TermID[][] = [];
	private readonly semanticPrototypeSourceRevision: number[] = [];
	private readonly queryTerms: TermID[] = [];
	private readonly queryTermSeen: number[] = [];
	private queryTermGeneration = 0;
	private readonly valueDemandQueue: TermID[] = [];
	private readonly valueDemandRevision: number[] = [];
	private readonly symbolSeen: Map<SymbolID, number> = new Map();
	private symbolGeneration = 0;

	constructor(
		private readonly summaries: FunctionSummaryStore,
		private readonly instantiation: SemanticInstantiationQuery,
	) {}

	public nameId(name: string): SemanticNameID {
		return this.summaries.terms.nameId(name);
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
			const values = this.memberValuesAtDepth(0);
			const declarations = this.memberDeclarationsAtDepth(0);
			this.collectMemberValues(this.queryTerms[queryIndex], name, values, declarations, 0);
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
		const summaries: FunctionSummaryID[] = [];
		const declarations: (SymbolID | undefined)[] = [];
		const callableTerms: TermID[] = [];
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
		const revision = this.instantiation.getRevision();
		if (this.valueDemandRevision[term] === revision) {
			return;
		}
		const queue = this.valueDemandQueue;
		queue.length = 1;
		queue[0] = term;
		for (let head = 0; head < queue.length; head += 1) {
			const current = queue[head];
			if (this.valueDemandRevision[current] === revision) {
				continue;
			}
			this.valueDemandRevision[current] = revision;
			const alternatives = this.collectAlternatives(current, 0);
			for (let index = 0; index < alternatives.length; index += 1) {
				this.instantiation.demandValue(alternatives[index]);
			}
			const inputs = this.alternativeInputs[current];
			for (let index = 0; index < inputs.length; index += 1) {
				queue.push(inputs[index]);
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
		const revision = this.instantiation.getRevision();
		let retained = this.alternativeCache[term];
		if (this.alternativeRevision[term] === revision) {
			return retained;
		}
		if (this.alternativeComputing[term]) {
			return retained || [term];
		}
		if (!retained) {
			retained = [];
			this.alternativeCache[term] = retained;
			this.alternativeInputs[term] = [];
		}
		retained.length = 0;
		const inputs = this.alternativeInputs[term];
		inputs.length = 0;
		this.alternativeComputing[term] = true;
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
					const memberValues = this.memberValuesAtDepth(depth);
					const memberDeclarations = this.memberDeclarationsAtDepth(depth);
					this.collectMemberValues(
						terms.base(current),
						name,
						memberValues,
						memberDeclarations,
						depth,
					);
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
		this.alternativeComputing[term] = false;
		this.alternativeRevision[term] = revision;
		return retained;
	}

	private collectMemberValues(
		base: TermID,
		name: SemanticNameID,
		values: TermID[],
		declarations: SymbolID[],
		depth: number,
	): void {
		values.length = 0;
		declarations.length = 0;
		const seen = this.memberSeenAtDepth(depth);
		const generation = this.nextMemberGeneration(depth);
		this.collectMemberValuesRecursive(base, name, values, declarations, seen, generation, depth, false, true);
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
			for (let link = writes.firstName(name); link !== 0; link = writes.nextName(link)) {
				const writeValues = this.collectAlternatives(writes.base(link), depth + 2);
				let matches = false;
				for (let writeIndex = 0; writeIndex < writeValues.length && !matches; writeIndex += 1) {
					for (let queryIndex = 0; queryIndex < queryValues.length; queryIndex += 1) {
						if (writeValues[writeIndex] === queryValues[queryIndex]) {
							matches = true;
							break;
						}
					}
				}
				if (matches) {
					values.push(writes.value(link));
					declarations.push(writes.declaration(link));
				}
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
		let values = this.locationValues[depth];
		if (!values) {
			values = [];
			this.locationValues[depth] = values;
			this.locationPaths[depth] = [];
		}
		let seen = this.locationSeen[depth];
		if (!seen) {
			seen = [];
			this.locationSeen[depth] = seen;
		}
		const generation = (this.locationGeneration[depth] || 0) + 1;
		this.locationGeneration[depth] = generation;
		values.length = 0;
		const alternatives = this.collectAlternatives(term, depth + 1);
		for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
			const alternative = alternatives[alternativeIndex];
			if (seen[alternative] !== generation) {
				seen[alternative] = generation;
				values.push(alternative);
			}
		}
		const relations = this.instantiation.values;
		const path = this.locationPaths[depth];
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
		return values;
	}

	private collectLocationRootAliases(term: TermID): readonly TermID[] {
		const revision = this.instantiation.values.count;
		let roots = this.locationRootAliases[term];
		if (this.locationRootAliasRevisions[term] === revision) {
			return roots;
		}
		if (!roots) {
			roots = [];
			this.locationRootAliases[term] = roots;
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
		this.locationRootAliasRevisions[term] = revision;
		return roots;
	}

	private collectPrototypeOwners(classTerm: TermID, depth: number): readonly TermID[] {
		const revision = this.instantiation.getRevision();
		let owners = this.prototypeOwners[classTerm];
		if (this.prototypeOwnerRevision[classTerm] === revision) {
			return owners;
		}
		if (!owners) {
			owners = [];
			this.prototypeOwners[classTerm] = owners;
		}
		owners.length = 0;
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
		this.prototypeOwnerRevision[classTerm] = revision;
		return owners;
	}

	private collectPrototypeSources(objectTerm: TermID, depth: number): readonly TermID[] {
		const revision = this.instantiation.getRevision();
		let sources = this.prototypeSources[objectTerm];
		if (this.prototypeSourceRevision[objectTerm] === revision) {
			return sources;
		}
		if (!sources) {
			sources = [];
			this.prototypeSources[objectTerm] = sources;
		}
		sources.length = 0;
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
		this.prototypeSourceRevision[objectTerm] = revision;
		return sources;
	}

	private collectSemanticPrototypeOwners(classTerm: TermID, depth: number): readonly TermID[] {
		const revision = this.instantiation.getRevision();
		let owners = this.semanticPrototypeOwners[classTerm];
		if (this.semanticPrototypeOwnerRevision[classTerm] === revision) {
			return owners;
		}
		if (!owners) {
			owners = [];
			this.semanticPrototypeOwners[classTerm] = owners;
		}
		owners.length = 0;
		const classes = this.collectLocationAlternatives(classTerm, depth + 1);
		const prototypes = this.instantiation.prototypes;
		for (let link = 1; link <= prototypes.count; link += 1) {
			const targets = this.collectAlternatives(prototypes.target(link), depth + 2);
			let matches = false;
			for (let targetIndex = 0; targetIndex < targets.length && !matches; targetIndex += 1) {
				for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
					if (targets[targetIndex] === classes[classIndex]) {
						matches = true;
						break;
					}
				}
			}
			const owner = prototypes.owner(link);
			if (matches && !owners.includes(owner)) {
				owners.push(owner);
			}
		}
		this.semanticPrototypeOwnerRevision[classTerm] = revision;
		return owners;
	}

	private collectSemanticPrototypeSources(objectTerm: TermID, depth: number): readonly TermID[] {
		const revision = this.instantiation.getRevision();
		let sources = this.semanticPrototypeSources[objectTerm];
		if (this.semanticPrototypeSourceRevision[objectTerm] === revision) {
			return sources;
		}
		if (!sources) {
			sources = [];
			this.semanticPrototypeSources[objectTerm] = sources;
		}
		sources.length = 0;
		const objects = this.collectLocationAlternatives(objectTerm, depth + 1);
		const prototypes = this.instantiation.prototypes;
		for (let link = 1; link <= prototypes.count; link += 1) {
			const owner = prototypes.owner(link);
			// Match each owner once, then consume its existing adjacency list.
			if (prototypes.first(owner) !== link) continue;
			const owners = this.collectLocationAlternatives(owner, depth + 2);
			let matches = false;
			for (let ownerIndex = 0; ownerIndex < owners.length && !matches; ownerIndex += 1) {
				for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
					if (owners[ownerIndex] === objects[objectIndex]) {
						matches = true;
						break;
					}
				}
			}
			if (matches) {
				for (let target = link; target !== 0; target = prototypes.next(target)) {
					const source = prototypes.target(target);
					if (!sources.includes(source)) sources.push(source);
				}
			}
		}
		this.semanticPrototypeSourceRevision[objectTerm] = revision;
		return sources;
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
