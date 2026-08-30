import { LuaLexer } from './lexer';
import { KEYWORDS } from './token';

export function isLuaIdentifier(value: string): boolean {
	if (value.length === 0
		|| KEYWORDS.has(value)
		|| !LuaLexer.isIdentifierStart(value.charAt(0))) {
		return false;
	}
	for (let index = 1; index < value.length; index += 1) {
		if (!LuaLexer.isIdentifierPart(value.charAt(index))) {
			return false;
		}
	}
	return true;
}
