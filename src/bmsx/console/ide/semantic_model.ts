import { LuaLexer } from '../../lua/lexer.ts';
import { LuaParser } from '../../lua/parser.ts';
import type { LuaDefinitionInfo, LuaDefinitionKind, LuaSourceRange } from '../../lua/ast.ts';
import { analyzeLuaSemanticsFromSource, type LuaSemanticAnnotations, type LuaSemanticDefinition, type SemanticKind } from './lua_semantics';

export type { LuaSemanticDefinition } from './lua_semantics';

export type LuaSemanticModel = {
	annotations: LuaSemanticAnnotations;
	definitions: LuaDefinitionInfo[];
	lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null;
};

export function buildLuaSemanticModel(source: string, chunkName: string): LuaSemanticModel {
	const normalizedSource = source.replace(/\r\n/g, '\n');
	const semantics = analyzeLuaSemanticsFromSource(normalizedSource);
	const annotations = semantics ? semantics.annotations : [];
	const lexer = new LuaLexer(normalizedSource, chunkName);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, normalizedSource);
	const chunk = parser.parseChunk();
	const definitions: LuaDefinitionInfo[] = [];
	const seen = new Set<string>();

	const addDefinition = (definition: LuaDefinitionInfo): void => {
		const key = `${definition.namePath.join('.')}:${definition.definition.start.line}:${definition.definition.start.column}`;
		if (!seen.has(key)) {
			seen.add(key);
			definitions.push(definition);
		}
	};

	if (chunk.definitions) {
		for (let index = 0; index < chunk.definitions.length; index += 1) {
			addDefinition(chunk.definitions[index]);
		}
	}

	if (semantics && semantics.definitions.length > 0) {
		const converted = convertSemanticDefinitions(chunkName, semantics.definitions);
		for (let index = 0; index < converted.length; index += 1) {
			addDefinition(converted[index]);
		}
	}

	definitions.sort((a, b) => {
		if (a.definition.start.line !== b.definition.start.line) {
			return a.definition.start.line - b.definition.start.line;
		}
		if (a.definition.start.column !== b.definition.start.column) {
			return a.definition.start.column - b.definition.start.column;
		}
		return a.name.localeCompare(b.name);
	});

	const model: LuaSemanticModel = {
		annotations,
		definitions,
		lookupIdentifier(row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null {
			return resolveIdentifierDefinition({ annotations, definitions }, row, column, namePath);
		},
	};

	return model;
}

function resolveIdentifierDefinition(model: { annotations: LuaSemanticAnnotations; definitions: LuaDefinitionInfo[] }, row: number, column: number | null, namePath: readonly string[]): LuaDefinitionInfo | null {
	const desiredKind = resolveSemanticKind(model.annotations, row, column);
	const desiredDefinitionKind = desiredKind ? semanticKindToDefinitionKind(desiredKind) : null;
	let best: LuaDefinitionInfo | null = null;
	let bestScore = -Infinity;
	for (let index = 0; index < model.definitions.length; index += 1) {
		const definition = model.definitions[index];
		if (!matchesNamePath(definition, namePath)) {
			continue;
		}
		if (row !== null) {
			if (!positionWithinRange(row, column, definition.scope)) {
				continue;
			}
			if (column !== null
				&& row === definition.definition.start.line
				&& column === definition.definition.start.column
				&& definition.kind !== 'assignment') {
				return definition;
			}
			if (!definitionOccursBeforeUsage(definition, row, column)) {
				continue;
			}
		}
		let score = basePriority(definition.kind);
		if (desiredDefinitionKind && definition.kind === desiredDefinitionKind) {
			score += 1000;
		}
		if (row !== null && positionWithinRange(row, column, definition.definition)) {
			score += 250;
		}
		if (!best || score > bestScore || (score === bestScore && isDefinitionPreferred(definition, best))) {
			best = definition;
			bestScore = score;
		}
	}
	return best;
}

function resolveSemanticKind(annotations: LuaSemanticAnnotations, row: number, column: number | null): SemanticKind | null {
	const rowIndex = row - 1;
	if (rowIndex < 0 || rowIndex >= annotations.length) {
		return null;
	}
	const rowAnnotations = annotations[rowIndex];
	if (!rowAnnotations) {
		return null;
	}
	const columnIndex = column !== null ? Math.max(0, column - 1) : 0;
	for (let index = 0; index < rowAnnotations.length; index += 1) {
		const annotation = rowAnnotations[index];
		if (columnIndex >= annotation.start && columnIndex < annotation.end) {
			return annotation.kind;
		}
	}
	return null;
}

function matchesNamePath(definition: LuaDefinitionInfo, namePath: readonly string[]): boolean {
	if (namePath.length === 0) {
		return false;
	}
	if (definition.namePath.length === namePath.length) {
		for (let index = 0; index < namePath.length; index += 1) {
			if (definition.namePath[index] !== namePath[index]) {
				return false;
			}
		}
		return true;
	}
	const identifier = namePath[namePath.length - 1];
	return definition.name === identifier;
}

function basePriority(kind: LuaDefinitionKind): number {
	switch (kind) {
		case 'parameter':
			return 500;
		case 'variable':
			return 400;
		case 'function':
			return 300;
		case 'table_field':
			return 200;
		case 'assignment':
		default:
			return 100;
	}
}

function isDefinitionPreferred(candidate: LuaDefinitionInfo, current: LuaDefinitionInfo): boolean {
	if (candidate.definition.start.line !== current.definition.start.line) {
		return candidate.definition.start.line > current.definition.start.line;
	}
	if (candidate.definition.start.column !== current.definition.start.column) {
		return candidate.definition.start.column > current.definition.start.column;
	}
	return candidate.name.localeCompare(current.name) < 0;
}

function positionWithinRange(row: number, column: number | null, range: LuaSourceRange): boolean {
	if (row < range.start.line || row > range.end.line) {
		return false;
	}
	if (row === range.start.line && column !== null && column < range.start.column) {
		return false;
	}
	if (row === range.end.line && column !== null && column > range.end.column) {
		return false;
	}
	return true;
}

function definitionOccursBeforeUsage(definition: LuaDefinitionInfo, usageRow: number | null, usageColumn: number | null): boolean {
	if (usageRow === null) {
		return true;
	}
	if (usageRow < definition.definition.start.line) {
		return false;
	}
	if (usageRow === definition.definition.start.line && usageColumn !== null && usageColumn <= definition.definition.start.column) {
		return false;
	}
	return true;
}

function convertSemanticDefinitions(chunkName: string, definitions: readonly LuaSemanticDefinition[]): LuaDefinitionInfo[] {
	const result: LuaDefinitionInfo[] = [];
	for (let index = 0; index < definitions.length; index += 1) {
		const semantic = definitions[index];
		const kind = semanticKindToDefinitionKind(semantic.kind);
		const definitionRange: LuaSourceRange = {
			chunkName,
			start: { line: semantic.startLine, column: semantic.startColumn },
			end: { line: semantic.endLine, column: semantic.endColumn },
		};
		const scopeRange: LuaSourceRange = {
			chunkName,
			start: { line: semantic.scopeStartLine, column: semantic.scopeStartColumn },
			end: { line: semantic.scopeEndLine, column: semantic.scopeEndColumn },
		};
		result.push({
			name: semantic.name,
			namePath: [semantic.name],
			definition: definitionRange,
			scope: scopeRange,
			kind,
		});
	}
	return result;
}

function semanticKindToDefinitionKind(kind: SemanticKind): LuaDefinitionKind {
	switch (kind) {
		case 'parameter':
			return 'parameter';
		case 'functionTop':
		case 'functionLocal':
			return 'function';
		case 'localFunction':
		case 'localTop':
		default:
			return 'variable';
	}
}
