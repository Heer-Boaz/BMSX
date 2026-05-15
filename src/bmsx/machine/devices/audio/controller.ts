import { toSignedWord } from '../../common/numeric';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU, type DeviceScheduler } from '../../scheduler/device';
import type { ApuOutputMixer } from './output';
import type { AudioControllerState } from './save_state';
import { ApuSourceDma } from './source';
import { ApuCommandFifo } from './command_fifo';
import { ApuSlotBank } from './slot_bank';
import {
	APU_GAIN_Q12_ONE,
	APU_COMMAND_FIFO_CAPACITY,
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
	APU_GENERATOR_NONE,
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_FADE_SAMPLES_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_SLOT_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_FADING,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_FAULT,
	APU_STATUS_OUTPUT_EMPTY,
	APU_STATUS_OUTPUT_FULL,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
	apuParameterProgramsSourceBuffer,
	resolveApuAudioSource,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
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
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
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
	private readonly commandFifo = new ApuCommandFifo();
	private readonly commandDispatchRegisterWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
	private readonly slotRegisterDispatchWords = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
	private readonly slots = new ApuSlotBank();
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
		this.memory.mapIoRead(IO_APU_OUTPUT_QUEUED_FRAMES, () => this.audioOutput.outputRing.queuedFrames());
		this.memory.mapIoRead(IO_APU_OUTPUT_FREE_FRAMES, () => this.audioOutput.outputRing.freeFrames());
		this.memory.mapIoRead(IO_APU_OUTPUT_CAPACITY_FRAMES, () => this.audioOutput.outputRing.capacityFrames());
		this.memory.mapIoRead(IO_APU_CMD_QUEUED, () => this.commandFifo.count);
		this.memory.mapIoRead(IO_APU_CMD_FREE, () => this.commandFifo.free);
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
		this.commandFifo.reset();
		this.sourceDma.reset();
		this.slots.reset();
		this.sampleCarry = 0;
		this.availableSamples = 0;
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
			commandFifo: this.commandFifo.captureState(),
			eventSequence: this.eventSequence,
			eventKind: this.memory.readIoU32(IO_APU_EVENT_KIND),
			eventSlot: this.memory.readIoU32(IO_APU_EVENT_SLOT),
			eventSourceAddr: this.memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR),
			slotPhases: this.slots.captureSlotPhases(),
			slotRegisterWords: this.slots.captureSlotRegisterWords(),
			slotSourceBytes: this.sourceDma.captureState(),
			slotPlaybackCursorQ16: this.slots.captureSlotPlaybackCursorQ16(),
			slotFadeSamplesRemaining: this.slots.captureSlotFadeSamplesRemaining(),
			slotFadeSamplesTotal: this.slots.captureSlotFadeSamplesTotal(),
			output: this.audioOutput.captureState(),
			sampleCarry: this.sampleCarry,
			availableSamples: this.availableSamples,
			apuStatus: this.fault.status,
			apuFaultCode: this.fault.code,
			apuFaultDetail: this.fault.detail,
		};
	}

	public restoreState(state: AudioControllerState, nowCycles: number): void {
		this.slots.resetVoiceIds();
		this.audioOutput.resetPlaybackState();
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_APU_PARAMETER_REGISTER_ADDRS[index]!, state.registerWords[index]!);
		}
		this.commandFifo.restoreState(state.commandFifo);
		this.eventSequence = state.eventSequence >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, state.eventKind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, state.eventSlot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, state.eventSourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.slots.restore(
			state.slotPhases,
			state.slotRegisterWords,
			state.slotPlaybackCursorQ16,
			state.slotFadeSamplesRemaining,
			state.slotFadeSamplesTotal,
		);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.sourceDma.restoreState(state.slotSourceBytes);
		this.sampleCarry = state.sampleCarry;
		this.availableSamples = state.availableSamples;
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
		for (const voiceState of state.output.voices) {
			const slot = voiceState.slot;
			const voiceId = this.slots.allocateVoiceId();
			this.slots.assignVoiceId(slot, voiceId);
			if (!this.replayHostOutput(slot, voiceId)) {
				throw new Error('[APU] Cannot restore saved AOUT voice.');
			}
			this.audioOutput.restoreVoiceState(voiceState);
		}
		this.updateSelectedSlotActiveStatus();
		this.scheduleNextService(nowCycles);
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		this.cpuHz = cpuHz;
		if (this.slots.activeMask === 0 && this.commandFifo.empty) {
			this.sampleCarry = 0;
			this.availableSamples = 0;
		}
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (this.slots.activeMask === 0 || cycles <= 0) {
			return;
		}
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, cycles);
		this.sampleCarry = this.budgetAccrual.carry;
		this.availableSamples += this.budgetAccrual.wholeUnits;
		this.scheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (!this.commandFifo.empty) {
			this.drainCommandFifo();
		}
		if (this.slots.activeMask === 0 || this.availableSamples === 0) {
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
		this.memory.writeValue(IO_APU_GENERATOR_KIND, APU_GENERATOR_NONE);
		this.memory.writeValue(IO_APU_GENERATOR_DUTY_Q12, APU_GAIN_Q12_ONE >>> 1);
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

	private enqueueCommand(command: number): boolean {
		if (!this.commandFifo.enqueue(command, this.memory)) {
			this.fault.raise(APU_FAULT_CMD_FIFO_FULL, command);
			return false;
		}
		return true;
	}

	private drainCommandFifo(): void {
		while (!this.commandFifo.empty) {
			const command = this.commandFifo.popInto(this.commandDispatchRegisterWords);
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
		const voiceId = this.slots.allocateVoiceId();
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
		if ((this.slots.activeMask & (1 << slot)) === 0) {
			this.audioOutput.stopSlot(slot);
			this.stopSlotActive(slot);
			return;
		}
		if (fadeSamples > 0) {
			this.slots.setFadeSamples(slot, fadeSamples);
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
		if (this.slots.voiceId(slot) !== voiceId) {
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
		this.slots.setActive(slot, registerWords, voiceId);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.updateSelectedSlotActiveStatus();
	}

	private stopSlotActive(slot: ApuAudioSlot): void {
		this.slots.clearSlot(slot);
		this.sourceDma.clearSlot(slot);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.updateSelectedSlotActiveStatus();
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

	private setSlotPhase(slot: ApuAudioSlot, phase: number): void {
		this.slots.setPhase(slot, phase);
		this.memory.writeIoValue(IO_APU_ACTIVE_MASK, this.slots.activeMask);
		this.updateSelectedSlotActiveStatus();
	}

	private replayHostOutput(slot: ApuAudioSlot, voiceId: ApuVoiceId): boolean {
		const registerWords = this.slotRegisterDispatchWords;
		this.slots.loadRegisterWords(slot, registerWords);
		const fadeSamples = this.slots.fadeSamplesRemaining(slot);
		return this.playOutputVoice(slot, voiceId, resolveApuAudioSource(registerWords), registerWords, fadeSamples);
	}

	private advanceActiveSlots(samples: number): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			if (this.slots.advanceSlot(slot, samples)) {
				this.audioOutput.stopSlot(slot);
				this.emitSlotEvent(APU_EVENT_SLOT_ENDED, slot, this.slots.voiceId(slot), this.slots.sourceAddr(slot));
			}
		}
	}

	private scheduleNextService(nowCycles: number): void {
		if (!this.commandFifo.empty) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
			return;
		}
		if (this.slots.activeMask === 0) {
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
		const active = slot < APU_SLOT_COUNT && (this.slots.activeMask & (1 << slot)) !== 0;
		this.memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, active ? this.slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX) : 0);
		this.fault.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
	}

	private onStatusRead(): number {
		const busy = this.slots.activeMask !== 0 || !this.commandFifo.empty;
		const commandFifoEmpty = this.commandFifo.empty;
		const commandFifoFull = this.commandFifo.full;
		const queuedFrames = this.audioOutput.outputRing.queuedFrames();
		const outputEmpty = queuedFrames === 0;
		const outputFull = queuedFrames >= this.audioOutput.outputRing.capacityFrames();
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
		return this.slots.registerWord(slot, parameterIndex);
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
		this.slots.writeRegisterWord(slot, parameterIndex, word);
		if ((this.slots.activeMask & (1 << slot)) !== 0) {
			this.slots.loadRegisterWords(slot, this.slotRegisterDispatchWords);
			const source = resolveApuAudioSource(this.slotRegisterDispatchWords);
			const fadeSamples = this.slots.fadeSamplesRemaining(slot);
			if (apuParameterProgramsSourceBuffer(parameterIndex)) {
				if (!this.replaceSlotSourceDma(slot, source)) {
					return;
				}
				const voiceId = this.slots.allocateVoiceId();
				this.slots.assignVoiceId(slot, voiceId);
				if (!this.playOutputVoice(slot, voiceId, source, this.slotRegisterDispatchWords, fadeSamples)) {
					return;
				}
				this.scheduleNextService(this.scheduler.currentNowCycles());
			} else {
				const outputRegisterWords = fadeSamples > 0
					? this.fadeOutputRegisterWords(slot, this.slotRegisterDispatchWords)
					: this.slotRegisterDispatchWords;
				const outputWrite = this.audioOutput.writeSlotRegisterWord(
					slot,
					source,
					outputRegisterWords,
					parameterIndex,
					this.slots.playbackCursorQ16(slot),
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
			this.slots.playbackCursorQ16(slot),
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
		const scaledGain = gainQ12 * this.slots.fadeSamplesRemaining(slot);
		const fadeTotal = this.slots.fadeSamplesTotal(slot);
		this.slotRegisterDispatchWords[APU_PARAMETER_GAIN_Q12_INDEX] = ((scaledGain - scaledGain % fadeTotal) / fadeTotal) >>> 0;
		return this.slotRegisterDispatchWords;
	}

}
