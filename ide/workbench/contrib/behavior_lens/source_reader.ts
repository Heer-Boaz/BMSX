import type { LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { writtenSourceExpression, type LuaWrittenSourceTrace } from '../../../../toolchain/ts/lua/semantic/written_sources';

/** Source projection over one workspace, not an evaluator or a runtime instance resolver. */
export class BehaviorSourceReader {
	public readonly files = new Set<FileSemanticData>();
	public syntaxComplete = true;
	private readonly traces = new Map<LuaExpression, LuaWrittenSourceTrace>();

	public constructor(public readonly snapshot: LuaSemanticWorkspaceSnapshot) {}

	public trace(expression: LuaExpression): LuaWrittenSourceTrace {
		let trace = this.traces.get(expression);
		if (trace !== undefined) return trace;
		const query = this.snapshot.symbolResolver.writtenSources;
		trace = query.trace(query.expression(this.snapshot.getFileData(expression.range.path)!, expression));
		this.traces.set(expression, trace);
		for (const source of trace.sources) {
			this.files.add(source.file);
			if (source.file.syntaxError !== null) this.syntaxComplete = false;
		}
		return trace;
	}

	/** A unique written value source; competing/unknown contributions remain unresolved. */
	public expression(expression: LuaExpression): LuaExpression | undefined {
		const trace = this.trace(expression);
		if (trace.boundaries.length !== 0 || trace.terminals.length !== 1) return undefined;
		const source = trace.terminals[0];
		return source.value.root.kind === 'owned' ? source.value.root.syntax : writtenSourceExpression(source);
	}
}
