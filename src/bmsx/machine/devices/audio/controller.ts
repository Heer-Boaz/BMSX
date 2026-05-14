import { toSignedWord } from '../../common/numeric';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU, type DeviceScheduler } from '../../scheduler/device';
import type { ApuOutputMixer } from './output';
import { ApuSourceDma } from './source';
import {
	APU_GAIN_Q12_ONE,
	APU_COMMAND_FIFO_CAPACITY,
	APU_COMMAND_FIFO_REGISTER_WORD_COUNT,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_EVENT_NONE,
	APU_EVENT_SLOT_ENDED,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_CMD_FIFO_FULL,
	APU_FAULT_NONE,
	APU_FILTER_NONE,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_FADE_SAMPLES_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_SLOT_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_SLOT_REGISTER_WORD_COUNT,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_FAULT,
	APU_STATUS_OUTPUT_EMPTY,
	APU_STATUS_OUTPUT_FULL,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	advanceApuPlaybackCursorQ16,
	apuParameterProgramsSourceBuffer,
	apuSlotRegisterWordIndex,
	resolveApuAudioSource,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
	type ApuSlotPhase,
	type ApuVoiceId,
} from './contracts';
import {
	IO_APU_CMD,
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_FADE_SAMPLES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_OUTPUT_CAPACITY_FRAMES,
	IO_APU_OUTPUT_FREE_FRAMES,
	IO_APU_OUTPUT_QUEUED_FRAMES,
	IO_APU_PARAMETER_REGISTER_ADDRS,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SLOT,
	IO_APU_START_SAMPLE,
	IO_APU_STATUS,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_ARG_STRIDE,
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { IrqController } from '../irq/controller';
import type { Value } from '../../cpu/cpu';

export type AudioControllerState = {
	registerWords: number[];
	commandFifoCommands: number[];
	commandFifoRegisterWords: number[];
	commandFifoReadIndex: number;
	commandFifoWriteIndex: number;
	commandFifoCount: number;
	eventSequence: number;
	eventKind: number;
	eventSlot: number;
	eventSourceAddr: number;
	slotPhases: number[];
	slotRegisterWords: number[];
	slotSourceBytes: Uint8Array[];
	slotPlaybackCursorQ16: number[];
	slotFadeSamplesRemaining: number[];
	slotFadeSamplesTotal: number[];
	sampleCarry: number;
	availableSamples: number;
	apuStatus: number;
	apuFaultCode: number;
	apuFaultDetail: number;
};

const APU_DEVICE_STATUS_REGISTERS: DeviceStatusRegisters = {
	statusAddr: IO_APU_STATUS,
	codeAddr: IO_APU_FAULT_CODE,
	detailAddr: IO_APU_FAULT_DETAIL,
	ackAddr: IO_APU_FAULT_ACK,
	faultMask: APU_STATUS_FAULT,
	noneCode: APU_FAULT_NONE,
};

export class AudioController {
	private readonly sourceDma: ApuSourceDma;
	private eventSequence = 0;
	private readonly commandFifoCommands = new Uint32Array(APU_COMMAND_FIFO_CAPACITY);
	private readonly commandFifoRegisterWords = new Uint32Array(APU_COMMAND_FIFO_REGISTER_WORD_COUNT);
	private commandFifoReadIndex = 0;
	private commandFifoWriteIndex = 0;
	private commandFifoCount = 0;
	private readonly commandDispatchRegisterWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
	private readonly slotRegisterDispatchWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
	private activeSlotMask = 0;
	private readonly slotPhases = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotRegisterWords = new Uint32Array(APU_SLOT_REGISTER_WORD_COUNT);
	private readonly slotPlaybackCursorQ16 = new Array<number>(APU_SLOT_COUNT).fill(0);
	private readonly slotFadeSamplesRemaining = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotFadeSamplesTotal = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotVoiceIds: ApuVoiceId[] = new Array(APU_SLOT_COUNT).fill(0);
	private nextVoiceId: ApuVoiceId = 1;
	private cpuHz = APU_SAMPLE_RATE_HZ;
	private sampleCarry = 0;
	private availableSamples = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly fault: DeviceStatusLatch;

	public constructor(
		private readonly memory: Memory,
		private readonly audioOutput: ApuOutputMixer,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.sourceDma = new ApuSourceDma(memory);
		this.fault = new DeviceStatusLatch(memory, APU_DEVICE_STATUS_REGISTERS);
		this.memory.mapIoRead(IO_APU_STATUS, this.onStatusRead.bind(this));
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_APU_SLOT, this.updateSelectedSlotActiveStatus.bind(this));
		this.memory.mapIoWrite(IO_APU_FAULT_ACK, () => {
			this.fault.acknowledge();
		});
		this.memory.mapIoRead(IO_APU_OUTPUT_QUEUED_FRAMES, () => this.audioOutput.queuedOutputFrames());
		this.memory.mapIoRead(IO_APU_OUTPUT_FREE_FRAMES, () => this.audioOutput.freeOutputFrames());
		this.memory.mapIoRead(IO_APU_OUTPUT_CAPACITY_FRAMES, () => this.audioOutput.capacityOutputFrames());
		this.memory.mapIoRead(IO_APU_CMD_QUEUED, () => this.commandFifoCount);
		this.memory.mapIoRead(IO_APU_CMD_FREE, () => APU_COMMAND_FIFO_CAPACITY - this.commandFifoCount);
		this.memory.mapIoRead(IO_APU_CMD_CAPACITY, () => APU_COMMAND_FIFO_CAPACITY);
		const selectedSlotRegisterRead = this.onSelectedSlotRegisterRead.bind(this);
		const selectedSlotRegisterWrite = this.onSelectedSlotRegisterWrite.bind(this);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			const registerAddr = IO_APU_SELECTED_SLOT_REG0 + index * IO_ARG_STRIDE;
			this.memory.mapIoRead(registerAddr, selectedSlotRegisterRead);
			this.memory.mapIoWrite(registerAddr, selectedSlotRegisterWrite);
		}
	}

	public dispose(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
		this.audioOutput.resetPlaybackState();
	}

	public reset(): void {
		this.eventSequence = 0;
		this.resetCommandFifo();
		this.activeSlotMask = 0;
		this.slotPhases.fill(APU_SLOT_PHASE_IDLE);
		this.slotRegisterWords.fill(0);
		this.sourceDma.reset();
		this.slotPlaybackCursorQ16.fill(0);
		this.slotFadeSamplesRemaining.fill(0);
		this.slotFadeSamplesTotal.fill(0);
		this.sampleCarry = 0;
		this.availableSamples = 0;
		this.slotVoiceIds.fill(0);
		this.nextVoiceId = 1;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
		this.audioOutput.resetPlaybackState();
		this.fault.resetStatus();
		this.clearCommandLatch();
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
		this.memory.writeValue(IO_APU_SELECTED_SOURCE_ADDR, 0);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, 0);
	}

	public captureState(): AudioControllerState {
		const registerWords = new Array<number>(APU_PARAMETER_REGISTER_COUNT);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		return {
			registerWords,
			commandFifoCommands: Array.from(this.commandFifoCommands),
			commandFifoRegisterWords: Array.from(this.commandFifoRegisterWords),
			commandFifoReadIndex: this.commandFifoReadIndex,
			commandFifoWriteIndex: this.commandFifoWriteIndex,
			commandFifoCount: this.commandFifoCount,
			eventSequence: this.eventSequence,
			eventKind: this.memory.readIoU32(IO_APU_EVENT_KIND),
			eventSlot: this.memory.readIoU32(IO_APU_EVENT_SLOT),
			eventSourceAddr: this.memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR),
			slotPhases: Array.from(this.slotPhases),
			slotRegisterWords: Array.from(this.slotRegisterWords),
			slotSourceBytes: this.sourceDma.captureState(),
			slotPlaybackCursorQ16: this.slotPlaybackCursorQ16.slice(),
			slotFadeSamplesRemaining: Array.from(this.slotFadeSamplesRemaining),
			slotFadeSamplesTotal: Array.from(this.slotFadeSamplesTotal),
			sampleCarry: this.sampleCarry,
			availableSamples: this.availableSamples,
			apuStatus: this.fault.status,
			apuFaultCode: this.fault.code,
			apuFaultDetail: this.fault.detail,
		};
	}

	public restoreState(state: AudioControllerState, nowCycles: number): void {
		this.slotVoiceIds.fill(0);
		this.audioOutput.resetPlaybackState();
		this.nextVoiceId = 1;
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index]!, state.registerWords[index]!);
		}
		for (let index = 0; index < APU_COMMAND_FIFO_CAPACITY; index += 1) {
			this.commandFifoCommands[index] = state.commandFifoCommands[index]! >>> 0;
		}
		for (let index = 0; index < APU_COMMAND_FIFO_REGISTER_WORD_COUNT; index += 1) {
			this.commandFifoRegisterWords[index] = state.commandFifoRegisterWords[index]! >>> 0;
		}
		this.commandFifoReadIndex = state.commandFifoReadIndex >>> 0;
		this.commandFifoWriteIndex = state.commandFifoWriteIndex >>> 0;
		this.commandFifoCount = state.commandFifoCount >>> 0;
		this.eventSequence = state.eventSequence >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, state.eventKind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, state.eventSlot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, state.eventSourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.activeSlotMask = 0;
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotPhases[slot] = state.slotPhases[slot]!;
			if (this.slotPhases[slot] !== APU_SLOT_PHASE_IDLE) {
				this.activeSlotMask = (this.activeSlotMask | (1 << slot)) >>> 0;
			}
		}
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.activeSlotMask);
		for (let index = 0; index < APU_SLOT_REGISTER_WORD_COUNT; index += 1) {
			this.slotRegisterWords[index] = state.slotRegisterWords[index] >>> 0;
		}
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.slotPlaybackCursorQ16[slot] = state.slotPlaybackCursorQ16[slot]!;
			this.slotFadeSamplesRemaining[slot] = state.slotFadeSamplesRemaining[slot]!;
			this.slotFadeSamplesTotal[slot] = state.slotFadeSamplesTotal[slot]!;
		}
		this.sourceDma.restoreState(state.slotSourceBytes);
		this.sampleCarry = state.sampleCarry;
		this.availableSamples = state.availableSamples;
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			if (this.slotPhases[slot] === APU_SLOT_PHASE_IDLE) {
				continue;
			}
			const voiceId = this.nextVoiceId;
			this.nextVoiceId += 1;
			this.slotVoiceIds[slot] = voiceId;
			this.replayHostOutput(slot, voiceId);
		}
		this.updateSelectedSlotActiveStatus();
		this.scheduleNextService(nowCycles);
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		if (this.activeSlotMask === 0 && this.commandFifoCount === 0) {
			this.sampleCarry = 0;
			this.availableSamples = 0;
		}
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (this.activeSlotMask === 0 || cycles <= 0) {
			return;
		}
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, cycles);
		this.sampleCarry = this.budgetAccrual.carry;
		this.availableSamples += this.budgetAccrual.wholeUnits;
		this.scheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (this.commandFifoCount > 0) {
			this.drainCommandFifo();
		}
		if (this.activeSlotMask === 0 || this.availableSamples === 0) {
			this.scheduleNextService(nowCycles);
			return;
		}
		const samples = this.availableSamples;
		this.availableSamples = 0;
		this.advanceActiveSlots(samples);
		this.scheduleNextService(nowCycles);
	}

	private resetCommandLatch(): void {
		this.memory.writeValue(IO_APU_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_SOURCE_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 0);
		this.memory.writeValue(IO_APU_SOURCE_CHANNELS, 0);
		this.memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SLOT, 0);
		this.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
		this.memory.writeValue(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
		this.memory.writeValue(IO_APU_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
		this.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
		this.memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
		this.memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
		this.memory.writeValue(IO_APU_FADE_SAMPLES, 0);
	}

	private clearCommandLatch(): void {
		this.resetCommandLatch();
		this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
	}

	public onCommandWrite(): void {
		const command = this.memory.readIoU32(IO_APU_CMD);
		switch (command) {
			case APU_CMD_PLAY:
			case APU_CMD_STOP_SLOT:
			case APU_CMD_SET_SLOT_GAIN:
				if (this.enqueueCommand(command)) {
					this.scheduleNextService(this.scheduler.currentNowCycles());
				}
				this.clearCommandLatch();
				return;
			case APU_CMD_NONE:
				return;
			default:
				this.fault.raise(APU_FAULT_BAD_CMD, command);
				this.clearCommandLatch();
				return;
		}
	}

	private resetCommandFifo(): void {
		this.commandFifoCommands.fill(APU_CMD_NONE);
		this.commandFifoRegisterWords.fill(0);
		this.commandFifoReadIndex = 0;
		this.commandFifoWriteIndex = 0;
		this.commandFifoCount = 0;
	}

	private enqueueCommand(command: number): boolean {
		if (this.commandFifoCount === APU_COMMAND_FIFO_CAPACITY) {
			this.fault.raise(APU_FAULT_CMD_FIFO_FULL, command);
			return false;
		}
		const entry = this.commandFifoWriteIndex;
		this.commandFifoCommands[entry] = command;
		const base = entry * APU_PARAMETER_REGISTER_COUNT;
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.commandFifoRegisterWords[base + index] = this.memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		this.commandFifoWriteIndex += 1;
		if (this.commandFifoWriteIndex === APU_COMMAND_FIFO_CAPACITY) {
			this.commandFifoWriteIndex = 0;
		}
		this.commandFifoCount += 1;
		return true;
	}

	private drainCommandFifo(): void {
		while (this.commandFifoCount > 0) {
			const entry = this.commandFifoReadIndex;
			const command = this.commandFifoCommands[entry]!;
			const base = entry * APU_PARAMETER_REGISTER_COUNT;
			for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
				this.commandDispatchRegisterWords[index] = this.commandFifoRegisterWords[base + index]!;
				this.commandFifoRegisterWords[base + index] = 0;
			}
			this.commandFifoCommands[entry] = APU_CMD_NONE;
			this.commandFifoReadIndex += 1;
			if (this.commandFifoReadIndex === APU_COMMAND_FIFO_CAPACITY) {
				this.commandFifoReadIndex = 0;
			}
			this.commandFifoCount -= 1;
			this.executeCommand(command, this.commandDispatchRegisterWords);
		}
	}

	private executeCommand(command: number, registerWords: ApuParameterRegisterWords): void {
		switch (command) {
			case APU_CMD_PLAY:
				this.play(registerWords);
				return;
			case APU_CMD_STOP_SLOT:
				this.stopSlot(registerWords);
				return;
			case APU_CMD_SET_SLOT_GAIN:
				this.setSlotGain(registerWords);
				return;
			default:
				this.fault.raise(APU_FAULT_BAD_CMD, command);
				return;
		}
	}

	private readSlot(registerWords: ApuParameterRegisterWords): ApuAudioSlot | undefined {
		const slot = registerWords[APU_PARAMETER_SLOT_INDEX]!;
		if (slot >= APU_SLOT_COUNT) {
			this.fault.raise(APU_FAULT_BAD_SLOT, slot);
			return undefined;
		}
		return slot;
	}

	private play(registerWords: ApuParameterRegisterWords): void {
		const source = resolveApuAudioSource(registerWords);
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		this.startPlay(source, slot, registerWords);
	}

	private startPlay(source: ApuAudioSource, slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): void {
		if (!this.replaceSlotSourceDma(slot, source)) {
			return;
		}
		const voiceId = this.nextVoiceId;
		this.nextVoiceId += 1;
		this.setSlotActive(slot, registerWords, voiceId);
		if (!this.playOutputVoice(slot, voiceId, source, registerWords, 0)) {
			return;
		}
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	private stopSlot(registerWords: ApuParameterRegisterWords): void {
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		const fadeSamples = registerWords[APU_PARAMETER_FADE_SAMPLES_INDEX]!;
		if ((this.activeSlotMask & (1 << slot)) === 0) {
			this.audioOutput.stopSlot(slot);
			this.stopSlotActive(slot);
			return;
		}
		if (fadeSamples > 0) {
			this.slotFadeSamplesRemaining[slot] = fadeSamples;
			this.slotFadeSamplesTotal[slot] = fadeSamples;
			this.setSlotPhase(slot, APU_SLOT_PHASE_FADING);
			this.audioOutput.stopSlot(slot, fadeSamples);
			this.scheduleNextService(this.scheduler.currentNowCycles());
			return;
		}
		this.audioOutput.stopSlot(slot);
		this.stopSlotActive(slot);
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	private setSlotGain(registerWords: ApuParameterRegisterWords): void {
		const slot = this.readSlot(registerWords);
		if (slot === undefined) {
			return;
		}
		this.writeSlotRegisterWord(slot, APU_PARAMETER_GAIN_Q12_INDEX, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
	}

	private emitSlotEvent(kind: number, slot: ApuAudioSlot, voiceId: ApuVoiceId, sourceAddr: number): void {
		if (this.slotVoiceIds[slot] !== voiceId) {
			return;
		}
		this.stopSlotActive(slot);
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

	private setSlotActive(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords, voiceId: ApuVoiceId): void {
		this.setSlotPhase(slot, APU_SLOT_PHASE_PLAYING);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = registerWords[index] >>> 0;
		}
		this.slotPlaybackCursorQ16[slot] = registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		this.slotFadeSamplesRemaining[slot] = 0;
		this.slotFadeSamplesTotal[slot] = 0;
		this.slotVoiceIds[slot] = voiceId;
	}

	private stopSlotActive(slot: ApuAudioSlot): void {
		this.setSlotPhase(slot, APU_SLOT_PHASE_IDLE);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = 0;
		}
		this.sourceDma.clearSlot(slot);
		this.slotPlaybackCursorQ16[slot] = 0;
		this.slotFadeSamplesRemaining[slot] = 0;
		this.slotFadeSamplesTotal[slot] = 0;
		this.slotVoiceIds[slot] = 0;
	}

	private replaceSlotSourceDma(slot: ApuAudioSlot, source: ApuAudioSource): boolean {
		this.audioOutput.stopSlot(slot);
		const dma = this.sourceDma.loadSlot(slot, source);
		if (dma.faultCode !== APU_FAULT_NONE) {
			this.stopSlotActive(slot);
			this.fault.raise(dma.faultCode, dma.faultDetail);
			return false;
		}
		return true;
	}

	private setSlotPhase(slot: ApuAudioSlot, phase: ApuSlotPhase): void {
		this.slotPhases[slot] = phase;
		const bit = 1 << slot;
		if (phase === APU_SLOT_PHASE_IDLE) {
			this.activeSlotMask = (this.activeSlotMask & ~bit) >>> 0;
		} else {
			this.activeSlotMask = (this.activeSlotMask | bit) >>> 0;
		}
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.activeSlotMask);
		this.updateSelectedSlotActiveStatus();
	}

	private replayHostOutput(slot: ApuAudioSlot, voiceId: ApuVoiceId): void {
		const registerWords = this.slotRegisterDispatchWords;
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.slotRegisterWords[base + index]!;
		}
		const fadeSamples = this.slotFadeSamplesRemaining[slot]!;
		this.playOutputVoice(slot, voiceId, resolveApuAudioSource(registerWords), registerWords, fadeSamples);
	}

	private advanceActiveSlots(samples: number): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const phase = this.slotPhases[slot]!;
			if (phase === APU_SLOT_PHASE_IDLE) {
				continue;
			}
			const base = apuSlotRegisterWordIndex(slot, 0);
			const sourceAddr = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_ADDR_INDEX]!;
			const voiceId = this.slotVoiceIds[slot]!;
			const fadeSamples = this.slotFadeSamplesRemaining[slot]!;
			if (phase === APU_SLOT_PHASE_FADING) {
				const cursorSamples = samples < fadeSamples ? samples : fadeSamples;
				const endedByCursor = this.advanceSlotCursor(slot, cursorSamples);
				if (samples < fadeSamples) {
					this.slotFadeSamplesRemaining[slot] = fadeSamples - samples;
					if (endedByCursor) {
						this.slotFadeSamplesRemaining[slot] = 0;
						this.audioOutput.stopSlot(slot);
						this.emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
					}
					continue;
				}
				this.slotFadeSamplesRemaining[slot] = 0;
				this.audioOutput.stopSlot(slot);
				this.emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
				continue;
			}
			if (this.advanceSlotCursor(slot, samples)) {
				this.audioOutput.stopSlot(slot);
				this.emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, voiceId, sourceAddr);
			}
		}
	}

	private advanceSlotCursor(slot: ApuAudioSlot, samples: number): boolean {
		const base = apuSlotRegisterWordIndex(slot, 0);
		const rateStepQ16 = toSignedWord(this.slotRegisterWords[base + APU_PARAMETER_RATE_STEP_Q16_INDEX]!);
		const sourceSampleRateHz = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX]!;
		const loopStartQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		const loopEndQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE;
		let cursorQ16 = advanceApuPlaybackCursorQ16(this.slotPlaybackCursorQ16[slot]!, samples, rateStepQ16, sourceSampleRateHz);
		if (loopEndQ16 > loopStartQ16) {
			if (cursorQ16 >= loopEndQ16) {
				const loopLengthQ16 = loopEndQ16 - loopStartQ16;
				cursorQ16 = loopStartQ16 + ((cursorQ16 - loopStartQ16) % loopLengthQ16);
			}
			this.slotPlaybackCursorQ16[slot] = cursorQ16;
			return false;
		}
		this.slotPlaybackCursorQ16[slot] = cursorQ16;
		const frameEndQ16 = this.slotRegisterWords[base + APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]! * APU_RATE_STEP_Q16_ONE;
		return rateStepQ16 > 0 && cursorQ16 >= frameEndQ16;
	}

	private scheduleNextService(nowCycles: number): void {
		if (this.commandFifoCount > 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
			return;
		}
		if (this.activeSlotMask === 0) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
			this.sampleCarry = 0;
			this.availableSamples = 0;
			return;
		}
		if (this.availableSamples > 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
			return;
		}
		this.scheduler.scheduleDeviceService(
			DEVICE_SERVICE_APU,
			nowCycles + cyclesUntilBudgetUnits(this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, 1),
		);
	}

	private updateSelectedSlotActiveStatus(): void {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		const active = slot < APU_SLOT_COUNT && (this.activeSlotMask & (1 << slot)) !== 0;
		this.memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, active ? this.slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)] : 0);
		this.fault.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}

	private onStatusRead(): number {
		const busy = this.activeSlotMask !== 0 || this.commandFifoCount !== 0;
		const commandFifoEmpty = this.commandFifoCount === 0;
		const commandFifoFull = this.commandFifoCount === APU_COMMAND_FIFO_CAPACITY;
		const queuedFrames = this.audioOutput.queuedOutputFrames();
		const outputEmpty = queuedFrames === 0;
		const outputFull = queuedFrames >= this.audioOutput.capacityOutputFrames();
		return (this.fault.status
			| (busy ? APU_STATUS_BUSY : 0)
			| (commandFifoEmpty ? APU_STATUS_CMD_FIFO_EMPTY : 0)
			| (commandFifoFull ? APU_STATUS_CMD_FIFO_FULL : 0)
			| (outputEmpty ? APU_STATUS_OUTPUT_EMPTY : 0)
			| (outputFull ? APU_STATUS_OUTPUT_FULL : 0)) >>> 0;
	}

	private onSelectedSlotRegisterRead(addr: number): number {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			return 0;
		}
		const parameterIndex = (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE;
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)]!;
	}

	private onSelectedSlotRegisterWrite(addr: number, value: Value): void {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			this.fault.raise(APU_FAULT_BAD_SLOT, slot);
			return;
		}
		this.writeSlotRegisterWord(slot, (addr - IO_APU_SELECTED_SLOT_REG0) / IO_ARG_STRIDE, (value as number) >>> 0);
	}

	private writeSlotRegisterWord(slot: ApuAudioSlot, parameterIndex: number, word: number): void {
		const base = apuSlotRegisterWordIndex(slot, 0);
		this.slotRegisterWords[base + parameterIndex] = word >>> 0;
		if (parameterIndex === APU_PARAMETER_START_SAMPLE_INDEX) {
			this.slotPlaybackCursorQ16[slot] = word * APU_RATE_STEP_Q16_ONE;
		}
		if ((this.activeSlotMask & (1 << slot)) !== 0) {
			for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
				this.slotRegisterDispatchWords[index] = this.slotRegisterWords[base + index]!;
				}
				const source = resolveApuAudioSource(this.slotRegisterDispatchWords);
				if (apuParameterProgramsSourceBuffer(parameterIndex)) {
					if (!this.replaceSlotSourceDma(slot, source)) {
						return;
					}
					const voiceId = this.nextVoiceId;
				this.nextVoiceId += 1;
				const fadeSamples = this.slotFadeSamplesRemaining[slot]!;
				this.slotVoiceIds[slot] = voiceId;
				if (!this.playOutputVoice(slot, voiceId, source, this.slotRegisterDispatchWords, fadeSamples)) {
					return;
				}
				this.scheduleNextService(this.scheduler.currentNowCycles());
			} else {
				const fadeSamples = this.slotFadeSamplesRemaining[slot]!;
				const outputRegisterWords = fadeSamples > 0
					? this.fadeOutputRegisterWords(slot, this.slotRegisterDispatchWords)
					: this.slotRegisterDispatchWords;
				const outputWrite = this.audioOutput.writeSlotRegisterWord(
					slot,
					source,
					outputRegisterWords,
					parameterIndex,
					this.slotPlaybackCursorQ16[slot]!,
				);
				if (outputWrite.faultCode !== APU_FAULT_NONE) {
					this.audioOutput.stopSlot(slot);
					this.stopSlotActive(slot);
					this.fault.raise(outputWrite.faultCode, outputWrite.faultDetail);
				}
			}
		}
		this.updateSelectedSlotActiveStatus();
	}

	private playOutputVoice(slot: ApuAudioSlot, voiceId: ApuVoiceId, source: ApuAudioSource, registerWords: ApuParameterRegisterWords, fadeSamples: number): boolean {
		const outputRegisterWords = fadeSamples > 0
			? this.fadeOutputRegisterWords(slot, registerWords)
			: registerWords;
		const outputStart = this.audioOutput.playVoice(
			slot,
			voiceId,
			source,
			this.sourceDma.bytesForSlot(slot),
			outputRegisterWords,
			this.slotPlaybackCursorQ16[slot]!,
			fadeSamples,
		);
		if (outputStart.faultCode !== APU_FAULT_NONE) {
			this.audioOutput.stopSlot(slot);
			this.stopSlotActive(slot);
			this.fault.raise(outputStart.faultCode, outputStart.faultDetail);
			return false;
		}
		return true;
	}

	private fadeOutputRegisterWords(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): ApuParameterRegisterWords {
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterDispatchWords[index] = registerWords[index]!;
		}
		const gainQ12 = toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
		const scaledGain = gainQ12 * this.slotFadeSamplesRemaining[slot]!;
		const fadeTotal = this.slotFadeSamplesTotal[slot]!;
		this.slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = ((scaledGain - scaledGain % fadeTotal) / fadeTotal) >>> 0;
		return this.slotRegisterDispatchWords;
	}

}
