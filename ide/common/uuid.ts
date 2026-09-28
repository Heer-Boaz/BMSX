/** UUID v4 for host identities, including Studio served over LAN HTTP.
 * getRandomValues is available there; randomUUID is restricted to secure contexts.
 * Representation follows VS Code's base/common/uuid.ts and RFC 9562. */
const bytes = new Uint8Array(16);
const hex = '0123456789abcdef';
export function generateUuid(): string {
	crypto.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	let value = '';
	for (let index = 0; index < bytes.length; index++) {
		if (index === 4 || index === 6 || index === 8 || index === 10) value += '-';
		value += hex[bytes[index] >>> 4] + hex[bytes[index] & 0x0f];
	}
	return value;
}
