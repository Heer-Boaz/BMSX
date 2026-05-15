import {
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
	IO_INP_VALUE_X,
	IO_INP_VALUE_Y,
} from '../../bus/io';
import { asStringId, StringValue, type Value } from '../../cpu/cpu';
import type { StringId } from '../../cpu/string_pool';
import { Memory } from '../../memory/memory';
import { decodeInputControllerPlayerSelect } from './contracts';

export type InputControllerRegisterState = {
	player: number;
	actionStringId: StringId;
	bindStringId: StringId;
	ctrl: number;
	queryStringId: StringId;
	status: number;
	value: number;
	valueX: number;
	valueY: number;
	consumeStringId: StringId;
	outputIntensityQ16: number;
	outputDurationMs: number;
};

export function createInputControllerRegisterState(): InputControllerRegisterState {
	return {
		player: 1,
		actionStringId: 0,
		bindStringId: 0,
		ctrl: 0,
		queryStringId: 0,
		status: 0,
		value: 0,
		valueX: 0,
		valueY: 0,
		consumeStringId: 0,
		outputIntensityQ16: 0,
		outputDurationMs: 0,
	};
}

export class InputControllerRegisterFile {
	public state = createInputControllerRegisterState();

	public reset(): void {
		this.state = createInputControllerRegisterState();
	}

	public captureState(): InputControllerRegisterState {
		return { ...this.state };
	}

	public restoreState(state: InputControllerRegisterState): void {
		this.state = { ...state };
	}

	public selectedPlayerIndex(): number {
		const playerWord = this.state.player;
		return decodeInputControllerPlayerSelect(playerWord);
	}

	public write(addr: number, value: Value): void {
		switch (addr) {
			case IO_INP_PLAYER:
				this.state.player = (value as number) >>> 0;
				return;
			case IO_INP_ACTION:
				this.state.actionStringId = asStringId(value as StringValue);
				return;
			case IO_INP_BIND:
				this.state.bindStringId = asStringId(value as StringValue);
				return;
			case IO_INP_CTRL:
				this.state.ctrl = (value as number) >>> 0;
				return;
			case IO_INP_QUERY:
				this.state.queryStringId = asStringId(value as StringValue);
				return;
			case IO_INP_CONSUME:
				this.state.consumeStringId = asStringId(value as StringValue);
				return;
			case IO_INP_OUTPUT_INTENSITY_Q16:
				this.state.outputIntensityQ16 = (value as number) >>> 0;
				return;
			case IO_INP_OUTPUT_DURATION_MS:
				this.state.outputDurationMs = (value as number) >>> 0;
				return;
		}
	}

	public writeResult(memory: Memory, status: number, value: number, valueX: number, valueY: number): void {
		this.state.status = status;
		this.state.value = value;
		this.state.valueX = valueX;
		this.state.valueY = valueY;
		memory.writeIoValue(IO_INP_STATUS, status);
		memory.writeIoValue(IO_INP_VALUE, value);
		memory.writeIoValue(IO_INP_VALUE_X, valueX);
		memory.writeIoValue(IO_INP_VALUE_Y, valueY);
	}

	public mirror(memory: Memory): void {
		memory.writeIoValue(IO_INP_PLAYER, this.state.player);
		memory.writeIoValue(IO_INP_ACTION, StringValue.get(this.state.actionStringId));
		memory.writeIoValue(IO_INP_BIND, StringValue.get(this.state.bindStringId));
		memory.writeIoValue(IO_INP_CTRL, this.state.ctrl);
		memory.writeIoValue(IO_INP_QUERY, StringValue.get(this.state.queryStringId));
		memory.writeIoValue(IO_INP_STATUS, this.state.status);
		memory.writeIoValue(IO_INP_VALUE, this.state.value);
		memory.writeIoValue(IO_INP_VALUE_X, this.state.valueX);
		memory.writeIoValue(IO_INP_VALUE_Y, this.state.valueY);
		memory.writeIoValue(IO_INP_CONSUME, StringValue.get(this.state.consumeStringId));
		memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, this.state.outputIntensityQ16);
		memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, this.state.outputDurationMs);
	}
}
