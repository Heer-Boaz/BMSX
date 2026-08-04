import type { Blua32FunctionRecord, Blua32ImageLayout } from './blua32_image';
import type {
	Blua32InlineCallSite,
	Blua32LocalSlotDebug,
	Blua32ResumePoint,
	Blua32SymbolsImage,
} from './blua32_symbols';
import { INSTRUCTION_BYTES, readInstructionWord } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import {
	compareSourcePosition,
	sourcePositionInRange,
	sourceRangeKey,
} from '../lua/semantic/source_range';
import type { SourcePosition, SourceRange } from '../lua/source_range';
import type { LinkedBlua32Image } from './blua32_linker';
import { resolveInlineLocalContextRange } from '../lua/compiler/inline_debug';

type PreparedSourceRevision = {
	oldChangeStart: SourcePosition;
	oldSuffixStart: SourcePosition;
	newSuffixStart: SourcePosition;
};

function sourcePositionAtOffset(source: string, offset: number): SourcePosition {
	let line = 1;
	let column = 1;
	for (let index = 0; index < offset; index += 1) {
		if (source.charCodeAt(index) === 10) {
			line += 1;
			column = 1;
		} else {
			column += 1;
		}
	}
	return { line, column };
}

function prepareSourceRevisions(
	previousSources: ReadonlyMap<string, string>,
	sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, PreparedSourceRevision> {
	const prepared = new Map<string, PreparedSourceRevision>();
	for (const [path, source] of sources) {
		const previousSource = previousSources.get(path);
		if (previousSource === undefined || previousSource === source) {
			continue;
		}
		let prefix = 0;
		while (prefix < previousSource.length
			&& prefix < source.length
			&& previousSource.charCodeAt(prefix) === source.charCodeAt(prefix)) {
			prefix += 1;
		}
		let suffix = 0;
		while (previousSource.length - suffix > prefix
			&& source.length - suffix > prefix
			&& previousSource.charCodeAt(previousSource.length - suffix - 1)
				=== source.charCodeAt(source.length - suffix - 1)) {
			suffix += 1;
		}
		prepared.set(path, {
			oldChangeStart: sourcePositionAtOffset(previousSource, prefix),
			oldSuffixStart: sourcePositionAtOffset(previousSource, previousSource.length - suffix),
			newSuffixStart: sourcePositionAtOffset(source, source.length - suffix),
		});
	}
	return prepared;
}

function translateSuffixPosition(position: SourcePosition, revision: PreparedSourceRevision): SourcePosition {
	if (position.line === revision.oldSuffixStart.line) {
		return {
			line: revision.newSuffixStart.line,
			column: revision.newSuffixStart.column + position.column - revision.oldSuffixStart.column,
		};
	}
	return {
		line: revision.newSuffixStart.line + position.line - revision.oldSuffixStart.line,
		column: position.column,
	};
}

function translateSourceRange(
	range: SourceRange,
	revisions: ReadonlyMap<string, PreparedSourceRevision>,
): SourceRange | null {
	const revision = revisions.get(range.path);
	if (revision === undefined) {
		return range;
	}
	if (compareSourcePosition(
		range.end.line,
		range.end.column,
		revision.oldChangeStart.line,
		revision.oldChangeStart.column,
	) < 0) {
		return range;
	}
	if (compareSourcePosition(
		range.start.line,
		range.start.column,
		revision.oldSuffixStart.line,
		revision.oldSuffixStart.column,
	) >= 0) {
		return {
			path: range.path,
			start: translateSuffixPosition(range.start, revision),
			end: translateSuffixPosition(range.end, revision),
		};
	}
	return null;
}

function resumePointShapeMatches(previous: Blua32ResumePoint, fresh: Blua32ResumePoint): boolean {
	return previous.op === fresh.op
		&& numberArraysEqual(previous.liveRegisters, fresh.liveRegisters)
		&& numberArraysEqual(previous.uses, fresh.uses)
		&& numberArraysEqual(previous.defs, fresh.defs);
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
	revisions: ReadonlyMap<string, PreparedSourceRevision>,
): ReadonlyArray<Blua32InlineCallSite> | null {
	if (inlineCallSites.length === 0) {
		return inlineCallSites;
	}
	const translated = new Array<Blua32InlineCallSite>(inlineCallSites.length);
	for (let index = 0; index < inlineCallSites.length; index += 1) {
		const callSite = inlineCallSites[index];
		const callRange = translateSourceRange(callSite.callRange, revisions);
		if (callRange === null) {
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
			if (contextRange !== null
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
			if (contextRange !== null
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
		if (previousSlot.name !== freshSlot.name || previousSlot.registerIndex !== freshSlot.registerIndex) {
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
	previousNames: ReadonlyArray<string>,
	freshFunction: Blua32FunctionRecord,
	freshNames: ReadonlyArray<string>,
): boolean {
	if (previousFunction.staticClosure !== freshFunction.staticClosure
		|| previousFunction.upvalues.length !== freshFunction.upvalues.length
		|| previousNames.length !== freshNames.length) {
		return false;
	}
	for (let index = 0; index < previousFunction.upvalues.length; index += 1) {
		const previous = previousFunction.upvalues[index];
		const fresh = freshFunction.upvalues[index];
		if (previous.inStack !== fresh.inStack
			|| previous.index !== fresh.index
			|| previousNames[index] !== freshNames[index]) {
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
	sourceRevisions: ReadonlyMap<string, PreparedSourceRevision>,
): void {
	const freshPointsByLocation = new Map<string, Blua32ResumePoint>();
	const freshPoints = freshSymbols.metadata.resumePointsByFunction[freshFunctionIndex];
	for (let index = 0; index < freshPoints.length; index += 1) {
		const point = freshPoints[index];
		freshPointsByLocation.set(
			resumePointLocationKey(point.range, point.inlineCallSites),
			point,
		);
	}

	const previousFunction = previousImage.functions[previousFunctionIndex];
	const freshFunction = freshImage.functions[freshFunctionIndex];
	const previousPoints = previousSymbols.metadata.resumePointsByFunction[previousFunctionIndex];
	for (let index = 0; index < previousPoints.length; index += 1) {
		const previousPoint = previousPoints[index];
		const freshRange = translateSourceRange(previousPoint.range, sourceRevisions);
		if (freshRange === null) {
			continue;
		}
		const freshInlineCallSites = translateInlineCallSites(
			previousPoint.inlineCallSites,
			sourceRevisions,
		);
		if (freshInlineCallSites === null) {
			continue;
		}
		const freshPoint = freshPointsByLocation.get(
			resumePointLocationKey(freshRange, freshInlineCallSites),
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

export function relocatedInstructionPc(
	revision: Blua32ExecutionImageRevision,
	previousImage: Blua32ImageLayout,
	freshImage: Blua32ImageLayout,
	pc: number,
): number {
	const previousWordIndex = (pc - previousImage.header.textAddress) / INSTRUCTION_BYTES;
	const previousInstructionPc = previousWordIndex > 0
		&& ((readInstructionWord(previousImage.textBytes, previousWordIndex - 1) >>> 18) & 0x3f) === OpCode.WIDE
		? pc - INSTRUCTION_BYTES
		: pc;
	const freshInstructionPc = relocatedContinuationPc(revision, previousImage, previousInstructionPc);
	if (freshInstructionPc < 0) {
		return -1;
	}
	const freshWordIndex = (freshInstructionPc - freshImage.header.textAddress) / INSTRUCTION_BYTES;
	return ((readInstructionWord(freshImage.textBytes, freshWordIndex) >>> 18) & 0x3f) === OpCode.WIDE
		? freshInstructionPc + INSTRUCTION_BYTES
		: freshInstructionPc;
}

export function buildBlua32ExecutionRevision(
	previousImage: Blua32ImageLayout,
	previousSymbols: Blua32SymbolsImage,
	previousSources: ReadonlyMap<string, string>,
	linked: LinkedBlua32Image,
	sources: ReadonlyMap<string, string>,
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
	const sourceRevisions = prepareSourceRevisions(previousSources, sources);

	for (let previousIndex = 0; previousIndex < previousSymbols.metadata.functionIds.length; previousIndex += 1) {
		const functionId = previousSymbols.metadata.functionIds[previousIndex];
		const freshIndex = freshFunctionIndexById.get(functionId);
		if (freshIndex === undefined) {
			continue;
		}
		const previousFunction = previousImage.functions[previousIndex];
		const freshFunction = linked.layout.functions[freshIndex];
		if (!closureLayoutMatches(
			previousFunction,
			previousSymbols.metadata.upvalueNamesByFunction[previousIndex],
			freshFunction,
			linked.symbols.metadata.upvalueNamesByFunction[freshIndex],
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
				sourceRevisions,
			);
		}
	}
	return { functionAddresses, pcAddresses };
}
