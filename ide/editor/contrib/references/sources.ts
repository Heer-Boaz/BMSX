import { splitText } from '../../../../machine/ts/common/text_lines';
import { compareSourcePosition } from '../../../../toolchain/ts/lua/semantic/source_range';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ReferenceMatchInfo } from './state';

export type ReferenceSource = {
	readonly range: LuaSourceRange;
	readonly kind: 'definition' | 'reference';
	readonly lineText: string;
};

/** Source locations and preview text belong to the same immutable query snapshot. */
export function buildReferenceSources(info: ReferenceMatchInfo): ReferenceSource[] {
	const linesByPath = new Map<string, readonly string[]>();
	const sources: ReferenceSource[] = [];
	const append = (range: LuaSourceRange, kind: ReferenceSource['kind']) => {
		let lines = linesByPath.get(range.path);
		if (lines === undefined) {
			lines = splitText(info.snapshot.getFileData(range.path).source);
			linesByPath.set(range.path, lines);
		}
		sources.push({ range, kind, lineText: lines[range.start.line - 1].trim() });
	};
	for (const target of info.query.targets) append(target.declaration.range, 'definition');
	for (const reference of info.query.references) append(reference.range, 'reference');
	sources.sort((left, right) => left.range.path.localeCompare(right.range.path)
		|| compareSourcePosition(left.range.start.line, left.range.start.column, right.range.start.line, right.range.start.column));
	return sources;
}
