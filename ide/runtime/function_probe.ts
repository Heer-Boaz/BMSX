import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { inlineCallSiteChainsEqual } from '../../toolchain/ts/lua/compiler/inline_debug';
import type { InlineCallSite } from '../../toolchain/ts/lua/compiler/program';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { blua32SlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';

export type FunctionProbe = { readonly pc: number; readonly registers: readonly number[] };
export type FunctionProbeBinding =
	| { readonly status: 'bound'; readonly points: readonly FunctionProbe[] }
	| { readonly status: 'symbols-unavailable' | 'function-unavailable' | 'ambiguous-function' | 'arguments-unavailable' };

/** Bind once per installed image. The hook only indexes PCs and reads compiler-owned locations. */
export function bindFunctionProbe(image: Blua32ToolingImage, modulePath: string, name: string, arguments_: readonly string[]): FunctionProbeBinding {
	if (image.symbols === null) return { status: 'symbols-unavailable' };
	const metadata = image.symbols.metadata;
	const functions: number[] = [];
	for (let i = 0; i < metadata.functionIds.length; i++) {
		const definition = metadata.functionDefinitions[i];
		if (definition !== null && toLuaModulePath(definition.path) === modulePath && metadata.functionDisplayNames[i] === name) functions.push(i);
	}
	if (functions.length === 0) return { status: 'function-unavailable' };
	if (functions.length !== 1) return { status: 'ambiguous-function' };
	const target = functions[0], id = metadata.functionIds[target], points: FunctionProbe[] = [];
	for (let fn = 0; fn < metadata.functionIds.length; fn++) {
		const seen: (readonly InlineCallSite[])[] = [];
		const address = image.layout.functions[fn].codeAddress;
		for (const point of metadata.statementPointsByFunction[fn]) {
			const chain = point.inlineCallSites;
			if ((chain.length === 0 ? metadata.functionIds[fn] : chain[chain.length - 1].calleeFunctionId) !== id) continue;
			if (seen.some(previous => inlineCallSiteChainsEqual(previous, chain))) continue;
			seen.push(chain);
			const pc = address + point.wordOffset * INSTRUCTION_BYTES, registers: number[] = [];
			for (const name of arguments_) {
				const slots = metadata.localSlotsByFunction[fn].filter(slot => slot.name === name
					&& inlineCallSiteChainsEqual(slot.inlineCallSites, chain) && blua32SlotLiveAtPc(slot.liveWordRanges, address, pc));
				if (slots.length !== 1) return { status: 'arguments-unavailable' };
				registers.push(slots[0].registerIndex);
			}
			points.push({ pc, registers });
		}
	}
	return points.length === 0 ? { status: 'function-unavailable' } : { status: 'bound', points };
}
