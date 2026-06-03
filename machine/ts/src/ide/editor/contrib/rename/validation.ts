import { LuaLexer } from '../../../../lua/syntax/lexer';

export type RenameValidationResult =
	| 'ok'
	| 'unchanged'
	| 'empty'
	| 'invalid_start'
	| 'invalid_characters';

export function validateRenameIdentifier(nextName: string, originalName: string): RenameValidationResult {
	if (nextName.length === 0) {
		return 'empty';
	}
	if (!LuaLexer.isIdentifierStart(nextName.charAt(0))) {
		return 'invalid_start';
	}
	for (let index = 1; index < nextName.length; index += 1) {
		if (!LuaLexer.isIdentifierPart(nextName.charAt(index))) {
			return 'invalid_characters';
		}
	}
	if (nextName === originalName) {
		return 'unchanged';
	}
	return 'ok';
}
