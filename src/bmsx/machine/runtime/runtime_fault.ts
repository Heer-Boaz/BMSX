export function runtimeFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}
