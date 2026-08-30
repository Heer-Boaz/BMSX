import type { LuaSourceRange } from '../syntax/ast';
import type { FileSemanticData } from './model';
import { resolveStaticLuaNamePath } from './expression_path';
import { findLuaSemanticOccurrenceAt } from './position_query';

export type LuaEvaluatableExpression = {
	readonly expression: string;
	readonly range: LuaSourceRange;
};

export function provideLuaEvaluatableExpression(
	analysis: FileSemanticData,
	line: number,
	column: number,
): LuaEvaluatableExpression | null {
	const occurrence = findLuaSemanticOccurrenceAt(analysis, line, column);
	if (occurrence === null) {
		return null;
	}
	if (occurrence.kind === 'declaration') {
		const declaration = occurrence.declaration;
		const expression = resolveStaticLuaNamePath(declaration.namePath);
		if (expression === null) {
			return null;
		}
		return {
			expression,
			range: declaration.range,
		};
	}
	const reference = occurrence.reference;
	if (reference.staticExpressionPath === null) {
		return null;
	}
	return {
		expression: reference.staticExpressionPath,
		range: reference.range,
	};
}
