import type { Decl, FileSemanticData } from './model';
import type { SemanticValueSource } from './value_graph';
import { compareSourcePosition } from './source_range';

export function findInnermostScopeIndex(
	source: FileSemanticData,
	line: number,
	column: number,
): number {
	const scopes = source.scopes;
	let low = 0;
	let high = scopes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const start = scopes[middle].startInclusive;
		if (compareSourcePosition(start.line, start.column, line, column) <= 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	let scopeIndex = low - 1;
	while (scopeIndex >= 0) {
		const scope = scopes[scopeIndex];
		const end = scope.endExclusive;
		if (compareSourcePosition(line, column, end.line, end.column) < 0) {
			return scopeIndex;
		}
		scopeIndex = scope.parentIndex;
	}
	return -1;
}

export function findVisibleDeclarationAt(
	source: FileSemanticData,
	name: string,
	line: number,
	column: number,
): Decl | undefined {
	let scopeIndex = findInnermostScopeIndex(source, line, column);
	while (scopeIndex >= 0) {
		const scope = source.scopes[scopeIndex];
		const indices = scope.declarationIndices;
		for (let index = indices.length - 1; index >= 0; index -= 1) {
			const declaration = source.decls[indices[index]];
			if (declaration.name === name
				&& compareSourcePosition(
					line,
					column,
					declaration.visibleFrom.line,
					declaration.visibleFrom.column,
				) > 0) {
				return declaration;
			}
		}
		scopeIndex = scope.parentIndex;
	}
	return undefined;
}

export function findImplicitSelfValueAt(
	source: FileSemanticData,
	line: number,
	column: number,
): SemanticValueSource | undefined {
	const scopeIndex = findInnermostScopeIndex(source, line, column);
	return scopeIndex < 0 ? undefined : source.scopes[scopeIndex].implicitSelfValue;
}

export function collectVisibleDeclarationsAt(
	source: FileSemanticData,
	line: number,
	column: number,
): readonly Decl[] {
	let scopeIndex = findInnermostScopeIndex(source, line, column);
	if (scopeIndex < 0) {
		return [];
	}
	const declarations: Decl[] = [];
	const names = new Set<string>();
	while (scopeIndex >= 0) {
		const scope = source.scopes[scopeIndex];
		const indices = scope.declarationIndices;
		for (let index = indices.length - 1; index >= 0; index -= 1) {
			const declaration = source.decls[indices[index]];
			if (names.has(declaration.name)
				|| compareSourcePosition(
					line,
					column,
					declaration.visibleFrom.line,
					declaration.visibleFrom.column,
				) <= 0) {
				continue;
			}
			names.add(declaration.name);
			declarations.push(declaration);
		}
		scopeIndex = scope.parentIndex;
	}
	return declarations;
}
