const singleQuoteEscapes = /['\\\x00-\x1f\x7f]/g;
const doubleQuoteEscapes = /["\\\x00-\x1f\x7f]/g;

const singleQuoteByteEscapes = /['\\\x00-\x1f\x7f-\xff]/g;
const doubleQuoteByteEscapes = /["\\\x00-\x1f\x7f-\xff]/g;

function escapeCharacter(character: string): string {
	switch (character) {
		case '\\': case "'": case '"': return '\\' + character;
		case '\n': return '\\n';
		case '\r': return '\\r';
		case '\t': return '\\t';
		default: return '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0');
	}
}

/** Quote authored text. The lexer encodes unescaped Unicode as UTF-8. */
export function quoteLuaString(value: string, quote: "'" | '"' = "'"): string {
	return quote + value.replace(quote === "'" ? singleQuoteEscapes : doubleQuoteEscapes, escapeCharacter) + quote;
}

/** Re-emit semantic bytes without passing high bytes through UTF-8 encoding again. */
export function quoteLuaByteString(value: string, quote: "'" | '"' = "'"): string {
	return quote + value.replace(quote === "'" ? singleQuoteByteEscapes : doubleQuoteByteEscapes, escapeCharacter) + quote;
}
