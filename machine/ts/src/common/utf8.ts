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
