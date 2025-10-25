export function isWhitespace(ch: string): boolean {
	return ch === '' || ch === ' ' || ch === '\t';
}

export function isWordChar(ch: string): boolean {
	if (!ch) {
		return false;
	}
	const code = ch.charCodeAt(0);
	return (code >= 48 && code <= 57)
		|| (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| ch === '_';
}

export function isIdentifierStartChar(code: number): boolean {
	if (code >= 65 && code <= 90) {
		return true;
	}
	if (code >= 97 && code <= 122) {
		return true;
	}
	return code === 95;
}

export function isIdentifierChar(code: number): boolean {
	return isIdentifierStartChar(code) || (code >= 48 && code <= 57);
}
