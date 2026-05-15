import { Input } from '../../../input/manager';
import {
	INP_CTRL_COMMIT,
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_EVENT_ACTION,
	IO_INP_EVENT_COUNT,
	IO_INP_EVENT_CTRL,
	IO_INP_EVENT_FLAGS,
	IO_INP_EVENT_PLAYER,
	IO_INP_EVENT_REPEAT_COUNT,
	IO_INP_EVENT_STATUS,
	IO_INP_EVENT_VALUE,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { asStringId, StringValue, type Value } from '../../cpu/cpu';
import type { StringPool } from '../../cpu/string_pool';
import type { InputControllerState } from './save_state';
import { InputControllerEventFifo } from './event_fifo';
import { InputControllerActionTable, type InputControllerQueryResult } from './action_table';
import { createInputControllerRegisterState } from './registers';
import {
	INP_EVENT_CTRL_CLEAR,
	INP_EVENT_CTRL_POP,
	INP_OUTPUT_CTRL_APPLY,
} from './contracts';
import { InputControllerSampleLatch } from './sample_latch';
import { InputControllerOutputPort } from './output_port';

export class InputController {
	private readonly actionTable: InputControllerActionTable;
	private readonly eventFifo = new InputControllerEventFifo();
	public readonly sampleLatch: InputControllerSampleLatch;
	private readonly outputPort: InputControllerOutputPort;
	private readonly queryResult: InputControllerQueryResult = { statusWord: 0, valueQ16: 0 };
	private registers = createInputControllerRegisterState();

	public constructor(
		private readonly memory: Memory,
		input: Input,
		private readonly strings: StringPool,
	) {
		this.actionTable = new InputControllerActionTable(input, strings);
		this.sampleLatch = new InputControllerSampleLatch(input, this.actionTable, this.eventFifo);
		this.outputPort = new InputControllerOutputPort(input);
		this.memory.mapIoWrite(IO_INP_PLAYER, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_ACTION, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_BIND, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_CTRL, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_QUERY, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_CONSUME, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, this.onRegisterWrite.bind(this));
		this.memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, this.onRegisterWrite.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_STATUS, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_COUNT, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_PLAYER, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_ACTION, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_FLAGS, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_VALUE, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, this.onEventRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_EVENT_CTRL, this.onEventRegisterRead.bind(this));
		this.memory.mapIoWrite(IO_INP_EVENT_CTRL, this.onEventCtrlWrite.bind(this));
		this.memory.mapIoRead(IO_INP_OUTPUT_STATUS, this.onOutputRegisterRead.bind(this));
		this.memory.mapIoRead(IO_INP_OUTPUT_CTRL, this.onOutputRegisterRead.bind(this));
		this.memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this.onOutputCtrlWrite.bind(this));
	}

	public reset(): void {
		this.sampleLatch.reset();
		this.actionTable.reset();
		this.registers = createInputControllerRegisterState();
		this.eventFifo.clear();
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.mirrorRegisters();
	}

	public captureState(): InputControllerState {
		return {
			...this.sampleLatch.captureState(),
			registers: { ...this.registers },
			players: this.actionTable.capturePlayers(),
			eventFifoEvents: this.eventFifo.captureEvents(),
			eventFifoOverflow: this.eventFifo.overflow,
		};
	}

	public restoreState(state: InputControllerState): void {
		this.sampleLatch.restoreState(state);
		this.registers = { ...state.registers };
		this.actionTable.restorePlayers(state.players);
		this.eventFifo.restore(state.eventFifoEvents, state.eventFifoOverflow);
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.mirrorRegisters();
	}

	private onRegisterWrite(addr: number, value: Value): void {
		switch (addr) {
			case IO_INP_PLAYER:
				this.registers.player = (value as number) >>> 0;
				return;
			case IO_INP_ACTION:
				this.registers.actionStringId = asStringId(value as StringValue);
				return;
			case IO_INP_BIND:
				this.registers.bindStringId = asStringId(value as StringValue);
				return;
			case IO_INP_CTRL:
				this.onCtrlWrite((value as number) >>> 0);
				return;
			case IO_INP_QUERY:
				this.registers.queryStringId = asStringId(value as StringValue);
				this.queryAction();
				return;
			case IO_INP_CONSUME:
				this.registers.consumeStringId = asStringId(value as StringValue);
				this.consumeActions();
				return;
			case IO_INP_OUTPUT_INTENSITY_Q16:
				this.registers.outputIntensityQ16 = (value as number) >>> 0;
				return;
			case IO_INP_OUTPUT_DURATION_MS:
				this.registers.outputDurationMs = (value as number) >>> 0;
				return;
		}
	}

	private onCtrlWrite(command: number): void {
		this.registers.ctrl = command;
		switch (command) {
			case INP_CTRL_COMMIT:
				this.actionTable.commitAction(this.registers.player, this.registers.actionStringId, this.registers.bindStringId);
				return;
			case INP_CTRL_ARM:
				this.sampleLatch.arm();
				return;
			case INP_CTRL_RESET:
				this.resetActions();
				return;
		}
	}

	private onEventRegisterRead(addr: number): Value {
		switch (addr) {
			case IO_INP_EVENT_STATUS:
				return this.eventFifo.statusWord();
			case IO_INP_EVENT_COUNT:
				return this.eventFifo.count;
			case IO_INP_EVENT_PLAYER:
				return this.eventFifo.front().player;
			case IO_INP_EVENT_ACTION:
				return StringValue.get(this.eventFifo.front().actionStringId);
			case IO_INP_EVENT_FLAGS:
				return this.eventFifo.front().statusWord;
			case IO_INP_EVENT_VALUE:
				return this.eventFifo.front().valueQ16;
			case IO_INP_EVENT_REPEAT_COUNT:
				return this.eventFifo.front().repeatCount;
			case IO_INP_EVENT_CTRL:
				return 0;
		}
		throw new Error(`ICU event register read is not mapped for ${addr >>> 0}.`);
	}

	private onEventCtrlWrite(_addr: number, value: Value): void {
		const command = (value as number) >>> 0;
		switch (command) {
			case INP_EVENT_CTRL_POP:
				this.eventFifo.pop();
				break;
			case INP_EVENT_CTRL_CLEAR:
				this.eventFifo.clear();
				break;
		}
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
	}

	private onOutputRegisterRead(addr: number): Value {
		switch (addr) {
			case IO_INP_OUTPUT_STATUS:
				return this.outputPort.readStatus(this.registers.player);
			case IO_INP_OUTPUT_CTRL:
				return 0;
		}
		throw new Error(`ICU output register read is not mapped for ${addr >>> 0}.`);
	}

	private onOutputCtrlWrite(_addr: number, value: Value): void {
		const command = (value as number) >>> 0;
		switch (command) {
			case INP_OUTPUT_CTRL_APPLY:
				this.outputPort.apply(this.registers.player, this.registers.outputIntensityQ16, this.registers.outputDurationMs);
				break;
		}
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
	}

	private queryAction(): void {
		const queryText = this.strings.toString(this.registers.queryStringId);
		this.actionTable.queryAction(this.registers.player, queryText, this.queryResult);
		this.writeResult(this.queryResult.statusWord, this.queryResult.valueQ16);
	}

	private consumeActions(): void {
		const actionNames = this.strings.toString(this.registers.consumeStringId);
		this.actionTable.consumeActions(this.registers.player, actionNames);
	}

	private resetActions(): void {
		this.actionTable.resetActions(this.registers.player);
		this.writeResult(0, 0);
	}

	private writeResult(status: number, value: number): void {
		this.registers.status = status;
		this.registers.value = value;
		this.memory.writeIoValue(IO_INP_STATUS, status);
		this.memory.writeIoValue(IO_INP_VALUE, value);
	}

	private mirrorRegisters(): void {
		this.memory.writeIoValue(IO_INP_PLAYER, this.registers.player);
		this.memory.writeIoValue(IO_INP_ACTION, StringValue.get(this.registers.actionStringId));
		this.memory.writeIoValue(IO_INP_BIND, StringValue.get(this.registers.bindStringId));
		this.memory.writeIoValue(IO_INP_CTRL, this.registers.ctrl);
		this.memory.writeIoValue(IO_INP_QUERY, StringValue.get(this.registers.queryStringId));
		this.memory.writeIoValue(IO_INP_STATUS, this.registers.status);
		this.memory.writeIoValue(IO_INP_VALUE, this.registers.value);
		this.memory.writeIoValue(IO_INP_CONSUME, StringValue.get(this.registers.consumeStringId));
		this.memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, this.registers.outputIntensityQ16);
		this.memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, this.registers.outputDurationMs);
	}
}
