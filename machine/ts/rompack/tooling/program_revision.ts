import type {
	LocalSlotDebug,
	Program,
	ProgramMetadata,
	ProgramResumePoint,
	SourcePosition,
	SourceRange,
} from '../../machine/cpu/cpu';
import { INSTRUCTION_BYTES } from '../../machine/cpu/instruction_format';
import { compareSourcePosition, sourcePositionInRange, sourceRangeKey } from '../../lua/semantic/source_range';

type PreparedSourceRevision = {
	oldChangeStart: SourcePosition;
	oldSuffixStart: SourcePosition;
	newSuffixStart: SourcePosition;
};

export type PreparedProgramSourceRevisions = ReadonlyMap<string, PreparedSourceRevision>;

export function composeProgramCounterRelocations(
	relocations: Int32Array,
	next: Int32Array,
): void {
	for (let word = 0; word < relocations.length; word += 1) {
		const pc = relocations[word];
		relocations[word] = next[pc / INSTRUCTION_BYTES];
	}
}

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

export function prepareProgramSourceRevisions(
	previousSources: ReadonlyMap<string, string>,
	sources: ReadonlyMap<string, string>,
): PreparedProgramSourceRevisions {
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
			&& previousSource.charCodeAt(previousSource.length - suffix - 1) === source.charCodeAt(source.length - suffix - 1)) {
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

function translateSuffixPosition(
	position: SourcePosition,
	revision: PreparedSourceRevision,
): SourcePosition {
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
	revisions: PreparedProgramSourceRevisions,
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

function registerListsMatch(base: ReadonlyArray<number>, fresh: ReadonlyArray<number>): boolean {
	if (base.length !== fresh.length) {
		return false;
	}
	for (let index = 0; index < base.length; index += 1) {
		if (base[index] !== fresh[index]) {
			return false;
		}
	}
	return true;
}

function resumePointShapeMatches(base: ProgramResumePoint, fresh: ProgramResumePoint): boolean {
	return base.op === fresh.op
		&& registerListsMatch(base.liveRegisters, fresh.liveRegisters)
		&& registerListsMatch(base.uses, fresh.uses)
		&& registerListsMatch(base.defs, fresh.defs);
}

function activeLocalLayoutMatches(
	baseSlots: ReadonlyArray<LocalSlotDebug>,
	freshSlots: ReadonlyArray<LocalSlotDebug>,
	baseRange: SourceRange,
	freshRange: SourceRange,
): boolean {
	let baseIndex = 0;
	let freshIndex = 0;
	while (true) {
		while (baseIndex < baseSlots.length) {
			const scope = baseSlots[baseIndex].scope;
			if (scope.path === baseRange.path
				&& sourcePositionInRange(baseRange.start.line, baseRange.start.column, scope)) {
				break;
			}
			baseIndex += 1;
		}
		while (freshIndex < freshSlots.length) {
			const scope = freshSlots[freshIndex].scope;
			if (scope.path === freshRange.path
				&& sourcePositionInRange(freshRange.start.line, freshRange.start.column, scope)) {
				break;
			}
			freshIndex += 1;
		}
		if (baseIndex === baseSlots.length || freshIndex === freshSlots.length) {
			return baseIndex === baseSlots.length && freshIndex === freshSlots.length;
		}
		const baseSlot = baseSlots[baseIndex];
		const freshSlot = freshSlots[freshIndex];
		if (baseSlot.name !== freshSlot.name || baseSlot.register !== freshSlot.register) {
			return false;
		}
		baseIndex += 1;
		freshIndex += 1;
	}
}

export function mapChangedProtoProgramCounters(
	pcRelocations: Int32Array,
	baseProgram: Program,
	baseMetadata: ProgramMetadata,
	liveProtoIndex: number,
	objectMetadata: ProgramMetadata,
	freshProtoIndex: number,
	entryPC: number,
	sourceRevisions: PreparedProgramSourceRevisions,
): void {
	const baseProto = baseProgram.protos[liveProtoIndex];
	const freshPointsByRange = new Map<string, ProgramResumePoint>();
	const freshPoints = objectMetadata.resumePointsByProto[freshProtoIndex];
	for (let index = 0; index < freshPoints.length; index += 1) {
		const point = freshPoints[index];
		freshPointsByRange.set(`${point.range.path}\0${sourceRangeKey(point.range)}`, point);
	}

	const basePoints = baseMetadata.resumePointsByProto[liveProtoIndex];
	for (let index = 0; index < basePoints.length; index += 1) {
		const basePoint = basePoints[index];
		const freshRange = translateSourceRange(basePoint.range, sourceRevisions);
		if (freshRange === null) {
			continue;
		}
		const freshPoint = freshPointsByRange.get(`${freshRange.path}\0${sourceRangeKey(freshRange)}`);
		if (freshPoint === undefined || !resumePointShapeMatches(basePoint, freshPoint)) {
			continue;
		}
		if (!activeLocalLayoutMatches(
			baseMetadata.localSlotsByProto[liveProtoIndex],
			objectMetadata.localSlotsByProto[freshProtoIndex],
			basePoint.range,
			freshPoint.range,
		)) {
			continue;
		}
		pcRelocations[(baseProto.entryPC / INSTRUCTION_BYTES) + basePoint.wordOffset]
			= entryPC + freshPoint.wordOffset * INSTRUCTION_BYTES;
	}
}
