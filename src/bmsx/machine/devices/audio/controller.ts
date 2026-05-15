import { ApuActiveSlots } from './active_slots';
import { ApuCommandIngress } from './command_ingress';
import { ApuCommandExecutor } from './command_executor';
import type { DeviceScheduler } from '../../scheduler/device';
import type { ApuOutputMixer } from './output';
import type { AudioControllerState } from './save_state';
import { ApuSourceDma } from './source';
import { ApuCommandFifo } from './command_fifo';
import { ApuEventLatch } from './event_latch';
import { clearApuCommandLatch } from './command_latch';
import { ApuSlotBank } from './slot_bank';
import { ApuSelectedSlotLatch } from './selected_slot_latch';
import { ApuStatusRegister } from './status_register';
import { ApuServiceClock } from './service_clock';
import { ApuQueueStatusRegisters } from './queue_status_registers';
import {
	APU_FAULT_NONE,
	APU_PARAMETER_REGISTER_COUNT,
	APU_STATUS_FAULT,
} from './contracts';
import {
	IO_APU_CMD,
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_OUTPUT_CAPACITY_FRAMES,
	IO_APU_OUTPUT_FREE_FRAMES,
	IO_APU_OUTPUT_QUEUED_FRAMES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_PARAMETER_REGISTER_ADDRS,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SLOT,
	IO_APU_STATUS,
	IO_ARG_STRIDE,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { IrqController } from '../irq/controller';

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
	private readonly eventLatch: ApuEventLatch;
	private readonly commandFifo = new ApuCommandFifo();
	private readonly slots = new ApuSlotBank();
	private readonly selectedSlotLatch: ApuSelectedSlotLatch;
	private readonly activeSlots: ApuActiveSlots;
	private readonly statusRegister: ApuStatusRegister;
	private readonly serviceClock: ApuServiceClock;
	private readonly commandIngress: ApuCommandIngress;
	private readonly queueStatusRegisters: ApuQueueStatusRegisters;
	private readonly commandExecutor: ApuCommandExecutor;
	private readonly fault: DeviceStatusLatch;

	public constructor(
		private readonly memory: Memory,
		private readonly audioOutput: ApuOutputMixer,
		irq: IrqController,
		scheduler: DeviceScheduler,
	) {
		this.sourceDma = new ApuSourceDma(memory);
		this.eventLatch = new ApuEventLatch(memory, irq);
		this.fault = new DeviceStatusLatch(memory, APU_DEVICE_STATUS_REGISTERS);
		this.selectedSlotLatch = new ApuSelectedSlotLatch(memory, this.fault, this.slots);
		this.activeSlots = new ApuActiveSlots(memory, this.audioOutput, this.sourceDma, this.eventLatch, this.slots, this.selectedSlotLatch);
		this.statusRegister = new ApuStatusRegister(this.fault, this.slots, this.commandFifo, this.audioOutput.outputRing);
		this.serviceClock = new ApuServiceClock(scheduler, this.commandFifo, this.slots);
		this.commandIngress = new ApuCommandIngress(memory, this.commandFifo, this.fault, this.serviceClock, scheduler);
		this.queueStatusRegisters = new ApuQueueStatusRegisters(this.commandFifo, this.audioOutput.outputRing);
		this.commandExecutor = new ApuCommandExecutor(
			memory,
			this.audioOutput,
			scheduler,
			this.commandFifo,
			this.sourceDma,
			this.activeSlots,
			this.slots,
			this.selectedSlotLatch,
			this.fault,
			this.serviceClock,
		);
		this.memory.mapIoRead(IO_APU_STATUS, this.statusRegister.read.bind(this.statusRegister));
		this.memory.mapIoWrite(IO_APU_CMD, this.commandIngress.onCommandWrite.bind(this.commandIngress));
		this.memory.mapIoWrite(IO_APU_SLOT, this.selectedSlotLatch.refresh.bind(this.selectedSlotLatch));
		this.memory.mapIoWrite(IO_APU_FAULT_ACK, this.fault.acknowledge.bind(this.fault));
		const queueStatusRegisterRead = this.queueStatusRegisters.read.bind(this.queueStatusRegisters);
		this.memory.mapIoRead(IO_APU_OUTPUT_QUEUED_FRAMES, queueStatusRegisterRead);
		this.memory.mapIoRead(IO_APU_OUTPUT_FREE_FRAMES, queueStatusRegisterRead);
		this.memory.mapIoRead(IO_APU_OUTPUT_CAPACITY_FRAMES, queueStatusRegisterRead);
		this.memory.mapIoRead(IO_APU_CMD_QUEUED, queueStatusRegisterRead);
		this.memory.mapIoRead(IO_APU_CMD_FREE, queueStatusRegisterRead);
		this.memory.mapIoRead(IO_APU_CMD_CAPACITY, queueStatusRegisterRead);
		const selectedSlotRegisterRead = this.commandExecutor.onSelectedSlotRegisterRead.bind(this.commandExecutor);
		const selectedSlotRegisterWrite = this.commandExecutor.onSelectedSlotRegisterWrite.bind(this.commandExecutor);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			const registerAddr = IO_APU_SELECTED_SLOT_REG0 + index * IO_ARG_STRIDE;
			this.memory.mapIoRead(registerAddr, selectedSlotRegisterRead);
			this.memory.mapIoWrite(registerAddr, selectedSlotRegisterWrite);
		}
	}

	public dispose(): void {
		this.serviceClock.reset();
		this.audioOutput.resetPlaybackState();
	}

	public reset(): void {
		this.commandFifo.reset();
		this.sourceDma.reset();
		this.slots.reset();
		this.serviceClock.reset();
		this.audioOutput.resetPlaybackState();
		this.fault.resetStatus();
		clearApuCommandLatch(this.memory);
		this.eventLatch.reset();
		this.selectedSlotLatch.reset();
		this.activeSlots.writeActiveMask();
	}

	public captureState(): AudioControllerState {
		const registerWords = new Array<number>(APU_PARAMETER_REGISTER_COUNT);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			registerWords[index] = this.memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]!);
		}
		const event = this.eventLatch.captureState();
		return {
			registerWords,
			commandFifo: this.commandFifo.captureState(),
			eventSequence: event.eventSequence,
			eventKind: event.eventKind,
			eventSlot: event.eventSlot,
			eventSourceAddr: event.eventSourceAddr,
			slotPhases: this.slots.captureSlotPhases(),
			slotRegisterWords: this.slots.captureSlotRegisterWords(),
			slotSourceBytes: this.sourceDma.captureState(),
			slotPlaybackCursorQ16: this.slots.captureSlotPlaybackCursorQ16(),
			slotFadeSamplesRemaining: this.slots.captureSlotFadeSamplesRemaining(),
			slotFadeSamplesTotal: this.slots.captureSlotFadeSamplesTotal(),
			output: this.audioOutput.captureState(),
			sampleCarry: this.serviceClock.captureSampleCarry(),
			availableSamples: this.serviceClock.captureAvailableSamples(),
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
		this.eventLatch.restoreState(state);
		this.slots.restore(
			state.slotPhases,
			state.slotRegisterWords,
			state.slotPlaybackCursorQ16,
			state.slotFadeSamplesRemaining,
			state.slotFadeSamplesTotal,
		);
		this.sourceDma.restoreState(state.slotSourceBytes);
		this.serviceClock.restore(state.sampleCarry, state.availableSamples);
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
		this.activeSlots.writeActiveMask();
		for (const voiceState of state.output.voices) {
			const slot = voiceState.slot;
			const voiceId = this.slots.allocateVoiceId();
			this.slots.assignVoiceId(slot, voiceId);
			if (!this.commandExecutor.replayHostOutput(slot, voiceId)) {
				throw new Error('[APU] Cannot restore saved AOUT voice.');
			}
			this.audioOutput.restoreVoiceState(voiceState);
		}
		this.serviceClock.scheduleNext(nowCycles);
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		this.serviceClock.setCpuHz(cpuHz);
		if (this.slots.activeMask === 0 && this.commandFifo.empty) {
			this.serviceClock.clearBudget();
		}
		this.serviceClock.scheduleNext(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (this.slots.activeMask === 0 || cycles <= 0) {
			return;
		}
		this.serviceClock.accrueCycles(cycles);
		this.serviceClock.scheduleNext(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (!this.commandFifo.empty) {
			this.commandExecutor.drainCommandFifo();
		}
		if (this.slots.activeMask === 0 || !this.serviceClock.pendingSamples()) {
			this.serviceClock.scheduleNext(nowCycles);
			return;
		}
		this.activeSlots.advance(this.serviceClock.consumeSamples());
		this.serviceClock.scheduleNext(nowCycles);
	}

}
