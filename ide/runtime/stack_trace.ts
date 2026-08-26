import {
	buildLuaFrameRawLabel,
	luaFunctionDisplayName,
} from '../../toolchain/ts/lua/stack_frame_label';
import {
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import type { RuntimeCpuFaultFrame } from './fault_state';
import {
	resolveRuntimeLuaSource,
	type RuntimeSourceState,
} from './sources';
import type { ResourceIdentity } from '../common/resource';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';

export type StackTraceFrame = {
	resource: ResourceIdentity | null;
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
	return symbols === null || functionIndex < 0
		? `function@${functionAddress.toString(16)}`
		: luaFunctionDisplayName(symbols.metadata.functionIds[functionIndex]);
}

function buildLuaInstructionStackFrame(
	functionName: string,
): StackTraceFrame {
	return {
		resource: null,
		functionName,
		source: '',
		line: 0,
		column: 0,
		raw: buildLuaFrameRawLabel(functionName, ''),
	};
}

function buildLuaSourceStackFrame(
	sources: RuntimeSourceState,
	executionDomainId: ExecutionDomainId,
	range: SourceRange,
	functionName: string,
): StackTraceFrame {
	const source = range.path;
	const sourceRecord = resolveRuntimeLuaSource(sources, {
		domain: executionDomainId,
		path: source,
	})!.record;
	return {
		resource: {
			domain: executionDomainId,
			path: sourceRecord.source_path,
		},
		functionName,
		source,
		line: range.start.line,
		column: range.start.column,
		raw: buildLuaFrameRawLabel(functionName, source),
	};
}

export function buildLuaStackFrames(
	sources: RuntimeSourceState,
	faultFrames: readonly RuntimeCpuFaultFrame[],
): StackTraceFrame[] {
	const frames: StackTraceFrame[] = [];
	for (let index = faultFrames.length - 1; index >= 0; index -= 1) {
		const entry = faultFrames[index];
		const image = entry.toolingImage;
		const symbols = entry.functionIndex < 0 ? null : image.symbols;
		const range = symbols === null
			? null
			: blua32SourceRangeAtPc(symbols, image.layout.header.textAddress, entry.tracePc);
		const physicalFunctionName = resolveLuaFunctionName(
			symbols,
			entry.functionIndex,
			entry.functionAddress,
		);
		if (symbols !== null && range !== null) {
			const inlineCallSites = blua32InlineCallSitesAtPc(
				symbols,
				image.layout.header.textAddress,
				entry.tracePc,
			);
			for (let inlineIndex = inlineCallSites.length - 1; inlineIndex >= 0; inlineIndex -= 1) {
				const inlineRange = inlineIndex === inlineCallSites.length - 1
					? range
					: inlineCallSites[inlineIndex + 1].callRange;
				frames.push(buildLuaSourceStackFrame(
					sources,
					entry.executionDomainId,
					inlineRange,
					luaFunctionDisplayName(inlineCallSites[inlineIndex].calleeFunctionId),
				));
			}
			frames.push(buildLuaSourceStackFrame(
				sources,
				entry.executionDomainId,
				inlineCallSites.length === 0 ? range : inlineCallSites[0].callRange,
				physicalFunctionName,
			));
		} else {
			frames.push(buildLuaInstructionStackFrame(physicalFunctionName));
		}
	}
	return frames;
}
