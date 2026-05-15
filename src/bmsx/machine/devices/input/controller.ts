import { Input } from '../../../input/manager';
import {
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
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { StringPool } from '../../cpu/string_pool';
import type { InputControllerState } from './save_state';
import { InputControllerEventFifo } from './event_fifo';
import { InputControllerActionTable } from './action_table';
import { InputControllerRegisterFile } from './registers';
import { InputControllerSampleLatch } from './sample_latch';
import { InputControllerOutputPort } from './output_port';
import { InputControllerQueryPort } from './query_port';
import { InputControllerControlPort } from './control_port';

export class InputController {
	private readonly actionTable: InputControllerActionTable;
	private readonly eventFifo: InputControllerEventFifo;
	private readonly sampleLatch: InputControllerSampleLatch;
	private readonly controlPort: InputControllerControlPort;
	private readonly outputPort: InputControllerOutputPort;
	private readonly queryPort: InputControllerQueryPort;
	private readonly registers = new InputControllerRegisterFile();

	public constructor(
		private readonly memory: Memory,
		private readonly input: Input,
		strings: StringPool,
	) {
		this.actionTable = new InputControllerActionTable(input, strings);
		this.eventFifo = new InputControllerEventFifo(memory);
		this.sampleLatch = new InputControllerSampleLatch();
		this.controlPort = new InputControllerControlPort(memory, this.registers, this.actionTable, this.sampleLatch);
		this.outputPort = new InputControllerOutputPort(input, this.registers, memory);
		this.queryPort = new InputControllerQueryPort(memory, strings, this.registers, this.actionTable);
		const registerWrite = this.registers.write.bind(this.registers);
		this.memory.mapIoWrite(IO_INP_PLAYER, registerWrite);
		this.memory.mapIoWrite(IO_INP_ACTION, registerWrite);
		this.memory.mapIoWrite(IO_INP_BIND, registerWrite);
		this.memory.mapIoWrite(IO_INP_CTRL, this.controlPort.writeControl.bind(this.controlPort));
		this.memory.mapIoWrite(IO_INP_QUERY, this.queryPort.writeQuery.bind(this.queryPort));
		this.memory.mapIoWrite(IO_INP_CONSUME, this.queryPort.writeConsume.bind(this.queryPort));
		this.memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, registerWrite);
		const eventRegisterRead = this.eventFifo.readRegister.bind(this.eventFifo);
		this.memory.mapIoRead(IO_INP_EVENT_STATUS, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_COUNT, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_PLAYER, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_ACTION, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_FLAGS, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_VALUE, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, eventRegisterRead);
		this.memory.mapIoRead(IO_INP_EVENT_CTRL, eventRegisterRead);
		this.memory.mapIoWrite(IO_INP_EVENT_CTRL, this.eventFifo.writeEventControlRegister.bind(this.eventFifo));
		const outputRegisterRead = this.outputPort.readRegister.bind(this.outputPort);
		this.memory.mapIoRead(IO_INP_OUTPUT_STATUS, outputRegisterRead);
		this.memory.mapIoRead(IO_INP_OUTPUT_CTRL, outputRegisterRead);
		this.memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this.outputPort.writeOutputControlRegister.bind(this.outputPort));
	}

	public reset(): void {
		this.sampleLatch.reset();
		this.actionTable.reset();
		this.registers.reset();
		this.eventFifo.clear();
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
	}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleLatch.consumeVblankEdge(nowCycles)) {
			return;
		}
		this.input.samplePlayers(currentTimeMs);
		this.actionTable.sampleCommittedActions(this.eventFifo);
	}

	public cancelSampleArm(): void {
		if (!this.sampleLatch.cancel()) {
			return;
		}
	}

	public captureState(): InputControllerState {
		return {
			...this.sampleLatch.captureState(),
			registers: this.registers.captureState(),
			players: this.actionTable.capturePlayers(),
			eventFifoEvents: this.eventFifo.captureEvents(),
			eventFifoOverflow: this.eventFifo.overflow,
		};
	}

	public restoreState(state: InputControllerState): void {
		this.sampleLatch.restoreState(state);
		this.registers.restoreState(state.registers);
		this.actionTable.restorePlayers(state.players);
		this.eventFifo.restore(state.eventFifoEvents, state.eventFifoOverflow);
		this.memory.writeIoValue(IO_INP_EVENT_CTRL, 0);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
	}

}
