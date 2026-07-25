import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { StackTraceFrame } from '../../machine/ts/lua/value';
import { buildLuaFrameRawLabel } from '../../machine/ts/lua/stack_frame_label';
import { machineManager } from '../../machine/ts/core/machine_manager';
import {
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from '../../machine/ts/machine/cpu/blua32_symbols';
import { blua32SymbolsForSlot, activeBlua32MediaSymbols } from './lua_pipeline';

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
	const mediaSymbols = activeBlua32MediaSymbols();
	const frames: StackTraceFrame[] = [];
	for (let index = callStack.length - 1; index >= 0; index -= 1) {
		const entry = callStack[index];
		const symbols = blua32SymbolsForSlot(mediaSymbols, entry.slot);
		const range = symbols === null
			? null
			: blua32SourceRangeAtPc(symbols, entry.textAddress, entry.pc);
		const source = range ? range.path : machineManager.sourceState.activeLuaSources.entry_path;
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		const functionName = resolveLuaFunctionName(
			symbols,
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
