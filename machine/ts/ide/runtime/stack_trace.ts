import type { Runtime } from '../../machine/runtime/runtime';
import type { StackTraceFrame } from '../../lua/value';
import { buildLuaFrameRawLabel } from '../../lua/stack_frame_label';
import { machineManager } from '../../core/machine_manager';
import {
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from '../../machine/cpu/blua32_symbols';

function resolveLuaFunctionName(
	symbols: Blua32SymbolsImage | null,
	functionIndex: number,
	functionAddress: number,
): string {
	if (symbols === null) {
		return `function@${functionAddress.toString(16)}`;
	}
	const protoId = symbols.metadata.functionIds[functionIndex];
	const slashIndex = protoId.lastIndexOf('/');
	const hint = slashIndex >= 0 ? protoId.slice(slashIndex + 1) : protoId;
	const colonIndex = hint.indexOf(':');
	if (colonIndex < 0) {
		return hint;
	}
	const kind = hint.slice(0, colonIndex);
	const name = hint.slice(colonIndex + 1);
	switch (kind) {
		case 'decl':
		case 'assign':
			return name;
		case 'local': {
			const hashIndex = name.indexOf('#');
			return hashIndex >= 0 ? name.slice(0, hashIndex) : name;
		}
		case 'anon':
			return 'anonymous';
		default:
			return hint;
	}
}

export function buildLuaStackFrames(runtime: Runtime): StackTraceFrame[] {
	const callStack = runtime.machine.cpu.getCallStack();
	const frames: StackTraceFrame[] = [];
	for (let index = callStack.length - 1; index >= 0; index -= 1) {
		const entry = callStack[index];
		const range = entry.symbols === null
			? null
			: blua32SourceRangeAtPc(entry.symbols, entry.textAddress, entry.pc);
		const source = range ? range.path : machineManager.sourceState.currentPath;
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		const functionName = resolveLuaFunctionName(
			entry.symbols,
			entry.functionIndex,
			entry.functionAddress,
		);
		frames.push({
			origin: 'lua',
			functionName,
			source,
			line,
			column,
			raw: buildLuaFrameRawLabel(functionName, source),
		});
	}
	return frames;
}
