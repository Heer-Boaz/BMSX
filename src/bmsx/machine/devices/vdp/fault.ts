export function vdpFault(message: string): Error {
	return new Error(`VDP fault: ${message}`);
}

export function vdpStreamFault(message: string): Error {
	return new Error(`VDP stream fault: ${message}`);
}
