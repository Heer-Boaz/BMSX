import { writeLE32 } from '../../../machine/ts/common/endian';
import * as D from '../../../machine/ts/spec/blua32/diagnostics';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { inlineCallSiteChainsEqual } from '../lua/compiler/inline_debug';
import { StaticDeclarationKind } from '../lua/compiler/declaration_kind';
import { appendProgramWordRange, type ProgramWordRange } from '../lua/compiler/word_range';
import { sourcePositionInRange } from '../lua/semantic/source_range';
import type { SourceRange } from '../lua/source_range';
import type { Blua32ImageLayout } from './blua32_image';
import type { Blua32InlineCallSite, Blua32SymbolsImage } from './blua32_symbols';

type Binding = {
	name: string;
	flags: number;
	index: number;
	visible: readonly ProgramWordRange[];
	live: readonly ProgramWordRange[];
};
type ScopedBinding = Binding & { scope: SourceRange; visible: ProgramWordRange[] };
type Frame = {
	chain: readonly Blua32InlineCallSite[];
	name: string;
	active: ProgramWordRange[];
	bindings: Binding[];
	locals: ScopedBinding[];
};

/** Compile lexical/inline visibility once; firmware never walks source text or host symbols. */
export function encodeBlua32DiagnosticScopes(image: Blua32ImageLayout, symbols: Blua32SymbolsImage, offset: number) {
	const metadata = symbols.metadata;
	const staticScopes = metadata.staticScopes;
	const noIntervals: ProgramWordRange[] = [];
	const globalBindings: Binding[] = staticScopes.globals.map(index => {
		const declaration = staticScopes.declarations[index];
		return { name: declaration.name, visible: noIntervals, live: noIntervals,
			flags: D.BLUA32_DIAGNOSTIC_BINDING_CONST | (declaration.kind === StaticDeclarationKind.Type
				? D.BLUA32_DIAGNOSTIC_BINDING_TYPE : D.BLUA32_DIAGNOSTIC_BINDING_ADDRESS),
			index: declaration.kind === StaticDeclarationKind.Type ? D.BLUA32_DIAGNOSTIC_NO_LOCATION : declaration.address! };
	});
	const frames: Frame[] = [];
	const functions: { address: number; codeAddress: number; frameStart: number; frameCount: number }[] = [];
	const names = new Map<string, { offset: number; bytes: Uint8Array }>();
	const encoder = new TextEncoder();
	let nameBytes = 0, bindingCount = globalBindings.length;
	const functionNames = new Map(metadata.functionIds.map((id, index) => [id, metadata.functionDisplayNames[index]]));
	for (let functionIndex = 0; functionIndex < image.functions.length; functionIndex++) {
		const fn = image.functions[functionIndex];
		const frameStart = frames.length;
		const functionFrames: Frame[] = [];
		const framesByChain = new Map<number, Frame[]>();
		const endWord = (fn.codeAddress + fn.codeByteCount - image.header.textAddress) / INSTRUCTION_BYTES;
		const firstWord = (fn.codeAddress - image.header.textAddress) / INSTRUCTION_BYTES;
		let word = firstWord;
		while (word < endWord) {
			const range = metadata.debugRanges[word];
			const chainId = metadata.debugInlineCallSiteChainIds[word];
			let end = word + 1;
			// Visibility depends on the start position and inline chain, not each opcode.
			while (end < endWord && metadata.debugInlineCallSiteChainIds[end] === chainId) {
				const next = metadata.debugRanges[end];
				if (range === null ? next !== null : next === null || next.path !== range.path
					|| next.start.line !== range.start.line || next.start.column !== range.start.column) break;
				end++;
			}
			if (range !== null) {
				const chain = metadata.debugInlineCallSiteChains[chainId];
				let activeFrames = framesByChain.get(chainId);
				if (activeFrames === undefined) {
					activeFrames = [];
					for (let depth = 0; depth <= chain.length; depth++) {
						const prefix = chain.slice(0, depth);
						let frame = functionFrames.find(candidate => inlineCallSiteChainsEqual(candidate.chain, prefix));
						if (frame === undefined) {
							frame = { chain: prefix, name: depth === 0 ? metadata.functionDisplayNames[functionIndex]
								: functionNames.get(chain[depth - 1].calleeFunctionId)!, active: [], bindings: [], locals: [] };
							// Outer names precede locals: later declarations shadow even when unavailable.
							for (const slot of metadata.outerBindingsByFunction[functionIndex]) {
								if (!inlineCallSiteChainsEqual(slot.inlineCallSites, prefix)) continue;
								const origin = metadata.lexicalDeclarations[slot.declarationIndex];
								frame.bindings.push({ name: origin.name, flags: (origin.isConst ? D.BLUA32_DIAGNOSTIC_BINDING_CONST : 0)
									| (slot.location !== null && !slot.location.inStack ? D.BLUA32_DIAGNOSTIC_BINDING_UPVALUE : 0),
									index: slot.location === null ? D.BLUA32_DIAGNOSTIC_NO_LOCATION : slot.location.index,
									visible: frame.active, live: slot.liveWordRanges });
							}
							for (const slot of metadata.localSlotsByFunction[functionIndex]) {
								if (!inlineCallSiteChainsEqual(slot.inlineCallSites, prefix)) continue;
								const binding: ScopedBinding = { name: slot.name, flags: slot.isConst ? D.BLUA32_DIAGNOSTIC_BINDING_CONST : 0,
									index: slot.registerIndex, visible: [], live: slot.liveWordRanges, scope: slot.scope };
								frame.locals.push(binding);
								frame.bindings.push(binding);
							}
							// Binder-selected static declarations win only on their exact word intervals.
							for (const slot of staticScopes.bindingsByFunction[functionIndex]) {
								if (slot.inlineDepth !== depth) continue;
								const declaration = staticScopes.declarations[slot.declarationIndex];
								const isType = declaration.kind === StaticDeclarationKind.Type;
								frame.bindings.push({ name: declaration.name, visible: slot.visibleWordRanges,
									live: isType ? noIntervals : slot.visibleWordRanges,
									flags: D.BLUA32_DIAGNOSTIC_BINDING_CONST | (isType
										? D.BLUA32_DIAGNOSTIC_BINDING_TYPE : D.BLUA32_DIAGNOSTIC_BINDING_ADDRESS),
									index: declaration.kind === StaticDeclarationKind.Type ? D.BLUA32_DIAGNOSTIC_NO_LOCATION : declaration.address! });
							}
							functionFrames.push(frame);
						}
						activeFrames.push(frame);
					}
					framesByChain.set(chainId, activeFrames);
				}
				for (let depth = 0; depth < activeFrames.length; depth++) {
					const frame = activeFrames[depth];
					appendProgramWordRange(frame.active, word - firstWord, end - firstWord);
					const context = depth === chain.length ? range : chain[depth].callRange;
					for (const binding of frame.locals) {
						if (context.path === binding.scope.path
							&& sourcePositionInRange(context.start.line, context.start.column, binding.scope)) {
							appendProgramWordRange(binding.visible, word - firstWord, end - firstWord);
						}
					}
				}
			}
			word = end;
		}
		frames.push(...functionFrames);
		functions.push({ address: fn.address, codeAddress: fn.codeAddress, frameStart, frameCount: functionFrames.length });
	}
	// Shared outer visibility/live arrays are stored once, not once per binding.
	const intervals = new Map<readonly ProgramWordRange[], number>();
	let intervalCount = 0;
	const internName = (name: string): void => {
		if (names.has(name)) return;
		const bytes = encoder.encode(name);
		names.set(name, { offset: nameBytes, bytes });
		nameBytes += bytes.length;
	};
	const internIntervals = (ranges: readonly ProgramWordRange[]): void => {
		if (intervals.has(ranges)) return;
		intervals.set(ranges, intervalCount);
		intervalCount += ranges.length;
	};
	for (const binding of globalBindings) internName(binding.name);
	internIntervals(noIntervals);
	for (const frame of frames) {
		bindingCount += frame.bindings.length;
		internName(frame.name);
		internIntervals(frame.active);
		for (const binding of frame.bindings) {
			internName(binding.name);
			internIntervals(binding.visible);
			internIntervals(binding.live);
		}
	}
	const functionTable = offset;
	const frameTable = functionTable + functions.length * D.BLUA32_DIAGNOSTIC_FUNCTION_RECORD_SIZE;
	const bindingTable = frameTable + frames.length * D.BLUA32_DIAGNOSTIC_FRAME_RECORD_SIZE;
	const intervalTable = bindingTable + bindingCount * D.BLUA32_DIAGNOSTIC_BINDING_RECORD_SIZE;
	const nameTable = intervalTable + intervalCount * D.BLUA32_DIAGNOSTIC_INTERVAL_RECORD_SIZE;
	const bytes = new Uint8Array(nameTable + nameBytes - offset);
	const header = new Uint8Array(D.BLUA32_DIAGNOSTIC_DIRECTORY_HEADER_SIZE - D.BLUA32_DIAGNOSTIC_DIRECTORY_FUNCTION_COUNT_OFFSET);
	const headerWords = [functions.length, functionTable, frames.length, frameTable, bindingCount, bindingTable,
		intervalCount, intervalTable, nameBytes, nameTable, globalBindings.length];
	for (let index = 0; index < headerWords.length; index++) writeLE32(header, index * 4, headerWords[index]);
	for (let index = 0; index < functions.length; index++) {
		const fn = functions[index], base = functionTable - offset + index * D.BLUA32_DIAGNOSTIC_FUNCTION_RECORD_SIZE;
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FUNCTION_ADDRESS_OFFSET, fn.address);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FUNCTION_CODE_ADDRESS_OFFSET, fn.codeAddress);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FUNCTION_FRAME_START_OFFSET, fn.frameStart);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FUNCTION_FRAME_COUNT_OFFSET, fn.frameCount);
	}
	const writeBinding = (binding: Binding, bindingIndex: number): void => {
		const name = names.get(binding.name)!;
		const base = bindingTable - offset + bindingIndex * D.BLUA32_DIAGNOSTIC_BINDING_RECORD_SIZE;
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_NAME_OFFSET, nameTable + name.offset);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_NAME_BYTES_OFFSET, name.bytes.length);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_FLAGS_OFFSET, binding.flags);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_INDEX_OFFSET, binding.index);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_VISIBLE_START_OFFSET, intervals.get(binding.visible)!);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_VISIBLE_COUNT_OFFSET, binding.visible.length);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_LIVE_START_OFFSET, intervals.get(binding.live)!);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_BINDING_LIVE_COUNT_OFFSET, binding.live.length);
	};
	let bindingIndex = 0;
	for (const binding of globalBindings) writeBinding(binding, bindingIndex++);
	for (let index = 0; index < frames.length; index++) {
		const frame = frames[index], name = names.get(frame.name)!;
		const base = frameTable - offset + index * D.BLUA32_DIAGNOSTIC_FRAME_RECORD_SIZE;
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_DEPTH_OFFSET, frame.chain.length);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_NAME_OFFSET, nameTable + name.offset);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_NAME_BYTES_OFFSET, name.bytes.length);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_ACTIVE_START_OFFSET, intervals.get(frame.active)!);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_ACTIVE_COUNT_OFFSET, frame.active.length);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_BINDING_START_OFFSET, bindingIndex);
		writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_FRAME_BINDING_COUNT_OFFSET, frame.bindings.length);
		for (const binding of frame.bindings) {
			writeBinding(binding, bindingIndex++);
		}
	}
	for (const [ranges, start] of intervals) {
		for (let index = 0; index < ranges.length; index++) {
			const base = intervalTable - offset + (start + index) * D.BLUA32_DIAGNOSTIC_INTERVAL_RECORD_SIZE;
			writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_INTERVAL_START_OFFSET, ranges[index].start);
			writeLE32(bytes, base + D.BLUA32_DIAGNOSTIC_INTERVAL_END_OFFSET, ranges[index].end);
		}
	}
	for (const name of names.values()) bytes.set(name.bytes, nameTable - offset + name.offset);
	return { header, bytes };
}
