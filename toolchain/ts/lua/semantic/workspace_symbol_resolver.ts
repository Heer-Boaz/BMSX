import type { Decl, FileSemanticData, Ref, SymbolID } from './model';
import {
	WorkspaceValueGraph,
	WorkspaceValueIdentityIndex,
	type SemanticValueSource,
	type WorkspaceValueGraphInput,
} from './value_graph';
import { sourceRangesEqual } from '../source_range';
import { compareSourcePosition } from './source_range';

const EMPTY_SYMBOLS: readonly SymbolID[] = [];

// A resolver belongs to exactly one immutable workspace version. File analyses
// retain lexical bindings; workspace-dependent module, value-flow and global
// bindings are resolved against this version instead of being copied back into
// every unchanged file after an edit.
export class WorkspaceSymbolResolver {
	private readonly files: readonly FileSemanticData[];
	private readonly declarations: ReadonlyMap<SymbolID, Decl>;
	private readonly globals: ReadonlyMap<string, SymbolID>;
	private readonly valueGraphInput: WorkspaceValueGraphInput;
	private valueIdentities?: WorkspaceValueIdentityIndex;
	private valueGraph?: WorkspaceValueGraph;
	private readonly referenceTargets: Map<Ref, readonly SymbolID[]> = new Map();
	private readonly referencesBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly membersBySource: Map<string, readonly Decl[]> = new Map();

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: ReadonlyMap<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
	}) {
		this.files = options.files;
		this.declarations = options.declarations;
		this.globals = options.globals;
		this.valueGraphInput = {
			files: options.files,
			globalValues: options.globals,
		};
	}

	// disable-next-line single_line_method_pattern -- declaration lookup remains owned by the immutable workspace resolver.
	public getDeclaration(symbolId: SymbolID): Decl {
		return this.declarations.get(symbolId);
	}

	public resolveReference(ref: Ref): SymbolID | undefined {
		const targets = this.resolveReferenceTargets(ref);
		return targets.length === 1 ? targets[0] : undefined;
	}

	public resolveReferenceTargets(ref: Ref): readonly SymbolID[] {
		const cached = this.referenceTargets.get(ref);
		if (cached) {
			return cached;
		}
		const targets = this.resolveReferenceTargetsUncached(ref);
		this.referenceTargets.set(ref, targets);
		return targets;
	}

	private resolveReferenceTargetsUncached(
		ref: Ref,
		valueGraph?: WorkspaceValueGraph,
	): readonly SymbolID[] {
		if (ref.lexicalTarget) {
			return [ref.lexicalTarget];
		}
		if (ref.referenceKind === 'self') {
			return EMPTY_SYMBOLS;
		}
		if (ref.referenceKind === 'identifier' && ref.target) {
			return [ref.target];
		}
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			const staticMembers = this.getValueIdentities().resolveStaticMembers(
				ref.receiverValue,
				ref.name,
			);
			if (staticMembers) {
				return staticMembers;
			}
			if (!valueGraph) {
				valueGraph = this.getValueGraph().fork();
			}
			const members = valueGraph.resolveMembers(ref.receiverValue, ref.name);
			if (members.length > 0) {
				return members;
			}
		}
		if (ref.symbolKey.length === 0) {
			return EMPTY_SYMBOLS;
		}
		const global = this.globals.get(ref.symbolKey);
		return global ? [global] : EMPTY_SYMBOLS;
	}

	private getValueIdentities(): WorkspaceValueIdentityIndex {
		if (!this.valueIdentities) {
			this.valueIdentities = new WorkspaceValueIdentityIndex(this.valueGraphInput);
		}
		return this.valueIdentities;
	}

	private getValueGraph(): WorkspaceValueGraph {
		if (!this.valueGraph) {
			this.valueGraph = new WorkspaceValueGraph(this.valueGraphInput, this.getValueIdentities());
		}
		return this.valueGraph;
	}

	public getMembers(source: SemanticValueSource): readonly Decl[] {
		const identities = this.getValueIdentities();
		const key = identities.sourceKey(source);
		const cached = this.membersBySource.get(key);
		if (cached) {
			return cached;
		}
		const membersByName = new Map<string, Decl>();
		const memberIds = this.getValueGraph().fork().resolveAllMembers(source);
		for (let index = 0; index < memberIds.length; index += 1) {
			const declaration = this.declarations.get(memberIds[index]);
			if (!membersByName.has(declaration.name)) {
				membersByName.set(declaration.name, declaration);
			}
		}
		const members = Array.from(membersByName.values());
		members.sort((left, right) => {
			const name = left.name.localeCompare(right.name);
			if (name !== 0) {
				return name;
			}
			if (left.file !== right.file) {
				return left.file.localeCompare(right.file);
			}
			return compareSourcePosition(
				left.range.start.line,
				left.range.start.column,
				right.range.start.line,
				right.range.start.column,
			);
		});
		this.membersBySource.set(key, members);
		return members;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		const cached = this.referencesBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		this.resolveReferences([symbolId]);
		return this.referencesBySymbol.get(symbolId);
	}

	public getReferencesForSymbols(symbolIds: readonly SymbolID[]): readonly Ref[] {
		if (symbolIds.length === 1) {
			return this.getReferences(symbolIds[0]);
		}
		this.resolveReferences(symbolIds);
		const references: Ref[] = [];
		const retained = new Set<Ref>();
		for (let symbolIndex = 0; symbolIndex < symbolIds.length; symbolIndex += 1) {
			const symbolReferences = this.getReferences(symbolIds[symbolIndex]);
			for (let referenceIndex = 0; referenceIndex < symbolReferences.length; referenceIndex += 1) {
				const reference = symbolReferences[referenceIndex];
				if (!retained.has(reference)) {
					retained.add(reference);
					references.push(reference);
				}
			}
		}
		references.sort((left, right) => {
			if (left.file !== right.file) {
				return left.file.localeCompare(right.file);
			}
			return compareSourcePosition(
				left.range.start.line,
				left.range.start.column,
				right.range.start.line,
				right.range.start.column,
			);
		});
		return references;
	}

	private resolveReferences(symbolIds: readonly SymbolID[]): void {
		const unresolvedSymbols = new Set<SymbolID>();
		const names = new Set<string>();
		for (let symbolIndex = 0; symbolIndex < symbolIds.length; symbolIndex += 1) {
			const symbolId = symbolIds[symbolIndex];
			if (this.referencesBySymbol.has(symbolId)) {
				continue;
			}
			unresolvedSymbols.add(symbolId);
			names.add(this.declarations.get(symbolId).name);
		}
		if (unresolvedSymbols.size === 0) {
			return;
		}
		const candidates: Ref[] = [];
		let hasDynamicMemberCandidates = false;
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const referencesByName = this.files[fileIndex].referencesByName;
			for (const name of names) {
				const references = referencesByName.get(name);
				if (references) {
					for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
						const reference = references[referenceIndex];
						candidates.push(reference);
						if (!reference.lexicalTarget
							&& (reference.referenceKind === 'member' || reference.referenceKind === 'method')
							&& this.getValueIdentities().resolveStaticMembers(
								reference.receiverValue,
								reference.name,
							) === undefined) {
							hasDynamicMemberCandidates = true;
						}
					}
				}
			}
		}
		const references = new Map<SymbolID, Ref[]>();
		for (const symbolId of unresolvedSymbols) {
			references.set(symbolId, []);
		}
		// Candidate selection and semantic confirmation share one query-local
		// graph. Point navigation uses its own fork; workspace state is never
		// polluted by a references search.
		const valueGraph = hasDynamicMemberCandidates
			? this.getValueGraph().fork()
			: undefined;
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
			const candidate = candidates[candidateIndex];
			const targets = this.resolveReferenceTargetsUncached(candidate, valueGraph);
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const target = targets[targetIndex];
				const bucket = references.get(target);
				if (bucket && !sourceRangesEqual(candidate.range, this.declarations.get(target).range)) {
					bucket.push(candidate);
				}
			}
		}
		for (const [symbolId, symbolReferences] of references) {
			this.referencesBySymbol.set(symbolId, symbolReferences);
		}
	}
}
