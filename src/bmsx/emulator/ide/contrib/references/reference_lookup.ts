import { buildEditorSemanticFrontend } from '../../editor_semantic_frontend';
import type { ReferenceMatchInfo } from './reference_state';
import type { TextBuffer } from '../../text/text_buffer';
import type { SearchMatch } from '../../types';

export type ExtractIdentifierExpression = (row: number, column: number) => { expression: string; startColumn: number; endColumn: number };

export type ReferenceLookupOptions = {
	buffer: TextBuffer;
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	extractExpression: ExtractIdentifierExpression;
	path: string;
};

export type ReferenceLookupResult =
	| { kind: 'success'; info: ReferenceMatchInfo; initialIndex: number; }
	| { kind: 'error'; message: string; duration: number; };

export function resolveReferenceLookup(options: ReferenceLookupOptions): ReferenceLookupResult {
	const identifier = options.extractExpression(options.cursorRow, options.cursorColumn);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const frontend = buildEditorSemanticFrontend(options.path, options.buffer, options.textVersion);
	const resolution = frontend.findReferencesByPosition(options.path, options.cursorRow + 1, options.cursorColumn + 1);
	if (!resolution) {
		return { kind: 'error', message: `Definition not found for ${identifier.expression}`, duration: 1.8 };
	}
	const matches: SearchMatch[] = [];
	const seen = new Set<string>();
	if (resolution.decl.file === options.path) {
		const definitionMatch = rangeToSearchMatchInBuffer(resolution.decl.range, options.buffer);
		if (definitionMatch) {
			const key = `${definitionMatch.row}:${definitionMatch.start}`;
			seen.add(key);
			matches.push(definitionMatch);
		}
	}
	for (let index = 0; index < resolution.references.length; index += 1) {
		const reference = resolution.references[index];
		if (reference.file !== options.path) {
			continue;
		}
		const match = rangeToSearchMatchInBuffer(reference.range, options.buffer);
		if (!match) {
			continue;
		}
		const key = `${match.row}:${match.start}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		matches.push(match);
	}
	if (matches.length === 0) {
		return { kind: 'error', message: 'No references found in this document', duration: 1.6 };
	}
	matches.sort((left, right) => left.row !== right.row ? left.row - right.row : left.start - right.start);
	let initialIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row === options.cursorRow && options.cursorColumn >= match.start && options.cursorColumn < match.end) {
			initialIndex = index;
			break;
		}
	}
	return {
		kind: 'success',
		info: {
			matches,
			expression: identifier.expression,
			definitionKey: resolution.id,
			documentVersion: options.textVersion,
		},
		initialIndex,
	};
}

function rangeToSearchMatchInBuffer(
	range: { start: { line: number; column: number }; end: { line: number; column: number } },
	buffer: TextBuffer,
): SearchMatch {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= buffer.getLineCount()) {
		return null;
	}
	const line = buffer.getLineContent(rowIndex);
	const start = Math.max(0, Math.min(line.length, range.start.column - 1));
	const end = Math.max(start, Math.min(line.length, Math.max(start, range.end.column - 1) + 1));
	return end > start ? { row: rowIndex, start, end } : null;
}
