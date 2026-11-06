/** UTF-16 source offsets remain code-unit offsets; visual steps consume codepoints. */
export function splitsSurrogatePair(text: string, offset: number): boolean {
	const previous = text.charCodeAt(offset - 1), next = text.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

/** The caller supplies a character start before text.length. Unpaired units are characters too. */
export function nextCodePointOffset(text: string, offset: number): number {
	return offset + (text.codePointAt(offset)! > 0xffff ? 2 : 1);
}

/** Font keys are complete characters; keep the ordinary single-unit path substring-free. */
export function codePointTextAt(text: string, offset: number): string {
	return text.codePointAt(offset)! > 0xffff ? text.slice(offset, offset + 2) : text.charAt(offset);
}

/** The caller supplies a character end after zero. */
export function previousCodePointOffset(text: string, offset: number): number {
	return offset - (splitsSurrogatePair(text, offset - 1) ? 2 : 1);
}
