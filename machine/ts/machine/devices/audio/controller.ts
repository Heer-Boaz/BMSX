import { ApuActiveSlots } from './active_slots';
import { ApuCommandIngress } from './command_ingress';
import { ApuCommandExecutor } from './command_executor';
import type { DeviceScheduler } from '../../scheduler/device';
import type { ApuOutputMixer } from './output';
import type { ApuOutputRing } from './output_ring';
import type { AudioControllerState } from './save_state';
import { ApuSampleMemory } from './sample_memory';
import { ApuCommandFifo } from './command_fifo';
import { ApuEventLatch } from './event_latch';
import { ApuCommandLatch } from './command_latch';
import { ApuSlotBank } from './slot_bank';
import { ApuSelectedSlotLatch } from './selected_slot_latch';
import { ApuStatusRegister } from './status_register';
import { ApuServiceClock } from './service_clock';
import { ApuQueueStatusRegisters } from './queue_status_registers';
import {
	APU_FAULT_NONE,
	APU_PARAMETER_REGISTER_COUNT,
	APU_STATUS_FAULT,
} from '../../../spec/audio/apu';
import {
	IO_APU_CMD,
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_STATUS,
	IO_ARG_STRIDE,
} from '../../../spec/bmsx/io';
import { Memory } from '../../memory/memory';
import { DeviceStatusLatch, type DeviceStatusRegisters } from '../device_status';
import type { IrqController } from '../irq/controller';
import type { DmaController } from '../dma/controller';

const APU_DEVICE_STATUS_REGISTERS: DeviceStatusRegisters = {
	statusAddr: IO_APU_STATUS,
	codeAddr: IO_APU_FAULT_CODE,
	detailAddr: IO_APU_FAULT_DETAIL,
	ackAddr: IO_APU_FAULT_ACK,
	faultMask: APU_STATUS_FAULT,
	noneCode: APU_FAULT_NONE,
};

const APU_QUEUE_STATUS_REGISTER_ADDRS = [
	IO_APU_CMD_QUEUED,
	IO_APU_CMD_FREE,
	IO_APU_CMD_CAPACITY,
] as const;

export class AudioController {
	private readonly sampleMemory: ApuSampleMemory;
	private readonly eventLatch: ApuEventLatch;
	private readonly commandFifo = new ApuCommandFifo();
	private readonly slots = new ApuSlotBank();
	private readonly selectedSlotLatch: ApuSelectedSlotLatch;
	private readonly commandLatch: ApuCommandLatch;
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
		dma: DmaController,
		irq: IrqController,
		private readonly scheduler: DeviceScheduler,
	) {
		this.sampleMemory = new ApuSampleMemory(memory);
		this.eventLatch = new ApuEventLatch(memory, irq);
		this.fault = new DeviceStatusLatch(memory, APU_DEVICE_STATUS_REGISTERS);
		this.selectedSlotLatch = new ApuSelectedSlotLatch(memory, this.fault, this.slots);
		this.commandLatch = new ApuCommandLatch(memory, this.selectedSlotLatch);
		this.activeSlots = new ApuActiveSlots(
			memory,
			this.audioOutput,
			this.eventLatch,
			this.slots,
			this.selectedSlotLatch,
			this.commandLatch.registerWords,
		);
		this.serviceClock = new ApuServiceClock(memory, this.sampleMemory, dma, scheduler, this.commandFifo, this.activeSlots, this.audioOutput);
		this.statusRegister = new ApuStatusRegister(this.fault, this.slots, this.commandFifo, this.serviceClock, scheduler);
		this.commandIngress = new ApuCommandIngress(this.commandLatch, this.commandFifo, this.fault, this.serviceClock, scheduler);
		this.queueStatusRegisters = new ApuQueueStatusRegisters(this.commandFifo);
		this.commandExecutor = new ApuCommandExecutor(
			memory,
			this.audioOutput,
			scheduler,
			this.commandFifo,
			this.sampleMemory,
			this.activeSlots,
			this.slots,
			this.selectedSlotLatch,
			this.fault,
			this.serviceClock,
			this.commandLatch.registerWords,
		);
		this.memory.mapIoRead(IO_APU_STATUS, this.statusRegister, ApuStatusRegister.readThunk);
		this.memory.mapIoWrite(IO_APU_CMD, this.commandIngress, ApuCommandIngress.onCommandWriteThunk);
		this.memory.mapIoWrite(IO_APU_FAULT_ACK, this.fault, DeviceStatusLatch.acknowledgeWriteThunk);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			const registerAddr = IO_APU_SELECTED_SLOT_REG0 + index * IO_ARG_STRIDE;
			this.memory.mapIoRead(registerAddr, this.commandExecutor, ApuCommandExecutor.selectedSlotRegisterReadThunk);
			this.memory.mapIoWrite(registerAddr, this.commandExecutor, ApuCommandExecutor.selectedSlotRegisterWriteThunk);
		}
		for (const addr of APU_QUEUE_STATUS_REGISTER_ADDRS) {
			this.memory.mapIoRead(addr, this.queueStatusRegisters, ApuQueueStatusRegisters.readThunk);
		}
	}

	public dispose(): void {
		this.serviceClock.dispose();
		this.audioOutput.resetPlaybackState();
	}

	public reset(): void {
		this.commandFifo.reset();
		this.sampleMemory.reset();
		this.slots.reset();
		this.serviceClock.reset(this.scheduler.currentNowCycles());
		this.audioOutput.resetPlaybackState();
		this.fault.resetStatus();
		this.commandLatch.clear();
		this.eventLatch.reset();
		this.activeSlots.writeActiveMask();
	}

	public captureState(sampleRam?: Uint8Array): AudioControllerState {
		const nowCycles = this.scheduler.currentNowCycles();
		this.serviceClock.synchronize(nowCycles);
		const registerWords = Array.from(this.commandLatch.registerWords);
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
			sampleRam: this.sampleMemory.captureState(sampleRam),
			sampleTransfer: this.serviceClock.captureSampleTransferState(nowCycles),
			output: this.audioOutput.captureState(),
			sampleCarry: this.serviceClock.captureSampleCarry(),
			sampleSequence: this.serviceClock.captureSampleSequence(),
			apuStatus: this.fault.status,
			apuFaultCode: this.fault.code,
			apuFaultDetail: this.fault.detail,
		};
	}

	public restoreState(state: AudioControllerState, nowCycles: number): void {
		this.audioOutput.resetPlaybackState();
		this.commandFifo.restoreState(state.commandFifo);
		this.eventLatch.restoreState(state);
		this.sampleMemory.restoreState(state.sampleRam);
		this.slots.restore(state.slotPhases, state.slotRegisterWords);
		this.serviceClock.restore(state.sampleCarry, state.sampleSequence, state.sampleTransfer, nowCycles);
		this.fault.restore(state.apuStatus, state.apuFaultCode, state.apuFaultDetail);
		this.commandLatch.restore(state.registerWords);
		this.activeSlots.writeActiveMask();
		for (const voiceState of state.output.voices) {
			this.commandExecutor.restoreOutputVoice(voiceState);
		}
		this.serviceClock.scheduleNext(nowCycles);
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		this.serviceClock.setCpuHz(cpuHz, nowCycles);
		this.serviceClock.scheduleNext(nowCycles);
	}

	public setVoiceClockHeld(held: boolean, nowCycles: number): void {
		this.serviceClock.setVoiceClockHeld(held, nowCycles);
	}

	public onService(nowCycles: number): void {
		this.serviceClock.synchronize(nowCycles);
		this.commandExecutor.drainCommandFifo();
		this.serviceClock.scheduleNext(nowCycles);
	}

	public onTransferService(nowCycles: number): void {
		this.serviceClock.synchronize(nowCycles);
	}

	public synchronizeOutput(): ApuOutputRing {
		this.serviceClock.synchronize(this.scheduler.currentNowCycles());
		return this.audioOutput.outputRing;
	}

}
