import type { StringId } from '../../cpu/string_pool';
import {
	IO_INP_EVENT_ACTION,
	IO_INP_EVENT_COUNT,
	IO_INP_EVENT_CTRL,
	IO_INP_EVENT_FLAGS,
	IO_INP_EVENT_PLAYER,
	IO_INP_EVENT_REPEAT_COUNT,
	IO_INP_EVENT_STATUS,
	IO_INP_EVENT_VALUE,
} from '../../bus/io';
import { StringValue, type Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import {
	INP_EVENT_CTRL_CLEAR,
	INP_EVENT_CTRL_POP,
	INP_EVENT_STATUS_EMPTY,
	INP_EVENT_STATUS_FULL,
	INP_EVENT_STATUS_OVERFLOW,
	INPUT_CONTROLLER_EVENT_FIFO_CAPACITY,
} from './contracts';

export type InputControllerEventState = {
	player: number;
	actionStringId: StringId;
	statusWord: number;
	valueQ16: number;
	repeatCount: number;
};

function createEventFifoSlots(): InputControllerEventState[] {
	const slots = new Array<InputControllerEventState>(INPUT_CONTROLLER_EVENT_FIFO_CAPACITY);
	for (let index = 0; index < slots.length; index += 1) {
		slots[index] = {
			player: 0,
			actionStringId: 0,
			statusWord: 0,
			valueQ16: 0,
			repeatCount: 0,
		};
	}
	return slots;
}

export class InputControllerEventFifo {
	private readonly slots = createEventFifoSlots();
	private readIndex = 0;
	private writeIndex = 0;
	private queuedCount = 0;
	private overflowLatched = false;

	public constructor(private readonly memory: Memory) {}

	public get count(): number {
		return this.queuedCount;
	}

	public get overflow(): boolean {
		return this.overflowLatched;
	}

	public statusWord(): number {
		return (this.queuedCount === 0 ? INP_EVENT_STATUS_EMPTY : 0)
			| (this.queuedCount === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY ? INP_EVENT_STATUS_FULL : 0)
			| (this.overflowLatched ? INP_EVENT_STATUS_OVERFLOW : 0);
	}

	public front(): InputControllerEventState {
		if (this.queuedCount === 0) {
			return this.slots[0]!;
		}
		return this.slots[this.readIndex]!;
	}

	public readRegister(addr: number): Value {
		switch (addr) {
			case IO_INP_EVENT_STATUS:
				return this.statusWord();
			case IO_INP_EVENT_COUNT:
				return this.queuedCount;
			case IO_INP_EVENT_PLAYER:
				return this.front().player;
			case IO_INP_EVENT_ACTION:
				return StringValue.get(this.front().actionStringId);
			case IO_INP_EVENT_FLAGS:
				return this.front().statusWord;
			case IO_INP_EVENT_VALUE:
				return this.front().valueQ16;
			case IO_INP_EVENT_REPEAT_COUNT:
				return this.front().repeatCount;
			case IO_INP_EVENT_CTRL:
				return 0;
		}
		throw new Error(`ICU event register read is not mapped for ${addr >>> 0}.`);
	}

	public writeControl(command: number): void {
		switch (command) {
			case INP_EVENT_CTRL_POP:
				this.pop();
				return;
			case INP_EVENT_CTRL_CLEAR:
				this.clear();
				return;
		}
	}

	public writeEventControlRegister(_addr: number, value: Value): void {
		this.writeControl((value as number) >>> 0);
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
	}

	public push(player: number, actionStringId: StringId, statusWord: number, valueQ16: number, repeatCount: number): void {
		if (this.queuedCount === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.overflowLatched = true;
			return;
		}
		const slot = this.slots[this.writeIndex]!;
		slot.player = player;
		slot.actionStringId = actionStringId;
		slot.statusWord = statusWord;
		slot.valueQ16 = valueQ16;
		slot.repeatCount = repeatCount;
		this.writeIndex += 1;
		if (this.writeIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.writeIndex = 0;
		}
		this.queuedCount += 1;
	}

	public pop(): void {
		if (this.queuedCount === 0) {
			return;
		}
		this.clearSlot(this.slots[this.readIndex]!);
		this.readIndex += 1;
		if (this.readIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.readIndex = 0;
		}
		this.queuedCount -= 1;
	}

	public clear(): void {
		for (let index = 0; index < this.slots.length; index += 1) {
			this.clearSlot(this.slots[index]!);
		}
		this.readIndex = 0;
		this.writeIndex = 0;
		this.queuedCount = 0;
		this.overflowLatched = false;
	}

	public captureEvents(): InputControllerEventState[] {
		const events = new Array<InputControllerEventState>(this.queuedCount);
		let entry = this.readIndex;
		for (let index = 0; index < events.length; index += 1) {
			const slot = this.slots[entry]!;
			events[index] = {
				player: slot.player,
				actionStringId: slot.actionStringId,
				statusWord: slot.statusWord,
				valueQ16: slot.valueQ16,
				repeatCount: slot.repeatCount,
			};
			entry += 1;
			if (entry === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
				entry = 0;
			}
		}
		return events;
	}

	public restore(events: readonly InputControllerEventState[], overflow: boolean): void {
		this.clear();
		for (let index = 0; index < events.length; index += 1) {
			const event = events[index]!;
			const slot = this.slots[this.writeIndex]!;
			slot.player = event.player;
			slot.actionStringId = event.actionStringId;
			slot.statusWord = event.statusWord;
			slot.valueQ16 = event.valueQ16;
			slot.repeatCount = event.repeatCount;
			this.writeIndex += 1;
			if (this.writeIndex === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
				this.writeIndex = 0;
			}
			this.queuedCount += 1;
		}
		this.overflowLatched = overflow;
	}

	private clearSlot(slot: InputControllerEventState): void {
		slot.player = 0;
		slot.actionStringId = 0;
		slot.statusWord = 0;
		slot.valueQ16 = 0;
		slot.repeatCount = 0;
	}
}
