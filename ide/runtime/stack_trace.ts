import {
	blua32FunctionDisplayNameById,
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
} from '../../toolchain/ts/rompack/blua32_symbols';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import {
	resolveRuntimeLuaSource,
	type RuntimeSourceState,
} from './sources';
import type { ResourceDomain, ResourceIdentity } from '../common/resource';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';

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
		workspacePath: sourceRecord.normalized_source_path,
	};
}

export type RuntimeStackFrame = {
	readonly executionDomainId: ExecutionDomainId;
	readonly toolingImage: Blua32ToolingImage;
	readonly functionAddress: number;
	readonly functionIndex: number;
	readonly tracePc: number;
};

/** Physical identity is meaningful only within the suspension that supplied these frames. */
export type RuntimeStackTraceFrame = StackTraceFrame & {
	readonly physicalFrameIndex: number;
	readonly inlineDepth: number;
};

export function readRuntimeStackFrames(cpu: CPU, sources: RuntimeSourceState): RuntimeStackFrame[] {
	const depth = cpu.getFrameDepth();
	const frames = new Array<RuntimeStackFrame>(depth);
	for (let index = 0; index < depth; index++) {
		const executionDomainId = cpu.readFrameExecutionDomain(index);
		const toolingImage = blua32ToolingImageForDomain(sources.currentBlua32Media, executionDomainId)!;
		const functionAddress = cpu.readFrameFunctionAddress(index);
		frames[index] = { executionDomainId, toolingImage, functionAddress,
			functionIndex: blua32FunctionIndexAtAddress(toolingImage.layout, functionAddress),
			tracePc: index + 1 < depth && !cpu.readFrameReturnsToCompletionLatch(index + 1)
				? cpu.readFrameCallSitePc(index + 1) : cpu.readFramePc(index) };
	}
	return frames;
}

export function buildLuaStackFrames(
	faultFrames: readonly RuntimeStackFrame[],
	createSourceFrame: (domain: ResourceDomain, source: string, line: number, column: number, functionName: string) => SourceStackTraceFrame,
): RuntimeStackTraceFrame[] {
	const frames: RuntimeStackTraceFrame[] = [];
	for (let index = faultFrames.length - 1; index >= 0; index -= 1) {
		const entry = faultFrames[index];
		const image = entry.toolingImage;
		if (entry.functionIndex < 0 || image.symbols === null) {
			frames.push({
				physicalFrameIndex: index, inlineDepth: 0,
				kind: 'instruction',
				executionDomainId: entry.executionDomainId,
				instructionAddress: entry.tracePc,
				functionName: `function@${entry.functionAddress.toString(16)}`,
			});
			continue;
		}
		const symbols = image.symbols;
		const physicalFunctionName = symbols.metadata.functionDisplayNames[entry.functionIndex];
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
				frames.push({ physicalFrameIndex: index, inlineDepth: inlineIndex + 1, ...createSourceFrame(
					entry.executionDomainId,
					inlineRange.path,
					inlineRange.start.line,
					inlineRange.start.column,
					blua32FunctionDisplayNameById(symbols, inlineCallSites[inlineIndex].calleeFunctionId),
				) });
			}
			const physicalRange = inlineCallSites.length === 0 ? range : inlineCallSites[0].callRange;
			frames.push({ physicalFrameIndex: index, inlineDepth: 0, ...createSourceFrame(
				entry.executionDomainId,
				physicalRange.path,
				physicalRange.start.line,
				physicalRange.start.column,
				physicalFunctionName,
			) });
		} else {
			frames.push({
				physicalFrameIndex: index, inlineDepth: 0,
				kind: 'instruction',
				executionDomainId: entry.executionDomainId,
				instructionAddress: entry.tracePc,
				functionName: physicalFunctionName,
			});
		}
	}
	return frames;
}
