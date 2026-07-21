export function utf8CodepointCount(text: string): number {
	let count = 0;
	for (const _char of text) {
		count += 1;
	}
	return count;
}

export function utf8ByteLength(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 0x80) {
			bytes += 1;
		}
		else if (code < 0x800) {
			bytes += 2;
		}
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
			}
			else {
				bytes += 3;
			}
		}
		else {
			bytes += 3;
		}
	}
	return bytes;
}

export function encodeUtf8Codepoint(codepoint: number, output: Uint8Array): number {
	if (codepoint <= 0x7f) {
		output[0] = codepoint;
		return 1;
	}
	if (codepoint <= 0x7ff) {
		output[0] = 0xc0 | (codepoint >> 6);
		output[1] = 0x80 | (codepoint & 0x3f);
		return 2;
	}
	if ((codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint > 0x10ffff) {
		output[0] = 0x3f;
		return 1;
	}
	if (codepoint <= 0xffff) {
		output[0] = 0xe0 | (codepoint >> 12);
		output[1] = 0x80 | ((codepoint >> 6) & 0x3f);
		output[2] = 0x80 | (codepoint & 0x3f);
		return 3;
	}
	output[0] = 0xf0 | (codepoint >> 18);
	output[1] = 0x80 | ((codepoint >> 12) & 0x3f);
	output[2] = 0x80 | ((codepoint >> 6) & 0x3f);
	output[3] = 0x80 | (codepoint & 0x3f);
	return 4;
}
