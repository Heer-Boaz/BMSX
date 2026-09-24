import { LuaSyntaxKind, type LuaCallExpression, type LuaFunctionExpression } from '../syntax/ast';
import type { ScopeID } from './scope_facts';
import { getLuaDeclaredFunctions, inferLuaFunctionSignatures, type FunctionSignatureInfo } from './function_signatures';
import type { HashLookup } from '../../collections/hash_map';
import type { Decl, FileSemanticData, LuaCallSite, Ref, SymbolID } from './model';
import { LuaSemanticQueryStore, type LuaSemanticQueryMetrics } from './query_store';
import {
	appendValueMember,
	declarationValueSource,
	type SemanticValueSource,
	type FunctionValueFlowEntry,
} from './value_graph';
import { LuaWrittenSourceQuery } from './written_sources';
import { getLuaWrittenDeclarations } from './written_declarations';
import { LuaDefinitionTypes } from './definition_types';
import { LuaModuleImportQuery } from './module_import_query';
import type { LuaSourceCallGraph } from './source_call_graph';
import type { LuaSourceValueQuery } from './source_value_query';

const EMPTY_SYMBOLS: readonly SymbolID[] = [];
const EMPTY_SIGNATURES: readonly FunctionSignatureInfo[] = [];

function sortMembers(members: Decl[], files: ReadonlyMap<string, FileSemanticData>): Decl[] {
	return members.sort((left, right) => {
		const name = left.name.localeCompare(right.name);
		if (name !== 0) {
			return name;
		}
		if (left.file !== right.file) {
			return left.file.localeCompare(right.file);
		}
		const locations = files.get(left.file)!.chunk.locations;
		return locations.offset(left.span.unit, left.span.start) - locations.offset(right.span.unit, right.span.start);
	});
}

function appendUniqueSymbols(target: SymbolID[], source: readonly SymbolID[]): void {
	for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
		const symbol = source[sourceIndex];
		if (!target.includes(symbol)) {
			target.push(symbol);
		}
	}
}

// A resolver belongs to exactly one immutable workspace version. The retained
// query store owns semantic summaries, instantiations and call facts for that
// version; unchanged FileSemanticData remains binder input rather than a heap.
export class WorkspaceSymbolResolver {
	private readonly files: readonly FileSemanticData[];
	private readonly dataByPath = new Map<string, FileSemanticData>();
	private readonly functionSignaturesBySymbol = new Map<SymbolID, readonly FunctionSignatureInfo[]>();
	private readonly functionSignaturesByFile = new Map<FileSemanticData, ReadonlyMap<ScopeID, FunctionSignatureInfo>>();
	private readonly declarations: HashLookup<SymbolID, Decl>;
	private readonly globals: ReadonlyMap<string, SymbolID>;
	private readonly globalStorage: readonly (readonly Decl[])[];
	private queryStore?: LuaSemanticQueryStore;
	private sourceQuery?: LuaWrittenSourceQuery;
	private moduleImportQuery?: LuaModuleImportQuery;
	private readonly referenceTargets: Map<Ref, readonly SymbolID[]> = new Map();
	private readonly definitionFunctionTargets: Map<SymbolID, readonly SymbolID[]> = new Map();
	private definitionTypeQuery?: LuaDefinitionTypes;
	private readonly callableTargets: Map<LuaCallSite, readonly SymbolID[]> = new Map();
	private readonly referencesBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly membersBySource: Map<SemanticValueSource, readonly Decl[]> = new Map();
	private readonly incomingCallsBySymbol: Map<SymbolID, readonly Ref[]> = new Map();
	private readonly outgoingCallsBySymbol:
		Map<SymbolID, readonly { readonly reference: Ref; readonly callee: SymbolID }[]> = new Map();

	constructor(options: {
		files: readonly FileSemanticData[];
		declarations: HashLookup<SymbolID, Decl>;
		globals: ReadonlyMap<string, SymbolID>;
		globalStorage: readonly (readonly Decl[])[];
	}) {
		this.files = options.files;
		for (const file of this.files) this.dataByPath.set(file.file, file);
		this.declarations = options.declarations;
		this.globals = options.globals;
		this.globalStorage = options.globalStorage;
	}

	public getFileData(path: string): FileSemanticData | undefined {
		return this.dataByPath.get(path);
	}

	// disable-next-line single_line_method_pattern -- declaration lookup remains owned by the immutable workspace resolver.
	public getDeclaration(symbolId: SymbolID): Decl {
		return this.declarations.get(symbolId);
	}

	/** Source tracking consumes binder facts without activating the may-call solver. */
	public get writtenSources(): LuaWrittenSourceQuery {
		if (this.sourceQuery === undefined) this.sourceQuery = new LuaWrittenSourceQuery(this.files, this.declarations, this.globalStorage);
		return this.sourceQuery;
	}

	public get moduleImports(): LuaModuleImportQuery {
		if (this.moduleImportQuery === undefined) this.moduleImportQuery = new LuaModuleImportQuery(this.files);
		return this.moduleImportQuery;
	}

	public callSources(callSite: LuaCallSite): LuaSourceCallGraph {
		return this.getQueryStore().callSources(callSite.call);
	}

	public get contextualSources(): LuaSourceValueQuery {
		return this.getQueryStore().contextualSources(this.writtenSources);
	}

	public resolveReference(ref: Ref): SymbolID | undefined {
		// Identifier bindings already have scalar identity. Diagnostics and
		// lowering need no navigation target list or retained per-reference array.
		if (ref.referenceKind === 'identifier' || ref.referenceKind === 'self') {
			if (ref.call?.module !== undefined) return undefined;
			if (ref.target !== undefined) return ref.target;
			return ref.referenceKind === 'identifier' ? this.globals.get(ref.symbolKey) : undefined;
		}
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

	/**
	 * The may-call solver's answer for a reference: what the value can be given
	 * everything the program writes and calls. Whole-program features only;
	 * interactive queries use `resolveReferenceTargets`.
	 */
	public resolveWholeProgramReferenceTargets(ref: Ref): readonly SymbolID[] {
		if (!ref.target && (ref.referenceKind === 'member' || ref.referenceKind === 'method')) {
			return this.getQueryStore().member(ref.receiverValue, ref.name);
		}
		return this.resolveReferenceTargets(ref);
	}

	/** The may-call solver's members of a value; see `resolveWholeProgramReferenceTargets`. */
	public getWholeProgramMembers(source: SemanticValueSource): readonly Decl[] {
		const membersByName = new Map<string, Decl>();
		for (const memberId of this.getQueryStore().allMembers(source)) {
			const declaration = this.declarations.get(memberId);
			if (!membersByName.has(declaration.name)) membersByName.set(declaration.name, declaration);
		}
		return sortMembers(Array.from(membersByName.values()), this.dataByPath);
	}

	/** The may-call solver's callees of a call site; see `resolveWholeProgramReferenceTargets`. */
	public resolveWholeProgramCallableTargets(callSite: LuaCallSite): readonly SymbolID[] {
		const targets: SymbolID[] = [];
		const call = callSite.reference?.call;
		if (call) {
			for (const fact of this.getQueryStore().callee(call)) {
				if (!targets.includes(fact.calleeFn)) targets.push(fact.calleeFn);
			}
		} else if (callSite.directTarget !== undefined) {
			appendUniqueSymbols(targets, this.getQueryStore().functions(declarationValueSource(callSite.directTarget)));
		} else if (callSite.calleeValue !== undefined) {
			appendUniqueSymbols(targets, this.getQueryStore().functions(callSite.calleeValue));
		}
		return targets;
	}

	/** Declared functions a call site's callee is defined as. */
	public resolveCallableTargets(callSite: LuaCallSite): readonly SymbolID[] {
		if (callSite.call.module !== undefined) return EMPTY_SYMBOLS;
		const retained = this.callableTargets.get(callSite);
		if (retained) {
			return retained;
		}
		const callee = callSite.call.callee;
		const targets = [...this.definitionTypes.functionDeclarations(callee)];
		if (callee.steps.length > 0) {
			const file = this.dataByPath.get(callSite.call.file)!;
			for (const declaration of getLuaWrittenDeclarations(file, callee)) {
				appendUniqueSymbols(targets, this.resolveDefinitionFunctionTargets(declaration));
			}
		}
		this.callableTargets.set(callSite, targets);
		return targets;
	}

	/**
	 * Functions a binding is defined as. Like a language server's definition
	 * lookup, this never asks what other code may write or call.
	 */
	public resolveDefinitionFunctionTargets(symbolId: SymbolID): readonly SymbolID[] {
		const retained = this.definitionFunctionTargets.get(symbolId);
		if (retained) {
			return retained;
		}
		const targets = this.definitionTypes.functionDeclarations(declarationValueSource(symbolId));
		this.definitionFunctionTargets.set(symbolId, targets);
		return targets;
	}

	/** Written function definitions expose their headers without optionality inference. */
	public getDeclaredFunctions(symbolId: SymbolID): readonly FunctionValueFlowEntry[] {
		const declaration = this.declarations.get(symbolId);
		return getLuaDeclaredFunctions(this.dataByPath.get(declaration.file)!, symbolId);
	}

	/** Required-argument analysis is a signature/diagnostic demand, not a hover demand. */
	public getFunctionSignatures(symbolId: SymbolID): readonly FunctionSignatureInfo[] {
		const retained = this.functionSignaturesBySymbol.get(symbolId);
		if (retained !== undefined) return retained;
		const functions = this.getDeclaredFunctions(symbolId);
		if (functions.length === 0) return EMPTY_SIGNATURES;
		const signatures = functions.map(flow => this.signatureOfFunction(flow));
		this.functionSignaturesBySymbol.set(symbolId, signatures);
		return signatures;
	}

	private signatureOfFunction(flow: FunctionValueFlowEntry): FunctionSignatureInfo {
		const file = this.dataByPath.get(flow.functionValue.root.file)!;
		let signatures = this.functionSignaturesByFile.get(file);
		if (signatures === undefined) {
			const calls = new Map<LuaCallExpression, LuaCallSite>();
			for (const site of file.callSites) calls.set(site.expression, site);
			const functions = new Map<LuaFunctionExpression, FunctionValueFlowEntry>();
			for (const definition of file.functionValueFlows) functions.set(definition.expression, definition);
			signatures = inferLuaFunctionSignatures(file, expression => {
				if (expression.method === null && expression.callee.kind === LuaSyntaxKind.FunctionExpression) {
					return functions.get(expression.callee);
				}
				// Optionality reads only direct written destinations in this file.
				// Aliases, inferred receiver values and other files remain unknown;
				// this is not another value-shape query or parameter/effect solver.
				const site = calls.get(expression)!;
				const source = site.directTarget === undefined ? site.call.callee : declarationValueSource(site.directTarget);
				let definition: FunctionValueFlowEntry | undefined;
				for (const target of getLuaWrittenDeclarations(file, source)) {
					for (const candidate of getLuaDeclaredFunctions(file, target)) {
						if (definition !== undefined && definition !== candidate) return undefined;
						definition = candidate;
					}
				}
				return definition;
			}, !this.globals.has('type'));
			this.functionSignaturesByFile.set(file, signatures);
		}
		return signatures.get(flow.id)!;
	}

	/** Definition-based shapes serving every interactive query. */
	public get definitionTypes(): LuaDefinitionTypes {
		if (this.definitionTypeQuery === undefined) {
			const definitions = new Map<string, SymbolID[]>();
			for (const declarations of this.globalStorage) {
				for (const declaration of declarations) {
					let bucket = definitions.get(declaration.symbolKey);
					if (bucket === undefined) definitions.set(declaration.symbolKey, bucket = []);
					bucket.push(declaration.id);
				}
			}
			this.definitionTypeQuery = new LuaDefinitionTypes(this.files, this.declarations, definitions);
		}
		return this.definitionTypeQuery;
	}

	public getMembers(source: SemanticValueSource): readonly Decl[] {
		const cached = this.membersBySource.get(source);
		if (cached) {
			return cached;
		}
		const membersByName = new Map<string, Decl>();
		for (const [name, declarations] of this.definitionTypes.visibleMembers(this.definitionTypes.shapesOf(source))) {
			membersByName.set(name, declarations[0]);
		}
		const members = sortMembers(Array.from(membersByName.values()), this.dataByPath);
		this.membersBySource.set(source, members);
		return members;
	}

	public getReferences(symbolId: SymbolID): readonly Ref[] {
		const cached = this.referencesBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		this.resolveReferences([symbolId]);
		return this.referencesBySymbol.get(symbolId) as readonly Ref[];
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
			const locations = this.dataByPath.get(left.file)!.chunk.locations;
			return locations.offset(left.span.unit, left.span.start) - locations.offset(right.span.unit, right.span.start);
		});
		return references;
	}

	public incomingCalls(symbolId: SymbolID): readonly Ref[] {
		const cached = this.incomingCallsBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		const facts = this.getQueryStore().incoming(symbolId, this.declarations.get(symbolId).name);
		const references = new Array<Ref>(facts.length);
		for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
			references[factIndex] = facts[factIndex].reference;
		}
		this.incomingCallsBySymbol.set(symbolId, references);
		return references;
	}

	public outgoingCalls(symbolId: SymbolID): readonly { readonly reference: Ref; readonly callee: SymbolID }[] {
		const cached = this.outgoingCallsBySymbol.get(symbolId);
		if (cached) {
			return cached;
		}
		const facts = this.getQueryStore().outgoing(symbolId);
		const calls = new Array<{ readonly reference: Ref; readonly callee: SymbolID }>(facts.length);
		for (let factIndex = 0; factIndex < facts.length; factIndex += 1) {
			calls[factIndex] = {
				reference: facts[factIndex].reference,
				callee: facts[factIndex].calleeFn,
			};
		}
		this.outgoingCallsBySymbol.set(symbolId, calls);
		return calls;
	}

	public getSemanticQueryMetrics(): LuaSemanticQueryMetrics {
		return this.getQueryStore().metrics();
	}

	private resolveReferenceTargetsUncached(ref: Ref): readonly SymbolID[] {
		if (ref.call?.module !== undefined) return EMPTY_SYMBOLS;
		if (ref.referenceKind === 'member' || ref.referenceKind === 'method') {
			const declarations = this.definitionTypes.lookupMember(this.definitionTypes.shapesOf(ref.receiverValue), ref.name);
			const targets = declarations.map(declaration => declaration.id);
			// Exact authored paths are evidence independently of receiver values;
			// they do not infer a parameter or invent a table for an unknown value.
			appendUniqueSymbols(targets, getLuaWrittenDeclarations(this.dataByPath.get(ref.file)!, appendValueMember(ref.receiverValue, ref.name)));
			// Dynamic/unknown owners cannot be matched to other uses, but the
			// authored write still names its own definition occurrence.
			if (ref.target !== undefined && !targets.includes(ref.target)) targets.push(ref.target);
			return targets;
		}
		const target = this.resolveReference(ref);
		return target === undefined ? EMPTY_SYMBOLS : [target];
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
		for (let fileIndex = 0; fileIndex < this.files.length; fileIndex += 1) {
			const referencesByName = this.files[fileIndex].referencesByName;
			for (const name of names) {
				const references = referencesByName.get(name);
				if (references) {
					for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
						candidates.push(references[referenceIndex]);
					}
				}
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
				if (!bucket) continue;
				const declaration = this.declarations.get(target);
				const candidateLocations = this.dataByPath.get(candidate.file)!.chunk.locations;
				const declarationLocations = this.dataByPath.get(declaration.file)!.chunk.locations;
				if (candidateLocations.path === declarationLocations.path
					&& candidateLocations.offset(candidate.span.unit, candidate.span.start) === declarationLocations.offset(declaration.span.unit, declaration.span.start)
					&& candidateLocations.offset(candidate.span.unit, candidate.span.end) === declarationLocations.offset(declaration.span.unit, declaration.span.end)) continue;
				bucket.push(candidate);
			}
		}
		for (const [symbolId, symbolReferences] of references) {
			this.referencesBySymbol.set(symbolId, symbolReferences);
		}
	}

	private getQueryStore(): LuaSemanticQueryStore {
		if (!this.queryStore) {
			this.queryStore = new LuaSemanticQueryStore(this.files, this.globals);
		}
		return this.queryStore;
	}
}
