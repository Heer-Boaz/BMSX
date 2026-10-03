/** Build-matched native supervisor ABI, independent of any workload protocol. */
export function encodeLaunch(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Buffer {
	const directory = Buffer.from(cwd);
	const arguments_ = [executable, ...args].map(value => Buffer.from(value));
	const environment = Object.entries(env).filter(([, value]) => value !== undefined)
		.map(([key, value]) => Buffer.from(`${key}=${value}`));
	let size = 1 + 4 + directory.length + 8;
	for (const value of [...arguments_, ...environment]) size += 4 + value.length;
	const message = Buffer.allocUnsafe(size);
	message[0] = 83; // S
	let offset = 1;
	message.writeUInt32LE(directory.length, offset); offset += 4;
	directory.copy(message, offset); offset += directory.length;
	for (const vector of [arguments_, environment]) {
		message.writeUInt32LE(vector.length, offset); offset += 4;
		for (const value of vector) {
			message.writeUInt32LE(value.length, offset); offset += 4;
			value.copy(message, offset); offset += value.length;
		}
	}
	return message;
}
