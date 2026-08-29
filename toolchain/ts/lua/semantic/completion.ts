import type { FileSemanticData } from './model';
import {
	appendValueMember,
	declarationValueSource,
	globalValueSource,
	type SemanticValueSource,
} from './value_graph';
import { findImplicitSelfValueAt, findVisibleDeclarationAt } from './scope_query';
import { compareSourcePosition } from './source_range';
import { LuaTokenType, type LuaToken } from '../syntax/token';

export type LuaMemberCompletionContext = {
	readonly expression: string;
	readonly operator: '.' | ':';
	readonly receiver: SemanticValueSource;
};

export function findLuaMemberCompletionContext(
	source: FileSemanticData,
	line: number,
	memberStartColumn: number,
): LuaMemberCompletionContext | null {
	const tokens = source.tokens;
	const operatorIndex = findTokenIndexBefore(tokens, line, memberStartColumn);
	if (operatorIndex < 0) {
		return null;
	}
	const operatorToken = tokens[operatorIndex];
	if (operatorToken.line !== line
		|| (operatorToken.type !== LuaTokenType.Dot && operatorToken.type !== LuaTokenType.Colon)) {
		return null;
	}

	const segments: string[] = [];
	const separators: string[] = [];
	let tokenIndex = operatorIndex - 1;
	while (tokenIndex >= 0) {
		const identifier = tokens[tokenIndex];
		if (identifier.line !== line || identifier.type !== LuaTokenType.Identifier) {
			return null;
		}
		segments.push(identifier.lexeme);
		tokenIndex -= 1;
		if (tokenIndex < 0) {
			break;
		}
		const separator = tokens[tokenIndex];
		if (separator.line !== line
			|| (separator.type !== LuaTokenType.Dot && separator.type !== LuaTokenType.Colon)) {
			break;
		}
		separators.push(separator.lexeme);
		tokenIndex -= 1;
	}
	segments.reverse();
	separators.reverse();
	const rootName = segments[0];
	const declaration = findVisibleDeclarationAt(source, rootName, line, memberStartColumn);
	let receiver = declaration
		? declarationValueSource(declaration.id)
		: rootName === 'self'
			? findImplicitSelfValueAt(source, line, memberStartColumn)
			: undefined;
	if (!receiver) {
		receiver = globalValueSource(rootName);
	}
	for (let index = 1; index < segments.length; index += 1) {
		receiver = appendValueMember(receiver, segments[index]);
	}
	const expressionParts = new Array<string>(segments.length + separators.length);
	expressionParts[0] = rootName;
	for (let index = 0; index < separators.length; index += 1) {
		expressionParts[index * 2 + 1] = separators[index];
		expressionParts[index * 2 + 2] = segments[index + 1];
	}
	return {
		expression: expressionParts.join(''),
		operator: operatorToken.type === LuaTokenType.Dot ? '.' : ':',
		receiver,
	};
}

function findTokenIndexBefore(
	tokens: readonly LuaToken[],
	line: number,
	column: number,
): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const token = tokens[middle];
		if (compareSourcePosition(token.line, token.column, line, column) < 0) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low - 1;
}
