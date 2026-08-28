import type { Decl, FileSemanticData, Ref, SymbolID } from './model';
import { WorkspaceValueGraph, type WorkspaceValueGraphInput } from './value_graph';
import { sourceRangesEqual } from '../source_range';
import { compareSourcePosition } from './source_range';
import { WorkspaceModuleMemberIndex } from './workspace_module_member_index';

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
	private moduleMemberIndex?: WorkspaceModuleMemberIndex;
	private valueGraph?: WorkspaceValueGraph;
	private readonly referencesBySymbol: Map<SymbolID, readonly Ref[]> = new Map();

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: ReadonlyMap<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
		valueGraphInput: WorkspaceValueGraphInput;
	}) {
		this.files = options.files;
		this.declarations = options.declarations;
		this.globals = options.globals;
		this.valueGraphInput = options.valueGraphInput;
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
			const moduleMembers = this.resolveModuleMembers(ref);
			if (moduleMembers) {
				return moduleMembers;
			}
			const valueGraph = this.getValueGraph();
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

	private resolveModuleMembers(ref: Ref): readonly SymbolID[] | undefined {
		if (!this.moduleMemberIndex) {
			this.moduleMemberIndex = new WorkspaceModuleMemberIndex(this.valueGraphInput);
		}
		return this.moduleMemberIndex.resolveMembers(ref.receiverValue, ref.name);
	}

	private getValueGraph(): WorkspaceValueGraph {
		if (!this.valueGraph) {
			this.valueGraph = new WorkspaceValueGraph(this.valueGraphInput);
		}
		return this.valueGraph;
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
		const memberQueries: Ref[] = [];
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const referencesByName = this.files[fileIndex].referencesByName;
			for (const name of names) {
				const references = referencesByName.get(name);
				if (references) {
					for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
						const reference = references[referenceIndex];
						candidates.push(reference);
						if (!reference.lexicalTarget
							&& (reference.referenceKind === 'member' || reference.referenceKind === 'method')) {
							memberQueries.push(reference);
						}
					}
				}
			}
		}
		if (memberQueries.length > 0) {
			let dynamicQueries: Ref[] | undefined;
			for (let queryIndex = 0; queryIndex < memberQueries.length; queryIndex += 1) {
				const query = memberQueries[queryIndex];
				if (this.resolveModuleMembers(query) !== undefined) {
					continue;
				}
				if (!dynamicQueries) {
					dynamicQueries = [];
				}
				dynamicQueries.push(query);
			}
			if (dynamicQueries) {
				this.getValueGraph().prepareMemberQueries(dynamicQueries);
			}
		}
		const references = new Map<SymbolID, Ref[]>();
		for (const symbolId of unresolvedSymbols) {
			references.set(symbolId, []);
		}
		for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
			const candidate = candidates[candidateIndex];
			const targets = this.resolveReferenceTargets(candidate);
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
