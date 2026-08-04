import { buildLuaFrameRawLabel } from '../../toolchain/ts/lua/stack_frame_label';
import {
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
	type Blua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { RuntimeCpuFaultFrame } from './fault_state';
import {
	resolveRuntimeLuaSource,
	runtimeLuaSourceRegistry,
	type RuntimeSourceState,
} from './sources';
import type { ResourceIdentity } from '../common/resource';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';

export type StackTraceFrame = {
	resource: ResourceIdentity;
	functionName: string;
	source: string;
	line: number;
	column: number;
	raw: string;
	workspacePath?: string;
};

function luaFunctionNameFromId(protoId: string): string {
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

function resolveLuaFunctionName(
	symbols: Blua32SymbolsImage | null,
	functionIndex: number,
	functionAddress: number,
): string {
	return symbols === null
		? `function@${functionAddress.toString(16)}`
		: luaFunctionNameFromId(symbols.metadata.functionIds[functionIndex]);
}

function buildLuaSourceStackFrame(
	sources: RuntimeSourceState,
	executionDomainId: ExecutionDomainId,
	range: SourceRange | null,
	functionName: string,
): StackTraceFrame {
	const source = range
		? range.path
		: runtimeLuaSourceRegistry(sources, executionDomainId)!.entrySourcePath;
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
		line: range ? range.start.line : 0,
		column: range ? range.start.column : 0,
		raw: buildLuaFrameRawLabel(functionName, source),
	};
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
		const physicalFunctionName = resolveLuaFunctionName(
			symbols,
			entry.functionIndex,
			entry.functionAddress,
		);
		if (symbols !== null && range !== null) {
			const inlineCallSites = blua32InlineCallSitesAtPc(
				symbols,
				entry.textAddress,
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
					luaFunctionNameFromId(inlineCallSites[inlineIndex].calleeFunctionId),
				));
			}
			frames.push(buildLuaSourceStackFrame(
				sources,
				entry.executionDomainId,
				inlineCallSites.length === 0 ? range : inlineCallSites[0].callRange,
				physicalFunctionName,
			));
		} else {
			frames.push(buildLuaSourceStackFrame(
				sources,
				entry.executionDomainId,
				range,
				physicalFunctionName,
			));
		}
	}
	return frames;
}
