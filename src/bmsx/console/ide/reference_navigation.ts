import type { ConsoleCodeLayout } from './code_layout';
import type { SearchMatch } from './types';
import { LuaSemanticWorkspace } from './semantic_workspace';
import type { LuaSourceRange } from '../../lua/ast';

export type ExtractIdentifierExpression = (row: number, column: number) => { expression: string; startColumn: number; endColumn: number } | null;

export type ReferenceLookupOptions = {
	layout: ConsoleCodeLayout;
	workspace: LuaSemanticWorkspace;
	lines: readonly string[];
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	extractExpression: ExtractIdentifierExpression;
	chunkName: string;
};

export type ReferenceMatchInfo = {
	matches: SearchMatch[];
	expression: string;
	definitionKey: string;
	documentVersion: number;
};

export type ReferenceLookupResult =
	| { kind: 'success'; info: ReferenceMatchInfo; initialIndex: number }
	| { kind: 'error'; message: string; duration: number };

export class ReferenceState {
	private matches: SearchMatch[] = [];
	private activeIndex = -1;
	private expression: string | null = null;

	public clear(): void {
		this.matches = [];
		this.activeIndex = -1;
		this.expression = null;
	}

	public getMatches(): readonly SearchMatch[] {
		return this.matches;
	}

	public getActiveIndex(): number {
		return this.activeIndex;
	}

	public getExpression(): string | null {
		return this.expression;
	}

	public apply(info: ReferenceMatchInfo, activeIndex: number): void {
		this.matches = info.matches.slice();
		if (this.matches.length === 0) {
			this.activeIndex = -1;
		} else {
			const clampedIndex = Math.max(0, Math.min(activeIndex, this.matches.length - 1));
			this.activeIndex = clampedIndex;
		}
		this.expression = info.expression;
	}

	public setActiveIndex(index: number): void {
		if (this.matches.length === 0) {
			this.activeIndex = -1;
			return;
		}
		if (index < 0) {
			this.activeIndex = 0;
			return;
		}
		if (index >= this.matches.length) {
			this.activeIndex = this.matches.length - 1;
			return;
		}
		this.activeIndex = index;
	}
}

export function resolveReferenceLookup(options: ReferenceLookupOptions): ReferenceLookupResult {
	const {
		layout,
		workspace,
		lines,
		textVersion,
		cursorRow,
		cursorColumn,
		extractExpression,
		chunkName,
	} = options;
	const model = layout.getSemanticModel(lines, textVersion, chunkName);
	if (!model) {
		return { kind: 'error', message: 'References unavailable', duration: 1.6 };
	}
	const identifier = extractExpression(cursorRow, cursorColumn);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const resolution = workspace.findReferencesByPosition(chunkName, cursorRow + 1, cursorColumn + 1);
	if (!resolution) {
		return {
			kind: 'error',
			message: `Definition not found for ${identifier.expression}`,
			duration: 1.8,
		};
	}
	const matches: SearchMatch[] = [];
	const seen = new Set<string>();
	const definitionRange = resolution.decl.range;
	if (definitionRange.chunkName === chunkName) {
		const definitionMatch = rangeToSearchMatch(definitionRange, lines);
		if (definitionMatch) {
			const key = `${definitionMatch.row}:${definitionMatch.start}`;
			seen.add(key);
			matches.push(definitionMatch);
		}
	}
	const references = resolution.references;
	for (let index = 0; index < references.length; index += 1) {
		const reference = references[index];
		if (reference.file !== chunkName) {
			continue;
		}
		const match = rangeToSearchMatch(reference.range, lines);
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
	matches.sort((a, b) => {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.start - b.start;
	});
	let initialIndex = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match.row === cursorRow && cursorColumn >= match.start && cursorColumn < match.end) {
			initialIndex = index;
			break;
		}
	}
	const info: ReferenceMatchInfo = {
		matches,
		expression: identifier.expression,
		definitionKey: resolution.id,
		documentVersion: textVersion,
	};
	return { kind: 'success', info, initialIndex };
}

function rangeToSearchMatch(range: LuaSourceRange, lines: readonly string[]): SearchMatch | null {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	const startColumn = Math.max(0, range.start.column - 1);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = Math.min(line.length, endInclusive + 1);
	const clampedStart = Math.min(startColumn, line.length);
	const clampedEnd = Math.max(clampedStart, endExclusive);
	if (clampedEnd <= clampedStart) {
		return null;
	}
	return { row: rowIndex, start: clampedStart, end: clampedEnd };
}
