import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { SYS_PRINT_BUFFER_BYTES } from '../../machine/ts/spec/bmsx/io';
import { LogLevel, type LogOutput } from './log';

const systemOutputDecoder = new TextDecoder('utf-8', { fatal: true });

export class SystemOutputLog {
	private readonly bytes = new Uint8Array(SYS_PRINT_BUFFER_BYTES);

	public flush(runtime: Runtime, logOutput: LogOutput): void {
		const output = runtime.machine.systemController;
		const byteCount = output.hostOutputAvailableByteCount();
		if (byteCount === 0) {
			return;
		}
		for (let index = 0; index < byteCount; index += 1) {
			this.bytes[index] = output.readHostOutputByte();
		}
		let lineStart = 0;
		for (let index = 0; index < byteCount; index += 1) {
			if (this.bytes[index] === 10) {
				logOutput.log(
					LogLevel.Info,
					systemOutputDecoder.decode(this.bytes.subarray(lineStart, index)),
				);
				lineStart = index + 1;
			}
		}
	}
}
