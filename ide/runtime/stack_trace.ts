import { luaFunctionDisplayName } from '../../toolchain/ts/lua/stack_frame_label';
import {
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
} from '../../toolchain/ts/rompack/blua32_symbols';
import type { RuntimeCpuFaultFrame } from './fault_state';
import {
	resolveRuntimeLuaSource,
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from './sources';
import type { ResourceDomain, ResourceIdentity } from '../common/resource';
import { resolveWorkspacePath } from '../workspace/path';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';

export type SourceStackTraceFrame = {
	readonly kind: 'source';
	readonly resource: ResourceIdentity;
	readonly functionName: string;
	readonly line: number;
	readonly column: number;
	readonly workspacePath: string;
};

export type InstructionStackTraceFrame = {
	readonly kind: 'instruction';
	readonly executionDomainId: ExecutionDomainId;
	readonly instructionAddress: number;
	readonly functionName: string;
};

export type StackTraceFrame = SourceStackTraceFrame | InstructionStackTraceFrame;

export function createLuaSourceStackTraceFrame(
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	source: string,
	line: number,
	column: number,
	functionName: string,
): SourceStackTraceFrame {
	const sourceRecord = resolveRuntimeLuaSource(sources, {
		domain,
		path: source,
	})!.record;
	const resource = {
		domain,
		path: sourceRecord.source_path,
	};
	return {
		kind: 'source',
		resource,
		functionName,
		line,
		column,
		workspacePath: resolveWorkspacePath(
			resource.path,
			runtimeSourceProjectRootPath(sources, domain),
		),
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
		if (entry.functionIndex < 0 || image.symbols === null) {
			frames.push({
				kind: 'instruction',
				executionDomainId: entry.executionDomainId,
				instructionAddress: entry.tracePc,
				functionName: `function@${entry.functionAddress.toString(16)}`,
			});
			continue;
		}
		const symbols = image.symbols;
		const physicalFunctionName = luaFunctionDisplayName(symbols.metadata.functionIds[entry.functionIndex]);
		const range = blua32SourceRangeAtPc(symbols, image.layout.header.textAddress, entry.tracePc);
		if (range !== null) {
			const inlineCallSites = blua32InlineCallSitesAtPc(
				symbols,
				image.layout.header.textAddress,
				entry.tracePc,
			);
			for (let inlineIndex = inlineCallSites.length - 1; inlineIndex >= 0; inlineIndex -= 1) {
				const inlineRange = inlineIndex === inlineCallSites.length - 1
					? range
					: inlineCallSites[inlineIndex + 1].callRange;
				frames.push(createLuaSourceStackTraceFrame(
					sources,
					entry.executionDomainId,
					inlineRange.path,
					inlineRange.start.line,
					inlineRange.start.column,
					luaFunctionDisplayName(inlineCallSites[inlineIndex].calleeFunctionId),
				));
			}
			const physicalRange = inlineCallSites.length === 0 ? range : inlineCallSites[0].callRange;
			frames.push(createLuaSourceStackTraceFrame(
				sources,
				entry.executionDomainId,
				physicalRange.path,
				physicalRange.start.line,
				physicalRange.start.column,
				physicalFunctionName,
			));
		} else {
			frames.push({
				kind: 'instruction',
				executionDomainId: entry.executionDomainId,
				instructionAddress: entry.tracePc,
				functionName: physicalFunctionName,
			});
		}
	}
	return frames;
}
