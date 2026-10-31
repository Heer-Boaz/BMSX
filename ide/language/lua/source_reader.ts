import { LuaBinaryOperator, LuaSyntaxKind, type LuaExpression } from '../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import { writtenSourceExpression, type LuaWrittenExpression } from '../../../toolchain/ts/lua/semantic/written_sources';
import type { LuaAuthoredSourceTrace } from '../../../toolchain/ts/lua/semantic/authored_sources';

export type LuaWrittenProducer = { readonly kind: 'value' | 'definition' | 'call'; readonly source: LuaWrittenExpression };

/** Source projection over one workspace, not an evaluator or a runtime instance resolver. */
export class LuaSourceReader {
	public readonly files = new Set<FileSemanticData>();
	public syntaxComplete = true;
	private readonly traces = new Set<LuaAuthoredSourceTrace>();
	private readonly strings = new Map<LuaWrittenExpression, string | undefined>();

	public constructor(public readonly snapshot: LuaSemanticWorkspaceSnapshot) {}

	/** A unique written value source; competing/unknown contributions remain unresolved. */
	public expression(file: FileSemanticData, expression: LuaExpression): LuaWrittenExpression | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.resolve(this.snapshot.symbolResolver.authoredSources.trace(query.expression(file, expression)));
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

	/** Select a field's authored source independently of mutation in the field's descendants. */
	public member(file: FileSemanticData, expression: LuaExpression, name: string): LuaWrittenExpression | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		return this.resolve(this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name));
	}

	/** A unique value, a proved unwritten member (null), or unresolved source
	 * (undefined). Optional authored defaults require the unwritten proof;
	 * an unknown/computed write is not an absent field. */
	public memberState(file: FileSemanticData, expression: LuaExpression, name: string): LuaWrittenExpression | null | undefined {
		const query = this.snapshot.symbolResolver.writtenSources;
		const trace = this.snapshot.symbolResolver.authoredSources.member(query.expression(file, expression), name);
		const source = this.resolve(trace);
		if (source !== undefined) return source;
		if (trace.terminals.length === 0 && trace.boundaries.length === 1) {
			const boundary = trace.boundaries[0];
			if (boundary.reason === 'unwritten-member' && boundary.source === trace.root
				&& this.expression(file, expression)?.expression.kind === LuaSyntaxKind.TableConstructorExpression) return null;
		}
		return undefined;
	}

	private resolve(trace: LuaAuthoredSourceTrace): LuaWrittenExpression | undefined {
		if (!this.traces.has(trace)) {
			this.traces.add(trace);
			for (const source of trace.sources) {
				this.files.add(source.file);
				if (source.file.syntaxError !== null) this.syntaxComplete = false;
			}
		}
		return this.selectExpression(trace);
	}

	/** Unique authored syntax is independent of whether the consumer represents that source. */
	private selectExpression(trace: LuaAuthoredSourceTrace): LuaWrittenExpression | undefined {
		if (trace.boundaries.length !== 0 || trace.terminals.length !== 1) return undefined;
		const source = trace.terminals[0];
		const syntax = source.value.root.kind === 'owned' ? source.value.root.syntax : writtenSourceExpression(source);
		return syntax === undefined ? undefined : this.snapshot.symbolResolver.writtenSources.expression(source.file, syntax);
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
