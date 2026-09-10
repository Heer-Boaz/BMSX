const singleQuoteEscapes = /['\\\x00-\x1f\x7f]/g;
const doubleQuoteEscapes = /["\\\x00-\x1f\x7f]/g;

function escapeCharacter(character: string): string {
	switch (character) {
		case '\\': case "'": case '"': return '\\' + character;
		case '\n': return '\\n';
		case '\r': return '\\r';
		case '\t': return '\\t';
		default: return '\\x' + character.charCodeAt(0).toString(16).padStart(2, '0');
	}
}

/** One Lua short-string token; fixed-width byte escapes cannot absorb following digits. */
export function quoteLuaString(value: string, quote: "'" | '"' = "'"): string {
	return quote + value.replace(quote === "'" ? singleQuoteEscapes : doubleQuoteEscapes, escapeCharacter) + quote;
}
