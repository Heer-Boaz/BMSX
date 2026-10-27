import {
	blua32FunctionDisplayNameById,
	blua32InlineCallSitesAtPc,
	blua32SourceRangeAtPc,
} from '../../toolchain/ts/rompack/blua32_symbols';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import type { Blua32SourceImage, RuntimeSourceState } from './sources';
import type { ResourceIdentity } from '../common/resource';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import type { Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';

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

export type RuntimeStackFrame = {
	readonly executionDomainId: ExecutionDomainId;
	readonly toolingImage: Blua32SourceImage;
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
		const toolingImage = (executionDomainId === -1 ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[executionDomainId])!;
		const functionAddress = cpu.readFrameFunctionAddress(index);
		frames[index] = { executionDomainId, toolingImage, functionAddress,
			functionIndex: blua32FunctionIndexAtAddress(toolingImage.layout, functionAddress),
			tracePc: index + 1 < depth && !cpu.readFrameReturnsToCompletionLatch(index + 1)
				? cpu.readFrameCallSitePc(index + 1) : cpu.readFramePc(index) };
	}
	return frames;
}

export type CapturedLuaStack = {
	readonly frames: RuntimeStackTraceFrame[];
	readonly sources: ReadonlyMap<SourceStackTraceFrame, Blua32CompiledSource>;
};

/** Plain frame descriptors and their exact installed source proof share one capture owner. */
export function buildLuaStackFrames(faultFrames: readonly RuntimeStackFrame[]): CapturedLuaStack {
	const frames: RuntimeStackTraceFrame[] = [];
	const sources = new Map<SourceStackTraceFrame, Blua32CompiledSource>();
	const appendSourceFrame = (image: Blua32SourceImage, range: SourceRange,
		functionName: string, physicalFrameIndex: number, inlineDepth: number): void => {
		const record = image.sources.get(toLuaModulePath(range.path));
		if (record === undefined) {
			// Symbols without retained source bytes identify instructions, not an authored file.
			const physical = faultFrames[physicalFrameIndex];
			frames.push({ kind: 'instruction', executionDomainId: physical.executionDomainId,
				instructionAddress: physical.tracePc, functionName, physicalFrameIndex, inlineDepth });
			return;
		}
		const frame = { kind: 'source' as const, resource: { contextId: image.sourceContextId, path: record.displayPath },
			line: range.start.line, column: range.start.column, functionName, workspacePath: record.displayPath,
			physicalFrameIndex, inlineDepth };
		frames.push(frame);
		sources.set(frame, record);
	};
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
				appendSourceFrame(image, inlineRange,
					blua32FunctionDisplayNameById(symbols, inlineCallSites[inlineIndex].calleeFunctionId), index, inlineIndex + 1);
			}
			const physicalRange = inlineCallSites.length === 0 ? range : inlineCallSites[0].callRange;
			appendSourceFrame(image, physicalRange, physicalFunctionName, index, 0);
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
	return { frames, sources };
}
