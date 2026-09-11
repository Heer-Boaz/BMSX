import { LuaSyntaxKind, type LuaExpression } from '../syntax/ast';
import type { Decl, FileSemanticData, SymbolID } from './model';
import { declarationValueSource, readLuaExpressionSource, type DeclarationValueEntry, type FunctionValueFlowEntry, type OwnedValueID, type SemanticValueSource, type ValueAssignmentEntry } from './value_graph';

/** A source occurrence, not a canonical value, storage location or runtime instance. */
export type LuaWrittenSource = {
	readonly file: FileSemanticData;
	readonly value: SemanticValueSource;
} & (
	| { readonly kind: 'expression'; readonly expression: LuaExpression }
	| { readonly kind: 'binding-input'; readonly declaration: Decl }
	| { readonly kind: 'receiver-input' }
	| { readonly kind: 'declaration-write'; readonly write: DeclarationValueEntry }
	| { readonly kind: 'value-transfer'; readonly write: ValueAssignmentEntry; readonly flow: FunctionValueFlowEntry | undefined }
);

export type LuaSourceBoundary = 'unknown-value' | 'unbound-global' | 'unwritten-binding'
	| 'access-path' | 'module' | 'call-result' | 'receiver' | 'parameter-input';

type LuaSourceContributions = { readonly kind: 'contributions'; readonly sources: readonly LuaWrittenSource[] };

export type LuaWrittenSourceInputs =
	| { readonly kind: 'terminal' }
	| LuaSourceContributions
	| { readonly kind: 'boundary'; readonly reason: LuaSourceBoundary };

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
const CALL: LuaWrittenSourceInputs = { kind: 'boundary', reason: 'call-result' };
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
	private readonly globals = new Map<string, LuaWrittenSourceInputs>();
	private globalDeclarations: ReadonlyMap<string, readonly Decl[]> | undefined;
	private readonly transfers = new Map<OwnedValueID, LuaSourceContributions>();
	private readonly receivers = new Map<OwnedValueID, LuaSourceContributions>();
	private readonly indexedFiles = new Set<FileSemanticData>();
	private readonly inputsBySource = new Map<LuaWrittenSource, LuaWrittenSourceInputs>();
	private readonly traces = new Map<LuaWrittenSource, LuaWrittenSourceTrace>();

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
		const value = source.value;
		if (value.steps.length !== 0) return ACCESS;
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
			case 'module': return MODULE;
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
					return transfer === undefined ? CALL : transfer;
				}
				return TERMINAL;
			}
		}
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
			sources.push({ kind: 'declaration-write', file, write, value: write.source });
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
