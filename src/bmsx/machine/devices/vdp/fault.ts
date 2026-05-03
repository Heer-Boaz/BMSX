export function vdpFault(message: string): Error {
	return new Error(`VDP fault: ${message}`);
}
