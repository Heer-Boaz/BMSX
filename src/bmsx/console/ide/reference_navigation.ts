import type { ConsoleCodeLayout } from './code_layout';
import type { SearchMatch } from './types';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast.ts';

export type ExtractIdentifierExpression = (row: number, column: number) => { expression: string; startColumn: number; endColumn: number } | null;

export type ReferenceLookupOptions = {
	layout: ConsoleCodeLayout;
	lines: readonly string[];
	textVersion: number;
	cursorRow: number;
	cursorColumn: number;
	extractExpression: ExtractIdentifierExpression;
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
	private definitionKey: string | null = null;
	private documentVersion = -1;

	public clear(): void {
		this.matches = [];
		this.activeIndex = -1;
		this.expression = null;
		this.definitionKey = null;
		this.documentVersion = -1;
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

	public hasSameQuery(info: ReferenceMatchInfo): boolean {
		return this.definitionKey === info.definitionKey
			&& this.expression === info.expression
			&& this.documentVersion === info.documentVersion;
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
		this.definitionKey = info.definitionKey;
		this.documentVersion = info.documentVersion;
	}

	public advance(delta: number): number {
		if (this.matches.length === 0) {
			this.activeIndex = -1;
			return -1;
		}
		const next = (this.activeIndex + delta + this.matches.length) % this.matches.length;
		this.activeIndex = next;
		return this.activeIndex;
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

	public getCurrentMatch(): SearchMatch | null {
		if (this.activeIndex < 0 || this.activeIndex >= this.matches.length) {
			return null;
		}
		return this.matches[this.activeIndex];
	}
}

export function resolveReferenceLookup(options: ReferenceLookupOptions): ReferenceLookupResult {
	const { layout, lines, textVersion, cursorRow, cursorColumn, extractExpression } = options;
	const model = layout.getSemanticModel(lines, textVersion);
	if (!model) {
		return { kind: 'error', message: 'References unavailable', duration: 1.6 };
	}
	const identifier = extractExpression(cursorRow, cursorColumn);
	if (!identifier) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const namePath = identifier.expression.split('.').filter(part => part.length > 0);
	if (namePath.length === 0) {
		return { kind: 'error', message: 'No identifier at cursor', duration: 1.6 };
	}
	const definition = model.lookupIdentifier(cursorRow + 1, identifier.startColumn + 1, namePath);
	if (!definition) {
		return {
			kind: 'error',
			message: `Definition not found for ${identifier.expression}`,
			duration: 1.8,
		};
	}
	const references = model.getDefinitionReferences(definition);
	if (!references || references.length === 0) {
		return { kind: 'error', message: 'No references found', duration: 1.6 };
	}
	const matches: SearchMatch[] = [];
	for (let i = 0; i < references.length; i += 1) {
		const match = rangeToSearchMatch(references[i], lines);
		if (match) {
			matches.push(match);
		}
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
	let initialIndex = -1;
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (match.row === cursorRow && cursorColumn >= match.start && cursorColumn < match.end) {
			initialIndex = i;
			break;
		}
	}
	if (initialIndex === -1) {
		initialIndex = 0;
	}
	const info: ReferenceMatchInfo = {
		matches,
		expression: identifier.expression,
		definitionKey: buildDefinitionKey(definition),
		documentVersion: textVersion,
	};
	return { kind: 'success', info, initialIndex };
}

function buildDefinitionKey(definition: LuaDefinitionInfo): string {
	const path = definition.namePath.join('.');
	return `${definition.definition.start.line}:${definition.definition.start.column}:${definition.definition.end.line}:${definition.definition.end.column}:${definition.kind}:${path}`;
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
