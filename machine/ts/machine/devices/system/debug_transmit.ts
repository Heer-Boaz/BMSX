import { encodeUtf8Codepoint } from '../../../common/utf8';
import {
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	SYS_PRINT_BUFFER_BYTES,
} from '../../../spec/bmsx/io';
import { Memory } from '../../memory/memory';

export type SystemDebugTransmitState = {
	charWord: number;
	flushWord: number;
};

const ASCII_NEWLINE = 10;

export class SystemDebugTransmit {
	private readonly outputBytes = new Uint8Array(SYS_PRINT_BUFFER_BYTES);
	private outputReadIndex = 0;
	private outputByteCount = 0;
	private completeByteCount = 0;
	private lineOverflowed = false;
	private readonly encodingBytes = new Uint8Array(4);

	public constructor(private readonly memory: Memory) {
		memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, SystemDebugTransmit.writeChar);
		memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, SystemDebugTransmit.flushLine);
	}

	public reset(): void {
		this.clearOutput();
		this.memory.writeIoU32(IO_SYS_PRINT_CHAR, 0);
		this.memory.writeIoU32(IO_SYS_PRINT_FLUSH, 0);
	}

	public captureState(): SystemDebugTransmitState {
		return {
			charWord: this.memory.readIoU32(IO_SYS_PRINT_CHAR),
			flushWord: this.memory.readIoU32(IO_SYS_PRINT_FLUSH),
		};
	}

	public restoreState(state: SystemDebugTransmitState): void {
		this.clearOutput();
		this.memory.writeIoU32(IO_SYS_PRINT_CHAR, state.charWord);
		this.memory.writeIoU32(IO_SYS_PRINT_FLUSH, state.flushWord);
	}

	public availableByteCount(): number {
		return this.completeByteCount;
	}

	public readByte(): number {
		const value = this.outputBytes[this.outputReadIndex];
		this.outputReadIndex = (this.outputReadIndex + 1) & (SYS_PRINT_BUFFER_BYTES - 1);
		this.outputByteCount -= 1;
		this.completeByteCount -= 1;
		return value;
	}

	private static writeChar(context: SystemDebugTransmit, _address: number, value: number): void {
		const byteCount = encodeUtf8Codepoint(value, context.encodingBytes);
		if (!context.reserveBytes(byteCount)) {
			return;
		}
		for (let index = 0; index < byteCount; index += 1) {
			context.appendByte(context.encodingBytes[index]);
		}
	}

	private static flushLine(context: SystemDebugTransmit): void {
		if (context.reserveBytes(1)) {
			context.appendByte(ASCII_NEWLINE);
			context.completeByteCount = context.outputByteCount;
		}
		context.lineOverflowed = false;
	}

	private reserveBytes(byteCount: number): boolean {
		if (this.lineOverflowed) {
			return false;
		}
		if (this.outputByteCount + byteCount <= SYS_PRINT_BUFFER_BYTES) {
			return true;
		}
		this.outputByteCount = this.completeByteCount;
		this.lineOverflowed = true;
		return false;
	}

	private clearOutput(): void {
		this.outputReadIndex = 0;
		this.outputByteCount = 0;
		this.completeByteCount = 0;
		this.lineOverflowed = false;
	}

	private appendByte(value: number): void {
		this.outputBytes[(this.outputReadIndex + this.outputByteCount) & (SYS_PRINT_BUFFER_BYTES - 1)] = value;
		this.outputByteCount += 1;
	}
}
