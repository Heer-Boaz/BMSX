import { splitText } from '../../../../machine/ts/common/text_lines';
import { compareSourcePosition } from '../../../../toolchain/ts/lua/semantic/source_range';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ReferenceMatchInfo } from './state';
import type { FileSemanticData, Ref } from '../../../../toolchain/ts/lua/semantic/model';

export type ReferenceSource = {
	readonly range: LuaSourceRange;
	readonly kind: 'definition' | 'reference';
	readonly lineText: string;
};

/** Source locations and preview text belong to the same immutable query snapshot. */
export function buildReferenceSources(info: ReferenceMatchInfo): ReferenceSource[] {
	const sourceByPath = new Map<string, { file: FileSemanticData; lines: readonly string[] }>();
	const sources: ReferenceSource[] = [];
	const append = (occurrence: Pick<Ref, 'file' | 'span'>, kind: ReferenceSource['kind']) => {
		let source = sourceByPath.get(occurrence.file);
		if (source === undefined) {
			const file = info.snapshot.getFileData(occurrence.file)!;
			source = { file, lines: splitText(file.source) };
			sourceByPath.set(occurrence.file, source);
		}
		const range = source.file.chunk.locations.range(occurrence.span);
		sources.push({ range, kind, lineText: source.lines[range.start.line - 1].trim() });
	};
	for (const target of info.query.targets) append(target.declaration, 'definition');
	for (const reference of info.query.references) append(reference, 'reference');
	sources.sort((left, right) => left.range.path.localeCompare(right.range.path)
		|| compareSourcePosition(left.range.start.line, left.range.start.column, right.range.start.line, right.range.start.column));
	return sources;
}
