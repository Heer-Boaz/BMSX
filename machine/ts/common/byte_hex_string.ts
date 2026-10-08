export function lenAndHash(text: string): string {
	return `len=${text.length} hash=${hashText(text)}`;
}

export function formatNumberAsHex(n: number, width?: number): string {
	const hex = n.toString(16).toUpperCase();
	const padded = width === undefined ? hex : hex.padStart(width, '0');
	return `${padded}h`;
}

export function formatByteSize(size: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	let i = 0;
	let n = size;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return i === 0 ? `${size} ${units[0]}` : `${n.toFixed(2)} ${units[i]}`;
}

/** One visible byte row; offsets stay relative to the supplied byte image. */
export function formatHexDumpRow(bytes: Uint8Array, byteOffset: number, end = bytes.length, columns = 16): string {
	const rowEnd = Math.min(byteOffset + columns, end);
	let hex = '', ascii = '';
	for (let index = byteOffset; index < rowEnd; index++) {
		const byte = bytes[index];
		hex += byte.toString(16).padStart(2, '0') + ' ';
		ascii += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
	}
	return `${byteOffset.toString(16).padStart(8, '0')}  ${hex.padEnd(columns * 3, ' ')} ${ascii}`;
}

export function hashText(text: string): number {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
