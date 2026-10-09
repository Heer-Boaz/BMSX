import { LuaSyntaxKind, type LuaExpression } from '../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import { writtenSourceExpression, type LuaWrittenExpression, type LuaWrittenSourceTrace } from '../../../toolchain/ts/lua/semantic/written_sources';

export type LuaWrittenProducer = { readonly kind: 'value' | 'definition' | 'call'; readonly source: LuaWrittenExpression };

/** Source projection over one workspace, not an evaluator or a runtime instance resolver. */
export class LuaSourceReader {
	public readonly files = new Set<FileSemanticData>();
	public syntaxComplete = true;
	private readonly traces = new Map<LuaExpression, LuaWrittenSourceTrace>();

	public constructor(public readonly snapshot: LuaSemanticWorkspaceSnapshot) {}

	public trace(file: FileSemanticData, expression: LuaExpression): LuaWrittenSourceTrace {
		let trace = this.traces.get(expression);
		if (trace !== undefined) return trace;
		const query = this.snapshot.symbolResolver.writtenSources;
		trace = query.trace(query.expression(file, expression));
		this.traces.set(expression, trace);
		for (const source of trace.sources) {
			this.files.add(source.file);
			if (source.file.syntaxError !== null) this.syntaxComplete = false;
		}
		return trace;
	}

	/** A unique written value source; competing/unknown contributions remain unresolved. */
	public expression(file: FileSemanticData, expression: LuaExpression): LuaWrittenExpression | undefined {
		const trace = this.trace(file, expression);
		if (trace.boundaries.length !== 0 || trace.terminals.length !== 1) return undefined;
		const source = trace.terminals[0];
		const syntax = source.value.root.kind === 'owned' ? source.value.root.syntax : writtenSourceExpression(source);
		return syntax === undefined ? undefined : this.snapshot.symbolResolver.writtenSources.expression(source.file, syntax);
	}

	/** Named definitions and called producers are navigation evidence, not resolved runtime values. */
	public producer(file: FileSemanticData, expression: LuaExpression): LuaWrittenProducer | undefined {
		const value = this.expression(file, expression);
		if (value !== undefined) return { kind: 'value', source: value };
		let trace = this.trace(file, expression);
		if (trace.terminals.length !== 0 || trace.boundaries.length !== 1) return undefined;
		const boundary = trace.boundaries[0];
		const query = this.snapshot.symbolResolver.writtenSources;
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
