import { isMultiReturnExpression, LuaSyntaxKind, type LuaCallExpression, type LuaExpression, type LuaReturnStatement } from '../syntax/ast';
import { LuaCompletion } from '../analysis/completion';
import type { Decl, FileSemanticData, SymbolID } from './model';
import { declarationValueSource, NIL_VALUE_SOURCE, readLuaExpressionSource, unknownValueSource, type CallValueEntry, type DeclarationValueEntry, type FunctionReturnValueEntry, type FunctionValueFlowEntry, type ModuleValueEntry, type OwnedValueID, type SemanticValueSource, type ValueAssignmentEntry } from './value_graph';

/** A source occurrence, not a canonical value, storage location or runtime instance. */
export type LuaWrittenSource = {
	readonly file: FileSemanticData;
	readonly value: SemanticValueSource;
} & (
	| { readonly kind: 'expression'; readonly expression: LuaExpression }
	| { readonly kind: 'member-base'; readonly read: LuaWrittenSource }
	| { readonly kind: 'binding-input'; readonly declaration: Decl }
	| { readonly kind: 'receiver-input' }
	| { readonly kind: 'module-export'; readonly export: ModuleValueEntry }
	| { readonly kind: 'module-bypass'; readonly statement: LuaReturnStatement }
	| { readonly kind: 'declaration-write'; readonly write: DeclarationValueEntry }
	| { readonly kind: 'value-transfer'; readonly write: ValueAssignmentEntry; readonly flow: FunctionValueFlowEntry | undefined }
	| { readonly kind: 'call-input'; readonly call: CallValueEntry; readonly index: number }
	| { readonly kind: 'call-callee'; readonly call: CallValueEntry }
	| { readonly kind: 'function-return'; readonly entry: FunctionReturnValueEntry }
	| { readonly kind: 'function-completion'; readonly body: FunctionValueFlowEntry }
);

export type LuaSourceBoundary = 'unknown-value' | 'unbound-global' | 'unwritten-binding'
	| 'access-path' | 'member-read' | 'unwritten-member' | 'module' | 'module-publication' | 'call-result' | 'receiver' | 'parameter-input';

type LuaSourceContributions = { readonly kind: 'contributions'; readonly sources: readonly LuaWrittenSource[] };

export type LuaWrittenSourceInputs =
	| { readonly kind: 'terminal' }
	| LuaSourceContributions
	| { readonly kind: 'boundary'; readonly reason: Exclude<LuaSourceBoundary, 'call-result' | 'member-read'> }
	| { readonly kind: 'boundary'; readonly reason: 'member-read'; readonly name: string; readonly base: LuaWrittenSource }
	| { readonly kind: 'boundary'; readonly reason: 'call-result'; readonly call: CallValueEntry };

/** A retained reachable source graph. Boundaries are not silently discarded origins. */
export type LuaWrittenSourceTrace = {
	readonly root: LuaWrittenSource;
	readonly sources: readonly LuaWrittenSource[];
	readonly terminals: readonly LuaWrittenSource[];
	readonly boundaries: readonly { readonly source: LuaWrittenSource; readonly reason: LuaSourceBoundary }[];
};

const TERMINAL: LuaWrittenSourceInputs = { kind: 'terminal' };
const UNKNOWN: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'unknown-value' };
const ACCESS: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'access-path' };
const MODULE: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'module' };
const MODULE_PUBLICATION: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'module-publication' };
const RECEIVER: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'receiver' };
const UNBOUND: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'unbound-global' };
const UNWRITTEN: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'unwritten-binding' };
const PARAMETER: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'parameter-input' };

/**
 * Written-value tracking over immutable binder facts. Unlike the may-value solver,
 * equal values never merge source occurrences, and a body write is not execution proof.
 * Call applications and access paths are explicit query boundaries, not guessed aliases.
 */
export class LuaWrittenSourceQuery {
	private readonly filesByPath = new Map<string, FileSemanticData>();
	private readonly expressions = new Map<FileSemanticData, Map<LuaExpression, LuaWrittenSource>>();
	private readonly declarations = new Map<SymbolID, LuaSourceContributions>();
	private readonly writes = new Map<DeclarationValueEntry, LuaWrittenSource>();
	private readonly globals = new Map<string, LuaWrittenSourceInputs>();
	private globalDeclarations: ReadonlyMap<string, readonly Decl[]> | undefined;
	private modules: ReadonlyMap<string, LuaSourceContributions> | undefined;
	private readonly transfers = new Map<OwnedValueID, LuaSourceContributions>();
	private readonly receivers = new Map<OwnedValueID, LuaSourceContributions>();
	private readonly indexedFiles = new Set<FileSemanticData>();
	private readonly inputsBySource = new Map<LuaWrittenSource, LuaWrittenSourceInputs>();
	private readonly traces = new Map<LuaWrittenSource, LuaWrittenSourceTrace>();
	private readonly callInputs = new Map<CallValueEntry, LuaWrittenSource[]>();
	private readonly callees = new Map<CallValueEntry, LuaWrittenSource>();
	private readonly returnInputs = new Map<FunctionValueFlowEntry, readonly LuaWrittenSource[]>();
	private readonly callsByFile = new Map<FileSemanticData, ReadonlyMap<LuaCallExpression, CallValueEntry>>();

	public constructor(files: readonly FileSemanticData[], private readonly symbols: ReadonlyMap<SymbolID, Decl>) {
		for (const file of files) this.filesByPath.set(file.file, file);
	}

	public expression(file: FileSemanticData, expression: LuaExpression): LuaWrittenSource {
		let expressions = this.expressions.get(file);
		if (expressions === undefined) {
			expressions = new Map();
			this.expressions.set(file, expressions);
		}
		let source = expressions.get(expression);
		if (source === undefined) {
			source = { kind: 'expression', file, expression, value: readLuaExpressionSource(file, expression) };
			expressions.set(expression, source);
		}
		return source;
	}

	/** A binding read and a field witness share the very same authored occurrence. */
	public write(write: DeclarationValueEntry): LuaWrittenSource {
		let source = this.writes.get(write);
		if (source === undefined) {
			source = { kind: 'declaration-write', file: this.filesByPath.get(write.syntax.range.path)!, write, value: write.source };
			this.writes.set(write, source);
		}
		return source;
	}

	/** Semantic argument lanes include a method receiver; source identity remains its AST. */
	public argument(call: CallValueEntry, index: number): LuaWrittenSource {
		let inputs = this.callInputs.get(call);
		if (inputs === undefined) { inputs = []; this.callInputs.set(call, inputs); }
		let input = inputs[index];
		if (input !== undefined) return input;
		const syntax = call.expression;
		const file = this.filesByPath.get(syntax.range.path)!;
		const receiver = syntax.method !== null;
		const expression = receiver && index === 0 ? syntax.callee : syntax.arguments[index - (receiver ? 1 : 0)];
		if (expression !== undefined) input = this.expression(file, expression);
		else {
			const last = syntax.arguments[syntax.arguments.length - 1];
			input = { kind: 'call-input', file, call, index,
				value: last !== undefined && isMultiReturnExpression(last) ? unknownValueSource() : NIL_VALUE_SOURCE };
		}
		inputs[index] = input;
		return input;
	}

	/** The bound callable includes a colon call's member, not just its written receiver. */
	public callee(call: CallValueEntry): LuaWrittenSource {
		let source = this.callees.get(call);
		if (source === undefined) {
			source = { kind: 'call-callee', file: this.filesByPath.get(call.expression.range.path)!, call, value: call.callee };
			this.callees.set(call, source);
		}
		return source;
	}

	/** First-result source occurrences, including empty returns and body fallthrough. */
	public returns(body: FunctionValueFlowEntry): readonly LuaWrittenSource[] {
		let inputs = this.returnInputs.get(body);
		if (inputs !== undefined) return inputs;
		const file = this.filesByPath.get(body.expression.range.path)!;
		const sources: LuaWrittenSource[] = [];
		for (const entry of body.returns) sources.push({ kind: 'function-return', file, entry, value: entry.firstValue });
		if (body.completion & LuaCompletion.Fallthrough) {
			sources.push({ kind: 'function-completion', file, body, value: NIL_VALUE_SOURCE });
		}
		if (body.completion & LuaCompletion.Unresolved) {
			sources.push({ kind: 'function-completion', file, body, value: unknownValueSource() });
		}
		inputs = sources;
		this.returnInputs.set(body, inputs);
		return inputs;
	}

	/** Retained syntax-to-fact lookup, not a second callee classifier. */
	private call(file: FileSemanticData, expression: LuaCallExpression): CallValueEntry {
		let calls = this.callsByFile.get(file);
		if (calls === undefined) {
			const bySyntax = new Map<LuaCallExpression, CallValueEntry>();
			for (const site of file.callSites) bySyntax.set(site.expression, site.call);
			calls = bySyntax;
			this.callsByFile.set(file, calls);
		}
		return calls.get(expression)!;
	}

	public inputs(source: LuaWrittenSource): LuaWrittenSourceInputs {
		let inputs = this.inputsBySource.get(source);
		if (inputs === undefined) {
			inputs = this.readInputs(source);
			this.inputsBySource.set(source, inputs);
		}
		return inputs;
	}

	/** No recursive stack or per-node transitive copying; cycles remain edges in the graph. */
	public trace(root: LuaWrittenSource): LuaWrittenSourceTrace {
		let trace = this.traces.get(root);
		if (trace !== undefined) return trace;
		const sources: LuaWrittenSource[] = [root];
		const terminals: LuaWrittenSource[] = [];
		const boundaries: { source: LuaWrittenSource; reason: LuaSourceBoundary }[] = [];
		const seen = new Set<LuaWrittenSource>(sources);
		for (let cursor = 0; cursor < sources.length; cursor += 1) {
			const source = sources[cursor];
			const inputs = this.inputs(source);
			if (inputs.kind === 'terminal') terminals.push(source);
			else if (inputs.kind === 'boundary') boundaries.push({ source, reason: inputs.reason });
			else for (const input of inputs.sources) {
				if (!seen.has(input)) {
					seen.add(input);
					sources.push(input);
				}
			}
		}
		trace = { root, sources, terminals, boundaries };
		this.traces.set(root, trace);
		return trace;
	}

	private readInputs(source: LuaWrittenSource): LuaWrittenSourceInputs {
		if (source.kind === 'binding-input') return source.declaration.kind === 'parameter' ? PARAMETER : UNWRITTEN;
		if (source.kind === 'receiver-input') return RECEIVER;
		if (source.kind === 'module-bypass') return MODULE_PUBLICATION;
		const value = source.value;
		if (value.steps.length !== 0) {
			const step = value.steps[value.steps.length - 1];
			if (step.kind !== 'member') return ACCESS;
			const base: LuaWrittenSource = { kind: 'member-base', read: source, file: source.file,
				value: { root: value.root, steps: value.steps.slice(0, -1) } };
			return { kind: 'boundary', reason: 'member-read', name: step.name, base };
		}
		const root = value.root;
		switch (root.kind) {
			case 'unknown': return UNKNOWN;
			case 'literal': return TERMINAL;
			case 'declaration': {
				const declaration = this.symbols.get(root.declId)!;
				return declaration.isGlobal && declaration.namePath.length === 1
					? this.globalInputs(declaration.symbolKey) : this.declarationInputs(declaration);
			}
			case 'global': return this.globalInputs(root.symbolKey);
			case 'module': return this.moduleInputs(root.module);
			case 'owned': {
				if (root.role === 'receiver') {
					let inputs = this.receivers.get(root.id);
					if (inputs === undefined) {
						this.indexTransfers(source.file);
						const sources: LuaWrittenSource[] = [{ kind: 'receiver-input', file: source.file, value }];
						const writes = this.transfers.get(root.id);
						if (writes !== undefined) for (const write of writes.sources) sources.push(write);
						inputs = { kind: 'contributions', sources };
						this.receivers.set(root.id, inputs);
					}
					return inputs;
				}
				if (root.syntax.kind === LuaSyntaxKind.CallExpression || root.syntax.kind === LuaSyntaxKind.BinaryExpression) {
					this.indexTransfers(source.file);
					if (root.syntax.kind === LuaSyntaxKind.BinaryExpression) return this.transfers.get(root.id)!;
					const transfer = this.transfers.get(root.id);
					return transfer === undefined
						? { kind: 'boundary', reason: 'call-result', call: this.call(source.file, root.syntax) } : transfer;
				}
				return TERMINAL;
			}
		}
	}

	/** Only the canonical export is a value edge; earlier returns are control evidence. */
	private moduleInputs(name: string): LuaWrittenSourceInputs {
		if (this.modules === undefined) {
			const modules = new Map<string, { kind: 'contributions'; sources: LuaWrittenSource[] }>();
			for (const file of this.filesByPath.values()) for (const entry of file.moduleValues) {
				let inputs = modules.get(entry.module);
				if (inputs === undefined) {
					inputs = { kind: 'contributions', sources: [] };
					modules.set(entry.module, inputs);
				}
				inputs.sources.push({ kind: 'module-export', file, export: entry, value: entry.source });
				for (const statement of entry.bypassingReturns) {
					inputs.sources.push({ kind: 'module-bypass', file, statement, value: unknownValueSource() });
				}
			}
			this.modules = modules;
		}
		const inputs = this.modules.get(name);
		return inputs === undefined ? MODULE : inputs;
	}

	private declarationInputs(declaration: Decl): LuaSourceContributions {
		const symbol = declaration.id;
		let inputs = this.declarations.get(symbol);
		if (inputs !== undefined) return inputs;
		const file = this.filesByPath.get(declaration.file)!;
		const writes = file.declarationValuesByDeclaration.get(symbol);
		const parameter = declaration.kind === 'parameter';
		const sources: LuaWrittenSource[] = [];
		if (parameter || writes === undefined) sources.push({ kind: 'binding-input', file, declaration, value: declarationValueSource(symbol) });
		if (writes !== undefined) for (const write of writes) {
			sources.push(this.write(write));
		}
		inputs = { kind: 'contributions', sources };
		this.declarations.set(symbol, inputs);
		return inputs;
	}

	/** Global storage has writes in every declaring file, not only the navigation winner. */
	private globalInputs(name: string): LuaWrittenSourceInputs {
		let inputs = this.globals.get(name);
		if (inputs !== undefined) return inputs;
		if (this.globalDeclarations === undefined) {
			const declarations = new Map<string, Decl[]>();
			for (const declaration of this.symbols.values()) {
				if (!declaration.isGlobal || declaration.namePath.length !== 1) continue;
				let group = declarations.get(declaration.symbolKey);
				if (group === undefined) {
					group = [];
					declarations.set(declaration.symbolKey, group);
				}
				group.push(declaration);
			}
			this.globalDeclarations = declarations;
		}
		const declarations = this.globalDeclarations.get(name);
		if (declarations === undefined) inputs = UNBOUND;
		else {
			const sources: LuaWrittenSource[] = [];
			for (const declaration of declarations) {
				for (const source of this.declarationInputs(declaration).sources) sources.push(source);
			}
			inputs = { kind: 'contributions', sources };
		}
		this.globals.set(name, inputs);
		return inputs;
	}

	private indexTransfers(file: FileSemanticData): void {
		if (this.indexedFiles.has(file)) return;
		this.indexedFiles.add(file);
		const transfers = new Map<OwnedValueID, LuaWrittenSource[]>();
		this.collectTransfers(file, file.valueAssignments, undefined, transfers);
		for (const flow of file.functionValueFlows) this.collectTransfers(file, flow.assignments, flow, transfers);
		for (const [root, sources] of transfers) this.transfers.set(root, { kind: 'contributions', sources });
	}

	private collectTransfers(file: FileSemanticData, writes: readonly ValueAssignmentEntry[],
		flow: FunctionValueFlowEntry | undefined, transfers: Map<OwnedValueID, LuaWrittenSource[]>): void {
		for (const write of writes) {
			const target = write.target;
			if (write.relation !== 'value' || target.steps.length !== 0 || target.root.kind !== 'owned') continue;
			let sources = transfers.get(target.root.id);
			if (sources === undefined) {
				sources = [];
				transfers.set(target.root.id, sources);
			}
			sources.push({ kind: 'value-transfer', file, write, flow, value: write.source });
		}
	}
}
