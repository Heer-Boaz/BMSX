// A guest byte string uses 00h–FFh code units, not UTF-16 text. This
// preserves zero bytes and invalid UTF-8 while allowing native JS string keys.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const nonAscii = /[^\x00-\x7f]/;

export function byteStringFromBytes(bytes: Uint8Array, offset = 0, count = bytes.length - offset): string {
	let value = '';
	const end = offset + count;
	while (offset < end) {
		const next = Math.min(offset + 4096, end);
		value += String.fromCharCode(...bytes.subarray(offset, next));
		offset = next;
	}
	return value;
}

export function writeByteString(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; ++index) bytes[offset + index] = value.charCodeAt(index);
}

export function byteStringToBytes(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length);
	writeByteString(bytes, 0, value);
	return bytes;
}

export function textToByteString(text: string): string {
	return nonAscii.test(text) ? byteStringFromBytes(encoder.encode(text)) : text;
}

export function byteStringToText(value: string): string {
	return nonAscii.test(value) ? decoder.decode(byteStringToBytes(value)) : value;
}
