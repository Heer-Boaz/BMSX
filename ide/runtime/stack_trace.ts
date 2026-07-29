import { buildLuaFrameRawLabel } from '../../machine/ts/lua/stack_frame_label';
import {
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from '../../machine/ts/rompack/tooling/blua32_symbols';
import { blua32ToolingImageForDomain } from '../../machine/ts/rompack/tooling/blua32_media';
import type { RuntimeCpuFaultFrame } from './fault_state';
import type { RuntimeSourceState } from './sources';

export type StackTraceFrame = {
	functionName: string;
	source: string;
	line: number;
	column: number;
	raw: string;
	workspacePath?: string;
};

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

export function buildLuaStackFrames(
	sources: RuntimeSourceState,
	faultFrames: readonly RuntimeCpuFaultFrame[],
): StackTraceFrame[] {
	const media = sources.currentBlua32Media;
	const frames: StackTraceFrame[] = [];
	for (let index = faultFrames.length - 1; index >= 0; index -= 1) {
		const entry = faultFrames[index];
		const image = blua32ToolingImageForDomain(media, entry.executionDomainId);
		const symbols = image ? image.symbols : null;
		const range = symbols === null
			? null
			: blua32SourceRangeAtPc(symbols, entry.textAddress, entry.tracePc);
		const source = range ? range.path : sources.activeLuaSources.entrySourcePath;
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		const functionName = resolveLuaFunctionName(
			symbols,
			entry.functionIndex,
			entry.functionAddress,
		);
		frames.push({
			functionName,
			source,
			line,
			column,
			raw: buildLuaFrameRawLabel(functionName, source),
		});
	}
	return frames;
}
