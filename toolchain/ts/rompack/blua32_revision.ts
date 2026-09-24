import { LexicalDeclarationKind } from '../lua/compiler/declaration_kind';
import { LuaSourceCorrespondence } from '../lua/semantic/source_correspondence';
import { sourceRangesEqual } from '../lua/source_range';
import type { Blua32FunctionRecord, Blua32ImageLayout } from './blua32_image';
import type {
	Blua32LexicalDeclarationDebug,
	Blua32InlineCallSite,
	Blua32LocalSlotDebug,
	Blua32ResumePoint,
	Blua32SymbolsImage,
} from './blua32_symbols';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import {
	sourcePositionInRange,
	sourceRangeKey,
} from '../lua/semantic/source_range';
import type { SourceRange } from '../lua/source_range';
import type { LinkedBlua32Image } from './blua32_linker';
import { resolveInlineLocalContextRange } from '../lua/compiler/inline_debug';

function resumePointShapeMatches(previous: Blua32ResumePoint, fresh: Blua32ResumePoint): boolean {
	// Definitions are future writes, not state carried into the continuation.
	// Only live input registers and their lexical owners must already agree.
	return previous.op === fresh.op
		&& numberArraysEqual(previous.liveRegisters, fresh.liveRegisters)
		&& numberArraysEqual(previous.uses, fresh.uses);
}

function resumePointLocationKey(
	range: SourceRange,
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>,
): string {
	let key = `${range.path}\0${sourceRangeKey(range)}`;
	for (let index = 0; index < inlineCallSites.length; index += 1) {
		const callSite = inlineCallSites[index];
		key += `\0${callSite.calleeFunctionId}\0${callSite.callRange.path}`
			+ `\0${sourceRangeKey(callSite.callRange)}`;
	}
	return key;
}

function translateInlineCallSites(
	inlineCallSites: ReadonlyArray<Blua32InlineCallSite>,
	correspondence: LuaSourceCorrespondence,
): ReadonlyArray<Blua32InlineCallSite> | null {
	if (inlineCallSites.length === 0) {
		return inlineCallSites;
	}
	const translated = new Array<Blua32InlineCallSite>(inlineCallSites.length);
	for (let index = 0; index < inlineCallSites.length; index += 1) {
		const callSite = inlineCallSites[index];
		const callRange = correspondence.unchangedRange(callSite.callRange);
		if (callRange === undefined) {
			return null;
		}
		translated[index] = {
			calleeFunctionId: callSite.calleeFunctionId,
			callRange,
		};
	}
	return translated;
}

function numberArraysEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}

function activeLocalLayoutMatches(
	previousSlots: ReadonlyArray<Blua32LocalSlotDebug>,
	freshSlots: ReadonlyArray<Blua32LocalSlotDebug>,
	previousRange: SourceRange,
	freshRange: SourceRange,
	previousInlineCallSites: ReadonlyArray<Blua32InlineCallSite>,
	freshInlineCallSites: ReadonlyArray<Blua32InlineCallSite>,
	liveRegisters: readonly number[],
	correspondence: LuaSourceCorrespondence,
): boolean {
	let previousIndex = 0;
	let freshIndex = 0;
	while (true) {
		while (previousIndex < previousSlots.length) {
			const slot = previousSlots[previousIndex];
			const contextRange = resolveInlineLocalContextRange(
				slot,
				previousRange,
				previousInlineCallSites,
			);
			if (liveRegisters.includes(slot.registerIndex) && contextRange !== null
				&& slot.scope.path === contextRange.path
				&& sourcePositionInRange(
					contextRange.start.line,
					contextRange.start.column,
					slot.scope,
				)) {
				break;
			}
			previousIndex += 1;
		}
		while (freshIndex < freshSlots.length) {
			const slot = freshSlots[freshIndex];
			const contextRange = resolveInlineLocalContextRange(
				slot,
				freshRange,
				freshInlineCallSites,
			);
			if (liveRegisters.includes(slot.registerIndex) && contextRange !== null
				&& slot.scope.path === contextRange.path
				&& sourcePositionInRange(
					contextRange.start.line,
					contextRange.start.column,
					slot.scope,
				)) {
				break;
			}
			freshIndex += 1;
		}
		if (previousIndex === previousSlots.length || freshIndex === freshSlots.length) {
			return previousIndex === previousSlots.length && freshIndex === freshSlots.length;
		}
		const previousSlot = previousSlots[previousIndex];
		const freshSlot = freshSlots[freshIndex];
		// An implicit receiver's definition is its function, not a named declaration.
		const definition = correspondence.declaration(previousSlot.definition)
			?? correspondence.functionRange(previousSlot.definition);
		if (previousSlot.name !== freshSlot.name || previousSlot.registerIndex !== freshSlot.registerIndex
			|| definition === undefined || !sourceRangesEqual(definition, freshSlot.definition)) {
			return false;
		}
		previousIndex += 1;
		freshIndex += 1;
	}
}

function functionCodeMatches(
	previousImage: Blua32ImageLayout,
	previousFunction: Blua32FunctionRecord,
	freshImage: Blua32ImageLayout,
	freshFunction: Blua32FunctionRecord,
): boolean {
	if (previousFunction.codeByteCount !== freshFunction.codeByteCount
		|| previousFunction.numParams !== freshFunction.numParams
		|| previousFunction.maxStack !== freshFunction.maxStack
		|| previousFunction.isVararg !== freshFunction.isVararg
		|| previousFunction.staticClosure !== freshFunction.staticClosure) {
		return false;
	}
	const previousOffset = previousFunction.codeAddress - previousImage.address;
	const freshOffset = freshFunction.codeAddress - freshImage.address;
	for (let offset = 0; offset < previousFunction.codeByteCount; offset += 1) {
		if (previousImage.bytes[previousOffset + offset] !== freshImage.bytes[freshOffset + offset]) {
			return false;
		}
	}
	return true;
}

function closureLayoutMatches(
	previousFunction: Blua32FunctionRecord,
	previousBindings: ReadonlyArray<number>,
	previousLocals: ReadonlyArray<Blua32LexicalDeclarationDebug>,
	freshFunction: Blua32FunctionRecord,
	freshBindings: ReadonlyArray<number>,
	freshLocals: ReadonlyArray<Blua32LexicalDeclarationDebug>,
	correspondence: LuaSourceCorrespondence,
): boolean {
	if (previousFunction.staticClosure !== freshFunction.staticClosure
		|| previousFunction.upvalues.length !== freshFunction.upvalues.length
		|| previousBindings.length !== freshBindings.length) {
		return false;
	}
	for (let index = 0; index < previousFunction.upvalues.length; index += 1) {
		const previousLocal = previousLocals[previousBindings[index]];
		const freshLocal = freshLocals[freshBindings[index]];
		if (previousLocal.definition === null || freshLocal.definition === null) return false;
		const definition = previousLocal.kind === LexicalDeclarationKind.Receiver
			? correspondence.functionRange(previousLocal.definition)
			: correspondence.declaration(previousLocal.definition);
		if (definition === undefined
			|| previousLocal.functionId !== freshLocal.functionId
			|| previousLocal.kind !== freshLocal.kind
			|| !sourceRangesEqual(definition, freshLocal.definition)) {
			return false;
		}
	}
	return true;
}

function mapChangedFunctionProgramCounters(
	pcAddresses: Int32Array,
	previousImage: Blua32ImageLayout,
	previousSymbols: Blua32SymbolsImage,
	previousFunctionIndex: number,
	freshImage: Blua32ImageLayout,
	freshSymbols: Blua32SymbolsImage,
	freshFunctionIndex: number,
	correspondence: LuaSourceCorrespondence,
): void {
	const freshPointsByLocation = new Map<string, Blua32ResumePoint>();
	const freshPoints = freshSymbols.metadata.resumePointsByFunction[freshFunctionIndex];
	for (let index = 0; index < freshPoints.length; index += 1) {
		const point = freshPoints[index];
		freshPointsByLocation.set(
			point.resumeId ?? resumePointLocationKey(point.range, point.inlineCallSites),
			point,
		);
	}

	const previousFunction = previousImage.functions[previousFunctionIndex];
	const freshFunction = freshImage.functions[freshFunctionIndex];
	const previousPoints = previousSymbols.metadata.resumePointsByFunction[previousFunctionIndex];
	for (let index = 0; index < previousPoints.length; index += 1) {
		const previousPoint = previousPoints[index];
		const freshRange = previousPoint.resumeId === undefined ? correspondence.unchangedRange(previousPoint.range) : previousPoint.range;
		if (freshRange === undefined) {
			continue;
		}
		const freshInlineCallSites = translateInlineCallSites(
			previousPoint.inlineCallSites,
			correspondence,
		);
		if (freshInlineCallSites === null) {
			continue;
		}
		const freshPoint = freshPointsByLocation.get(
			previousPoint.resumeId ?? resumePointLocationKey(freshRange, freshInlineCallSites),
		);
		if (freshPoint === undefined
			|| !resumePointShapeMatches(previousPoint, freshPoint)
			|| !activeLocalLayoutMatches(
				previousSymbols.metadata.localSlotsByFunction[previousFunctionIndex],
				freshSymbols.metadata.localSlotsByFunction[freshFunctionIndex],
				previousPoint.range,
				freshPoint.range,
				previousPoint.inlineCallSites,
				freshPoint.inlineCallSites,
				freshPoint.liveRegisters,
				correspondence,
			)) {
			continue;
		}
		const previousPc = previousFunction.codeAddress + previousPoint.wordOffset * INSTRUCTION_BYTES;
		pcAddresses[(previousPc - previousImage.header.textAddress) / INSTRUCTION_BYTES]
			= freshFunction.codeAddress + freshPoint.wordOffset * INSTRUCTION_BYTES;
	}
}

export type Blua32ExecutionImageRevision = {
	functionAddresses: Uint32Array;
	pcAddresses: Int32Array;
};

export function relocatedContinuationPc(
	revision: Blua32ExecutionImageRevision,
	previousImage: Blua32ImageLayout,
	pc: number,
): number {
	const wordIndex = (pc - previousImage.header.textAddress) / INSTRUCTION_BYTES;
	return (wordIndex >>> 0) < revision.pcAddresses.length ? revision.pcAddresses[wordIndex] : -1;
}

// A call site is always the instruction immediately preceding the caller's own resume point
// (`CPU.pushFrameFromCaller` is invoked with `callSitePc = caller.pc - INSTRUCTION_BYTES` at every
// call site, direct or protected). Resume points are registered at resume-after-call addresses,
// not at the call instruction itself, so a call site is relocated by recovering the associated
// resume point and re-applying the same fixed offset on the fresh side.
export function relocatedCallSitePc(
	revision: Blua32ExecutionImageRevision,
	previousImage: Blua32ImageLayout,
	callSitePc: number,
): number {
	const returnPc = relocatedContinuationPc(revision, previousImage, callSitePc + INSTRUCTION_BYTES);
	return returnPc < 0 ? -1 : returnPc - INSTRUCTION_BYTES;
}

export function buildBlua32ExecutionRevision(
	previousImage: Blua32ImageLayout,
	previousSymbols: Blua32SymbolsImage,
	previousSources: ReadonlyMap<string, string>,
	linked: LinkedBlua32Image,
	sources: ReadonlyMap<string, string>,
	correspondence = new LuaSourceCorrespondence(previousSources, sources),
): Blua32ExecutionImageRevision {
	if (previousSymbols.staticLayoutToken.lo !== linked.symbols.staticLayoutToken.lo
		|| previousSymbols.staticLayoutToken.hi !== linked.symbols.staticLayoutToken.hi) {
		throw new Error('Hot resume cannot change the static storage layout.');
	}

	const freshFunctionIndexById = new Map<string, number>();
	for (let index = 0; index < linked.symbols.metadata.functionIds.length; index += 1) {
		freshFunctionIndexById.set(linked.symbols.metadata.functionIds[index], index);
	}
	const functionAddresses = new Uint32Array(previousImage.functions.length);
	const pcAddresses = new Int32Array(previousImage.header.textByteCount / INSTRUCTION_BYTES);
	pcAddresses.fill(-1);

	for (let previousIndex = 0; previousIndex < previousSymbols.metadata.functionIds.length; previousIndex += 1) {
		const functionId = previousSymbols.metadata.functionIds[previousIndex];
		const freshIndex = freshFunctionIndexById.get(functionId);
		if (freshIndex === undefined) {
			continue;
		}
		const previousFunction = previousImage.functions[previousIndex];
		const freshFunction = linked.layout.functions[freshIndex];
		// A linker-owned tombstone retains its old cells and has no new source declaration.
		if (linked.functionProtoIndices[freshIndex] >= 0 && !closureLayoutMatches(
			previousFunction,
			previousSymbols.metadata.upvalueBindingsByFunction[previousIndex],
			previousSymbols.metadata.lexicalDeclarations,
			freshFunction,
			linked.symbols.metadata.upvalueBindingsByFunction[freshIndex],
			linked.symbols.metadata.lexicalDeclarations,
			correspondence,
		)) {
			throw new Error(`Hot resume cannot change closure identity for '${functionId}'.`);
		}
		functionAddresses[previousIndex] = freshFunction.address;
		if (functionCodeMatches(previousImage, previousFunction, linked.layout, freshFunction)) {
			const wordCount = previousFunction.codeByteCount / INSTRUCTION_BYTES;
			for (let word = 0; word < wordCount; word += 1) {
				const previousPc = previousFunction.codeAddress + word * INSTRUCTION_BYTES;
				pcAddresses[(previousPc - previousImage.header.textAddress) / INSTRUCTION_BYTES]
					= freshFunction.codeAddress + word * INSTRUCTION_BYTES;
			}
		} else {
			mapChangedFunctionProgramCounters(
				pcAddresses,
				previousImage,
				previousSymbols,
				previousIndex,
				linked.layout,
				linked.symbols,
				freshIndex,
				correspondence,
			);
		}
	}
	return { functionAddresses, pcAddresses };
}
