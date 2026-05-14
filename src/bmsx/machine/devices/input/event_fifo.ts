import type { InputControllerActionState, InputControllerEventState } from './save_state';
import {
	INP_EVENT_STATUS_EMPTY,
	INP_EVENT_STATUS_FULL,
	INP_EVENT_STATUS_OVERFLOW,
	INPUT_CONTROLLER_EVENT_FIFO_CAPACITY,
} from './contracts';

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

	public push(player: number, action: InputControllerActionState): void {
		if (this.queuedCount === INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
			this.overflowLatched = true;
			return;
		}
		const slot = this.slots[this.writeIndex]!;
		slot.player = player;
		slot.actionStringId = action.actionStringId;
		slot.statusWord = action.statusWord;
		slot.valueQ16 = action.valueQ16;
		slot.repeatCount = action.repeatCount;
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
