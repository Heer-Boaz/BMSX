import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { sourceRangesEqual } from '../../toolchain/ts/lua/source_range';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, type Blua32InlineCallSite, type Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import type { RuntimeSourceState } from './sources';
import type { RuntimeFunctionLocation } from './suspended_guest';

export type RuntimeReturnTarget = {
	readonly frameDepth: number;
	readonly inline?: {
		readonly symbols: Blua32SymbolsImage;
		readonly textAddress: number;
		readonly callSites: readonly Blua32InlineCallSite[];
		readonly depth: number;
	};
};

/** Outermost active invocation, including logical frames erased by the compiler. */
export function runtimeFunctionReturnTarget(
	cpu: CPU, sources: RuntimeSourceState, location: RuntimeFunctionLocation,
): RuntimeReturnTarget | undefined {
	const image = blua32ToolingImageForDomain(sources.currentBlua32Media, location.domain)!;
	const functionIndex = blua32FunctionIndexAtAddress(image.layout, location.address);
	const depth = cpu.getFrameDepth();
	for (let frameIndex = 0; frameIndex < depth; frameIndex += 1) {
		if (cpu.readFrameExecutionDomain(frameIndex) !== location.domain) continue;
		const address = cpu.readFrameFunctionAddress(frameIndex);
		if (address === location.address) return { frameDepth: frameIndex };
		// Runtime-compiled closures have no inline occurrences in the installed image.
		if (functionIndex < 0 || blua32FunctionIndexAtAddress(image.layout, address) < 0) continue;
		const pc = frameIndex + 1 < depth && !cpu.readFrameReturnsToCompletionLatch(frameIndex + 1)
			? cpu.readFrameCallSitePc(frameIndex + 1) : cpu.readFramePc(frameIndex);
		const symbols = image.symbols!;
		const callSites = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, pc);
		for (let inlineIndex = 0; inlineIndex < callSites.length; inlineIndex += 1) {
			if (callSites[inlineIndex].calleeFunctionId !== symbols.metadata.functionIds[functionIndex]) continue;
			return { frameDepth: frameIndex + 1, inline: {
				symbols, textAddress: image.layout.header.textAddress, callSites, depth: inlineIndex + 1,
			} };
		}
	}
}

/** Checked at instruction boundaries; no allocations or source queries while executing. */
export function runtimeReturnTargetReached(cpu: CPU, target: RuntimeReturnTarget): boolean {
	const depth = cpu.getFrameDepth();
	if (depth !== target.frameDepth) return depth < target.frameDepth;
	const inline = target.inline;
	if (inline === undefined) return true;
	const callSites = blua32InlineCallSitesAtPc(inline.symbols, inline.textAddress, cpu.readFramePc(depth - 1));
	if (callSites.length < inline.depth) return true;
	for (let index = 0; index < inline.depth; index += 1) {
		const before = inline.callSites[index], current = callSites[index];
		if (before.calleeFunctionId !== current.calleeFunctionId || !sourceRangesEqual(before.callRange, current.callRange)) return true;
	}
	return false;
}
