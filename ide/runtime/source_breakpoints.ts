import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';

export type SourceBreakpoint = {
	line: number;
	status: 'bound' | 'no-statement' | 'image-unavailable' | 'symbols-unavailable' | 'source-unavailable';
	locations: { pc: number; column: number; inlineDepth: number }[];
};
export type SourceLocationPcs = readonly [ReadonlyMap<number, number>, ReadonlyMap<number, number>, ReadonlyMap<number, number>];

/** Bind exact module/line requests to one installed physical image, including inlined statements. */
export function bindSourceBreakpoints(image: Blua32ToolingImage,
	modules: ReadonlyMap<string, ReadonlyMap<number, SourceBreakpoint>>, pcs: Map<number, number>): void {
	for (let fn = 0; fn < image.layout.functions.length; fn++) {
		const address = image.layout.functions[fn].codeAddress;
		for (const point of image.symbols!.metadata.statementPointsByFunction[fn]) {
			const requested = modules.get(point.range.path)?.get(point.range.start.line);
			if (requested === undefined) continue;
			const pc = address + point.wordOffset * INSTRUCTION_BYTES, inlineDepth = point.inlineCallSites.length;
			pcs.set(pc, inlineDepth);
			requested.status = 'bound';
			requested.locations.push({ pc, column: point.range.start.column, inlineDepth });
		}
	}
}
