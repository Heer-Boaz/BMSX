import { IO_APU_PARAMETER_REGISTER_ADDRS } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import {
	APU_CMD_NONE,
	APU_COMMAND_FIFO_CAPACITY,
	APU_COMMAND_FIFO_REGISTER_WORD_COUNT,
	APU_PARAMETER_REGISTER_COUNT,
	type ApuParameterRegisterWords,
} from './contracts';

export type ApuCommandFifoState = {
	commands: number[];
	registerWords: number[];
	readIndex: number;
	writeIndex: number;
	count: number;
};

export class ApuCommandFifo {
	private readonly commands = new Uint32Array(APU_COMMAND_FIFO_CAPACITY);
	private readonly registerWords = new Uint32Array(APU_COMMAND_FIFO_REGISTER_WORD_COUNT);
	private readIndex = 0;
	private writeIndex = 0;
	private queuedCount = 0;

	public get count(): number {
		return this.queuedCount;
	}

	public get free(): number {
		return APU_COMMAND_FIFO_CAPACITY - this.queuedCount;
	}

	public get capacity(): number {
		return APU_COMMAND_FIFO_CAPACITY;
	}

	public get empty(): boolean {
		return this.queuedCount === 0;
	}

	public get full(): boolean {
		return this.queuedCount === APU_COMMAND_FIFO_CAPACITY;
	}

	public reset(): void {
		this.commands.fill(APU_CMD_NONE);
		this.registerWords.fill(0);
		this.readIndex = 0;
		this.writeIndex = 0;
		this.queuedCount = 0;
	}

	public enqueue(command: number, memory: Memory): boolean {
		if (this.full) {
			return false;
		}
		const entry = this.writeIndex;
		this.commands[entry] = command;
		const base = entry * APU_PARAMETER_REGISTER_COUNT;
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.registerWords[base + index] = memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		this.writeIndex += 1;
		if (this.writeIndex === APU_COMMAND_FIFO_CAPACITY) {
			this.writeIndex = 0;
		}
		this.queuedCount += 1;
		return true;
	}

	public popInto(target: ApuParameterRegisterWords & { [index: number]: number }): number {
		const entry = this.readIndex;
		const command = this.commands[entry]!;
		const base = entry * APU_PARAMETER_REGISTER_COUNT;
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			target[index] = this.registerWords[base + index]!;
			this.registerWords[base + index] = 0;
		}
		this.commands[entry] = APU_CMD_NONE;
		this.readIndex += 1;
		if (this.readIndex === APU_COMMAND_FIFO_CAPACITY) {
			this.readIndex = 0;
		}
		this.queuedCount -= 1;
		return command;
	}

	public captureState(): ApuCommandFifoState {
		return {
			commands: Array.from(this.commands),
			registerWords: Array.from(this.registerWords),
			readIndex: this.readIndex,
			writeIndex: this.writeIndex,
			count: this.queuedCount,
		};
	}

	public restoreState(state: ApuCommandFifoState): void {
		for (let index = 0; index < APU_COMMAND_FIFO_CAPACITY; index += 1) {
			this.commands[index] = state.commands[index]! >>> 0;
		}
		for (let index = 0; index < APU_COMMAND_FIFO_REGISTER_WORD_COUNT; index += 1) {
			this.registerWords[index] = state.registerWords[index]! >>> 0;
		}
		this.readIndex = state.readIndex >>> 0;
		this.writeIndex = state.writeIndex >>> 0;
		this.queuedCount = state.count >>> 0;
	}
}
