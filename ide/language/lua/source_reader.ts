import { LuaBinaryOperator, LuaSyntaxKind, LuaTableFieldKind, type LuaExpression, type LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import { writtenSourceExpression, type LuaWrittenExpression } from '../../../toolchain/ts/lua/semantic/written_sources';
import type { LuaAuthoredSourceTrace } from '../../../toolchain/ts/lua/semantic/authored_sources';
import type { CallValueEntry } from '../../../toolchain/ts/lua/semantic/value_graph';
import { readLuaNumberExpression } from '../../../toolchain/ts/lua/syntax/number_expression';

export type LuaWrittenProducer = { readonly kind: 'value' | 'definition' | 'call'; readonly source: LuaWrittenExpression };
type OwnMemberRead = 'value' | 'raw';

/** Source-level truthiness, not host-value classification or guest execution.
 * Null is a proved unwritten member; undefined is unresolved source. */
export function readLuaSourceTruth(source: LuaWrittenExpression | null | undefined): boolean | undefined {
	if (source === undefined) return;
	if (source === null || source.expression.kind === LuaSyntaxKind.NilLiteralExpression) return false;
	const expression = source.expression;
	if (expression.kind === LuaSyntaxKind.BooleanLiteralExpression) return expression.value;
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression || expression.kind === LuaSyntaxKind.StringLiteralExpression
		|| expression.kind === LuaSyntaxKind.TableConstructorExpression || expression.kind === LuaSyntaxKind.FunctionExpression
		|| readLuaNumberExpression(expression) !== null) return true;
	return undefined;
}

/** Source projection over one workspace, not an evaluator or a runtime instance resolver. */
export class LuaSourceReader {
	public readonly files = new Set<FileSemanticData>();
	public syntaxComplete = true;
	private readonly traces = new Set<LuaAuthoredSourceTrace>();
	private readonly strings = new Map<LuaWrittenExpression, string | undefined>();
	private readonly prototypes = new Map<LuaTableConstructorExpression, LuaWrittenExpression | null | undefined>();

	public constructor(public readonly snapshot: LuaSemanticWorkspaceSnapshot) {}

	/** A unique written value source; competing/unknown contributions remain unresolved. */
	public expression(file: FileSemanticData, expression: LuaExpression): LuaWrittenExpression | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.resolve(this.snapshot.symbolResolver.authoredSources.trace(query.expression(file, expression)));
	}

	/** The admitted single module publication, not a runtime require invocation. */
	public module(file: FileSemanticData, specifier: string): LuaWrittenExpression | undefined {
		const path = this.snapshot.symbolResolver.moduleImports.resolveModule(file.file, specifier);
		if (path === undefined) return;
		const owner = this.snapshot.getFileData(path)!, publication = owner.moduleValues[0];
		if (owner.syntaxError !== null || publication === undefined || publication.bypassingReturns.length !== 0) return;
		return this.expression(owner, publication.statement.expressions[0]);
	}

	/** A unique callable's authored identity. Import provenance alone does not
	 * grant this proof when the callable's member has competing/unknown writes. */
	public callable(file: FileSemanticData, expression: LuaExpression): LuaWrittenExpression | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		const source = this.resolve(this.snapshot.symbolResolver.authoredSources.trace(query.expression(file, expression)), 'value');
		return source?.expression.kind === LuaSyntaxKind.FunctionExpression ? source : undefined;
	}

	/** String content over this immutable snapshot, independent of represented source ownership. */
	public stringValue(file: FileSemanticData, expression: LuaExpression): string | undefined {
		const source = this.snapshot.symbolResolver.writtenSources.expression(file, expression);
		if (this.strings.has(source)) return this.strings.get(source);
		// Recursive authored aliases remain unknown; repeated queries share this source-generation cache.
		this.strings.set(source, undefined);
		const trace = this.snapshot.symbolResolver.authoredSources.trace(source);
		const resolved = this.selectExpression(trace)?.expression;
		let value: string | undefined;
		if (resolved?.kind === LuaSyntaxKind.StringLiteralExpression) value = resolved.value;
		else if (trace.terminals.length === 0 && trace.boundaries.length === 1 && trace.boundaries[0].reason === 'unknown-value') {
			const boundary = trace.boundaries[0].source;
			const syntax = writtenSourceExpression(boundary);
			if (syntax?.kind === LuaSyntaxKind.BinaryExpression && syntax.operator === LuaBinaryOperator.Concat) {
				const left = this.stringValue(boundary.file, syntax.left);
				const right = this.stringValue(boundary.file, syntax.right);
				if (left !== undefined && right !== undefined) value = left + right;
			}
		}
		this.strings.set(source, value);
		return value;
	}

	/** A written Lua numeric expression or alias, not executable arithmetic. */
	public numberValue(file: FileSemanticData, expression: LuaExpression): number | undefined {
		const source = this.expression(file, expression);
		const value = source === undefined ? null : readLuaNumberExpression(source.expression);
		return value === null ? undefined : value;
	}

	/** A complete authored numeric sequence, not an inferred runtime table length. */
	public numberSequence(file: FileSemanticData, expression: LuaExpression): readonly number[] | undefined {
		const source = this.expression(file, expression);
		if (source?.expression.kind !== LuaSyntaxKind.TableConstructorExpression
			|| this.snapshot.symbolResolver.authoredSources.tableMutations().has(source.expression)) return;
		const values: number[] = [];
		for (const field of source.expression.fields) {
			if (field.kind !== LuaTableFieldKind.Array) return;
			const value = this.numberValue(source.file, field.value);
			if (value === undefined) return;
			values.push(value);
		}
		return values;
	}

	/** Select a field's authored source independently of mutation in the field's descendants. */
	public member(file: FileSemanticData, expression: LuaExpression, name: string): LuaWrittenExpression | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.resolve(this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name), 'value');
	}

	/** A unique value, a proved unwritten member (null), or unresolved source
	 * (undefined). Optional authored defaults require the unwritten proof;
	 * an unknown/computed write is not an absent field. */
	public memberState(file: FileSemanticData, expression: LuaExpression, name: string): LuaWrittenExpression | null | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		const trace = this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name);
		const source = this.resolve(trace, 'value');
		if (source !== undefined) return source;
		if (trace.terminals.length === 0 && trace.boundaries.length === 1) {
			const boundary = trace.boundaries[0];
			if (boundary.reason === 'unwritten-member' && boundary.source === trace.root
				&& this.expression(file, expression)?.expression.kind === LuaSyntaxKind.TableConstructorExpression) return null;
		}
		return undefined;
	}

	/** Raw own storage, as copied by pairs/rawget: __index cannot supply or
	 * hide a key. Nil remains explicit; null proves no own write. */
	public ownMemberState(file: FileSemanticData, expression: LuaExpression, name: string): LuaWrittenExpression | null | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		const trace = this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name);
		const source = this.resolve(trace, 'raw');
		if (source !== undefined) return source;
		if (trace.terminals.length !== 0) return;
		let unwritten = false;
		for (const boundary of trace.boundaries) {
			if (boundary.reason === 'prototype-write') continue;
			if (boundary.reason !== 'unwritten-member' || boundary.source !== trace.root) return;
			unwritten = true;
		}
		if (unwritten && this.expression(file, expression)?.expression.kind === LuaSyntaxKind.TableConstructorExpression) return null;
	}

	/** The single table-valued __index written by an admitted builtin
	 * setmetatable operation. This consumes binder transfer facts, never a
	 * similarly named Lua call or a guessed class-name convention. */
	public prototype(file: FileSemanticData, expression: LuaExpression): LuaWrittenExpression | null | undefined {
		const source = this.expression(file, expression);
		if (source?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) return;
		if (this.prototypes.has(source.expression)) return this.prototypes.get(source.expression);
		this.prototypes.set(source.expression, undefined);
		const authored = this.snapshot.symbolResolver.authoredSources;
		const transfer = authored.metatable(source);
		if (transfer === null) { this.prototypes.set(source.expression, null); return null; }
		if (transfer === undefined) return;
		const metatable = this.resolve(transfer);
		if (metatable === undefined) return;
		let prototype: LuaWrittenExpression | null | undefined;
		if (metatable.expression.kind === LuaSyntaxKind.NilLiteralExpression) prototype = null;
		else {
			const member = authored.member(metatable, '__index');
			if (!member.unconditional) { this.observe(member); return; }
			prototype = this.ownMemberState(metatable.file, metatable.expression, '__index');
		}
		const result = prototype?.expression.kind === LuaSyntaxKind.NilLiteralExpression ? null
			: prototype === null || prototype?.expression.kind === LuaSyntaxKind.TableConstructorExpression ? prototype : undefined;
		this.prototypes.set(source.expression, result);
		return result;
	}

	/** Ordinary table prototype lineage, retaining unknown/cyclic ancestry as
	 * unavailable. The returned occurrences preserve their actual module owners. */
	public lineage(file: FileSemanticData, expression: LuaExpression): readonly LuaWrittenExpression[] | undefined {
		const result: LuaWrittenExpression[] = [], seen = new Set<LuaWrittenExpression>();
		let source = this.expression(file, expression);
		while (source !== undefined) {
			if (source.expression.kind !== LuaSyntaxKind.TableConstructorExpression || seen.has(source)) return;
			seen.add(source); result.push(source);
			const parent = this.prototype(source.file, source.expression);
			if (parent === null) return result;
			source = parent;
		}
	}

	/** A unique written call application, including aliases to its result. Its
	 * arguments remain source; this never resolves or executes the called value. */
	public call(file: FileSemanticData, expression: LuaExpression): CallValueEntry | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		const trace = this.snapshot.symbolResolver.authoredSources.trace(query.expression(file, expression));
		return this.selectCall(trace);
	}

	/** One authored member application, not the value returned by executing it. */
	public memberCall(file: FileSemanticData, expression: LuaExpression, name: string): CallValueEntry | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.selectCall(this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name));
	}

	/** Raw own storage may contain an application even when __index is unknown. */
	public ownMemberCall(file: FileSemanticData, expression: LuaExpression, name: string): CallValueEntry | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.selectCall(this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name), 'raw');
	}

	private selectCall(trace: LuaAuthoredSourceTrace, member?: OwnMemberRead): CallValueEntry | undefined {
		this.observe(trace);
		if (trace.terminals.length !== 0) return;
		let call: CallValueEntry | undefined;
		for (const boundary of trace.boundaries) {
			if (boundary.reason === 'call-result' && call === undefined) call = boundary.call;
			else if (member !== 'raw' || boundary.reason !== 'prototype-write') return;
		}
		return call;
	}

	private resolve(trace: LuaAuthoredSourceTrace, ownMember?: OwnMemberRead): LuaWrittenExpression | undefined {
		this.observe(trace);
		return this.selectExpression(trace, ownMember);
	}

	private observe(trace: LuaAuthoredSourceTrace): void {
		if (!this.traces.has(trace)) {
			this.traces.add(trace);
			for (const source of trace.sources) {
				this.files.add(source.file);
				if (source.file.syntaxError !== null) this.syntaxComplete = false;
			}
		}
	}

	/** Unique authored syntax is independent of whether the consumer represents that source. */
	private selectExpression(trace: LuaAuthoredSourceTrace, ownMember?: OwnMemberRead): LuaWrittenExpression | undefined {
		// Generated Number source has a deliberately closed arithmetic spelling
		// for infinities/NaN. It is written data, not an executable Lua query.
		if (trace.terminals.length === 0 && trace.boundaries.length === 1 && trace.boundaries[0].reason === 'unknown-value') {
			const source = trace.boundaries[0].source, syntax = writtenSourceExpression(source);
			if (syntax !== undefined && readLuaNumberExpression(syntax) !== null)
				return this.snapshot.symbolResolver.writtenSources.expression(source.file, syntax);
		}
		if (trace.terminals.length !== 1 || trace.boundaries.length !== 0
			&& (!ownMember || trace.boundaries.some(boundary => boundary.reason !== 'prototype-write'))) return undefined;
		const source = trace.terminals[0];
		const syntax = source.value.root.kind === 'owned' ? source.value.root.syntax : writtenSourceExpression(source);
		if (syntax === undefined) return;
		const written = this.snapshot.symbolResolver.writtenSources.expression(source.file, syntax);
		// Lua consults __index only after an absent/nil own key. A unique
		// non-nil own field cannot be replaced by changing the prototype.
		if (trace.boundaries.length !== 0 && ownMember !== 'raw'
			&& (syntax.kind === LuaSyntaxKind.NilLiteralExpression || readLuaSourceTruth(written) === undefined)) return;
		return written;
	}

	/** Named definitions and called producers are navigation evidence, not resolved runtime values. */
	public producer(file: FileSemanticData, expression: LuaExpression): LuaWrittenProducer | undefined {
		const value = this.expression(file, expression);
		if (value !== undefined) return { kind: 'value', source: value };
		const query = this.snapshot.symbolResolver.writtenSources;
		let trace = query.trace(query.expression(file, expression));
		if (trace.terminals.length !== 0 || trace.boundaries.length !== 1) return undefined;
		const boundary = trace.boundaries[0];
		const kind = boundary.reason === 'call-result' ? 'call' : 'definition';
		if (boundary.reason === 'call-result') trace = query.trace(query.callee(boundary.call));
		else if (boundary.reason !== 'member-read') return undefined;
		if (trace.terminals.length === 0 && trace.boundaries.length === 1 && trace.boundaries[0].reason === 'member-read') {
			const member = trace.boundaries[0], types = this.snapshot.symbolResolver.definitionTypes;
			const declarations = types.lookupMember(types.shapesOf(member.base.value), member.name);
			if (declarations.length !== 1) return undefined;
			const declaration = declarations[0], owner = this.snapshot.getFileData(declaration.file)!;
			const writes = owner.declarationValuesByDeclaration.get(declaration.id);
			if (writes === undefined || writes.length !== 1) return undefined;
			trace = query.trace(query.write(writes[0]));
		}
		if (trace.boundaries.length !== 0 || trace.terminals.length !== 1) return undefined;
		const written = trace.terminals[0];
		const syntax = written.value.root.kind === 'owned' ? written.value.root.syntax : writtenSourceExpression(written);
		if (syntax === undefined || kind === 'call' && syntax.kind !== LuaSyntaxKind.FunctionExpression) return undefined;
		for (const source of trace.sources) {
			this.files.add(source.file);
			if (source.file.syntaxError !== null) this.syntaxComplete = false;
		}
		return { kind, source: query.expression(written.file, syntax) };
	}
}
