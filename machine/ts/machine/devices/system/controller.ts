import {
	IO_SYS_CONTROL,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_STATUS,
	IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS_INDEX,
	IO_SYS_SUPERVISOR_FAULT_CAUSE_INDEX,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN_INDEX,
	IO_SYS_SUPERVISOR_FAULT_EPC_INDEX,
	IO_SYS_SUPERVISOR_FAULT_LUA_REASON_INDEX,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX,
	IO_SYS_SUPERVISOR_FAULT_WORD_COUNT,
	IO_SYS_TIME_MS,
	SYS_CONTROL_RESET,
	SYS_CONTROL_SUPERVISOR_ENTER,
	SYS_CONTROL_SUPERVISOR_FAULT,
	SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH,
	SYS_CONTROL_SUPERVISOR_LEAVE,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_EXIT_REQUESTED,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../../spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import type { CPU } from '../../cpu/cpu';
import type { AudioController } from '../audio/controller';
import type { DmaController } from '../dma/controller';
import type { GeometryController } from '../geometry/controller';
import type { GxGpu } from '../gx/gpu';
import type { IrqController } from '../irq/controller';
import type { ImgDecController } from '../imgdec/controller';
import { Memory } from '../../memory/memory';
import { DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';

export const SYSTEM_SUPERVISOR_PHASE_USER = 0;
export const SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE = 1;
export const SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR = 2;
export const SYSTEM_SUPERVISOR_PHASE_ACTIVE = 3;
export const SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE = 4;
export const SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE = 5;

export const SYSTEM_SUPERVISOR_TARGET_USER = 0;
export const SYSTEM_SUPERVISOR_TARGET_SUPERVISOR = 1;
export const SYSTEM_SUPERVISOR_TARGET_FAULT = 2;

const SYSTEM_SUPERVISOR_FAULT_REGISTER_SEQUENCE = 0;
const SYSTEM_SUPERVISOR_FAULT_REGISTER_CAUSE = IO_SYS_SUPERVISOR_FAULT_CAUSE_INDEX - IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX;
const SYSTEM_SUPERVISOR_FAULT_REGISTER_EPC = IO_SYS_SUPERVISOR_FAULT_EPC_INDEX - IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX;
const SYSTEM_SUPERVISOR_FAULT_REGISTER_BAD_ADDRESS = IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS_INDEX - IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX;
const SYSTEM_SUPERVISOR_FAULT_REGISTER_LUA_REASON = IO_SYS_SUPERVISOR_FAULT_LUA_REASON_INDEX - IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX;
const SYSTEM_SUPERVISOR_FAULT_REGISTER_DOMAIN = IO_SYS_SUPERVISOR_FAULT_DOMAIN_INDEX - IO_SYS_SUPERVISOR_FAULT_SEQUENCE_INDEX;

export type SystemControllerState = {
	resetRequested: boolean;
	supervisorPhase: number;
	supervisorTransitionTarget: number;
	supervisorResumable: boolean;
	supervisorExitRequested: boolean;
	supervisorFaultSequenceWord: number;
	supervisorFaultCauseWord: number;
	supervisorFaultEpcWord: number;
	supervisorFaultBadAddressWord: number;
	supervisorFaultLuaReasonWord: number;
	supervisorFaultDomainWord: number;
};

export class SystemController {
	private resetRequested = false;
	private supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	private supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	private supervisorResumable = false;
	private supervisorExitRequested = false;
	private readonly supervisorFaultRegisterWords = new Uint32Array(IO_SYS_SUPERVISOR_FAULT_WORD_COUNT);
	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly scheduler: DeviceScheduler,
		private readonly irq: IrqController,
		private readonly dma: DmaController,
		private readonly geometry: GeometryController,
		private readonly gpu: GxGpu,
		private readonly imgdec: ImgDecController,
		private readonly audio: AudioController,
		private cpuHz: number,
	) {
		memory.mapIoWrite(IO_SYS_CONTROL, this, SystemController.writeControl);
		memory.mapIoRead(IO_SYS_STATUS, this, SystemController.readStatus);
		memory.mapIoRead(IO_SYS_TIME_MS, this, SystemController.readTimeMilliseconds);
		memory.mapIoRead(IO_SYS_FRAME_MS_Q16, this, SystemController.readFrameMillisecondsQ16);
		memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, SystemController.readCyclesPerFrame);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
		this.resetRequested = false;
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.supervisorFaultRegisterWords.fill(0);
		this.audio.setVoiceClockHeld(false, this.scheduler.currentNowCycles());
		this.memory.writeIoU32(IO_SYS_CONTROL, 0);
		this.writeSupervisorFaultIo();
		this.writeStatusIo();
	}

	public setTiming(cpuHz: number): void {
		this.cpuHz = cpuHz;
	}

	public elapsedMilliseconds(): number {
		return this.scheduler.currentNowCycles() * 1000 / this.cpuHz;
	}

	private static readStatus(context: SystemController): number {
		return context.statusWord();
	}

	private static readTimeMilliseconds(context: SystemController): number {
		const cycles = context.scheduler.currentNowCycles();
		const cycleRemainder = cycles % context.cpuHz;
		const wholeSeconds = (cycles - cycleRemainder) / context.cpuHz;
		const millisecondNumerator = cycleRemainder * 1000;
		const millisecondRemainder = millisecondNumerator % context.cpuHz;
		return (
			wholeSeconds * 1000
			+ (millisecondNumerator - millisecondRemainder) / context.cpuHz
		) >>> 0;
	}

	private static readFrameMillisecondsQ16(context: SystemController): number {
		return context.gpu.readPcrtcTiming().frameDurationMillisecondsQ16;
	}

	private static readCyclesPerFrame(context: SystemController): number {
		return context.gpu.readPcrtcTiming().nextVblankCycleBudget >>> 0;
	}

	private static writeControl(context: SystemController, _address: number, value: number): void {
		if ((value & SYS_CONTROL_RESET) !== 0) {
			context.resetRequested = true;
			context.cpu.requestYield();
		}
		if (!context.cpu.isUserMode()) {
			if ((value & SYS_CONTROL_SUPERVISOR_ENTER) !== 0) {
				context.activateSupervisorContext();
			}
			if ((value & SYS_CONTROL_SUPERVISOR_FAULT) !== 0) {
				context.enterSupervisorFault();
			}
			if ((value & SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH) !== 0) {
				context.publishSupervisorFault();
			}
			if ((value & SYS_CONTROL_SUPERVISOR_LEAVE) !== 0) {
				context.beginSupervisorLeave();
			}
		}
		context.memory.writeIoU32(IO_SYS_CONTROL, 0);
	}

	public requestSupervisorLineEdge(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_USER) {
			this.audio.setVoiceClockHeld(true, this.scheduler.currentNowCycles());
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
			this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
			this.supervisorResumable = false;
			this.gpu.beginSupervisorControlQuiesce();
			this.dma.beginSupervisorControlQuiesce();
			this.geometry.beginSupervisorQuiesce();
			this.imgdec.beginSupervisorQuiesce();
			this.writeStatusIo();
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
			return;
		}
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ACTIVE && this.supervisorResumable) {
			this.supervisorExitRequested = true;
			this.writeStatusIo();
		}
	}

	public onService(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE) {
			if (!this.geometry.supervisorQuiescent()
				|| !this.imgdec.supervisorQuiescent()) {
				return;
			}
			this.dma.beginSupervisorQuiesce();
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
			this.writeStatusIo();
		}
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE) {
			if (!this.dma.supervisorQuiescent()) {
				return;
			}
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE;
			this.gpu.beginSupervisorQuiesce();
			this.writeStatusIo();
		}
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE) {
			if (!this.gpu.supervisorQuiescent()) {
				return;
			}
			if (this.supervisorTransitionTarget === SYSTEM_SUPERVISOR_TARGET_SUPERVISOR) {
				this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
				this.cpu.abortStalledMemoryWrite();
				this.cpu.requestNonMaskableInterrupt();
				this.writeStatusIo();
				return;
			}
			if (this.supervisorTransitionTarget === SYSTEM_SUPERVISOR_TARGET_FAULT) {
				this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
				this.activateSupervisorContext();
				return;
			}
			this.dma.leaveSupervisorContext();
			this.gpu.leaveSupervisorContext();
			this.geometry.leaveSupervisorContext();
			this.imgdec.leaveSupervisorContext();
			this.irq.leaveSupervisorContext();
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
			this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
			this.supervisorResumable = false;
			this.audio.setVoiceClockHeld(false, this.scheduler.currentNowCycles());
			this.writeStatusIo();
		}
	}

	private activateSupervisorContext(): void {
		if (this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR) {
			return;
		}
		// Bank the user IRQ latch before resetting the supervisor GPU context;
		// GP1 reset acknowledges the GPU line in the active IRQ bank.
		this.irq.enterSupervisorContext();
		this.dma.enterSupervisorContext();
		this.gpu.enterSupervisorContext();
		this.supervisorResumable = true;
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ACTIVE;
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
		this.writeStatusIo();
	}

	private enterSupervisorFault(): void {
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_CAUSE] = this.cpu.readCauseWord();
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_EPC] = this.cpu.readEpcWord();
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_BAD_ADDRESS] = this.cpu.readBadAddressWord();
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_LUA_REASON] = this.cpu.readLuaFaultReasonWord();
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_DOMAIN] = this.cpu.readExceptionDomainWord();
		this.writeSupervisorFaultIo();
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ACTIVE) {
			return;
		}
		this.cpu.cancelNonMaskableInterrupt();
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_USER) {
			this.audio.setVoiceClockHeld(true, this.scheduler.currentNowCycles());
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
			this.gpu.beginSupervisorControlQuiesce();
			this.dma.beginSupervisorControlQuiesce();
			this.geometry.beginSupervisorQuiesce();
			this.imgdec.beginSupervisorQuiesce();
		}
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_FAULT;
		this.supervisorResumable = false;
		this.writeStatusIo();
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		this.cpu.requestYield();
	}

	private publishSupervisorFault(): void {
		const sequence = (this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_SEQUENCE]! + 1) >>> 0;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_SEQUENCE] = sequence;
		this.memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE, sequence);
	}

	private beginSupervisorLeave(): void {
		if (this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ACTIVE || !this.supervisorResumable) {
			return;
		}
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
		this.supervisorExitRequested = false;
		this.gpu.beginSupervisorControlQuiesce();
		this.dma.beginSupervisorControlQuiesce();
		this.dma.beginSupervisorQuiesce();
		this.writeStatusIo();
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		this.cpu.requestYield();
	}

	public cpuHeld(): boolean {
		return this.supervisorTransitionTarget !== SYSTEM_SUPERVISOR_TARGET_SUPERVISOR
			&& (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE
				|| this.supervisorPhase >= SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE);
	}

	public supervisorContextActive(): boolean {
		return this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_USER;
	}

	public takeResetRequest(): boolean {
		const requested = this.resetRequested;
		this.resetRequested = false;
		return requested;
	}

	public captureState(): SystemControllerState {
		return {
			resetRequested: this.resetRequested,
			supervisorPhase: this.supervisorPhase,
			supervisorTransitionTarget: this.supervisorTransitionTarget,
			supervisorResumable: this.supervisorResumable,
			supervisorExitRequested: this.supervisorExitRequested,
			supervisorFaultSequenceWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_SEQUENCE]!,
			supervisorFaultCauseWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_CAUSE]!,
			supervisorFaultEpcWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_EPC]!,
			supervisorFaultBadAddressWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_BAD_ADDRESS]!,
			supervisorFaultLuaReasonWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_LUA_REASON]!,
			supervisorFaultDomainWord: this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_DOMAIN]!,
		};
	}

	public restoreState(state: SystemControllerState): void {
		this.resetRequested = state.resetRequested;
		this.supervisorPhase = state.supervisorPhase;
		this.supervisorTransitionTarget = state.supervisorTransitionTarget;
		this.supervisorResumable = state.supervisorResumable;
		this.supervisorExitRequested = state.supervisorExitRequested;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_SEQUENCE] = state.supervisorFaultSequenceWord;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_CAUSE] = state.supervisorFaultCauseWord;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_EPC] = state.supervisorFaultEpcWord;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_BAD_ADDRESS] = state.supervisorFaultBadAddressWord;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_LUA_REASON] = state.supervisorFaultLuaReasonWord;
		this.supervisorFaultRegisterWords[SYSTEM_SUPERVISOR_FAULT_REGISTER_DOMAIN] = state.supervisorFaultDomainWord;
		this.audio.setVoiceClockHeld(
			this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_USER,
			this.scheduler.currentNowCycles(),
		);
		this.memory.writeIoU32(IO_SYS_CONTROL, 0);
		this.writeSupervisorFaultIo();
		this.writeStatusIo();
	}

	public postLoad(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE
			|| this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE
			|| this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	private statusWord(): number {
		let status = 0;
		if (this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_USER) {
			status |= SYS_STATUS_SUPERVISOR_ACTIVE;
		}
		if (this.supervisorExitRequested) {
			status |= SYS_STATUS_SUPERVISOR_EXIT_REQUESTED;
		}
		if (this.supervisorResumable) {
			status |= SYS_STATUS_SUPERVISOR_RESUMABLE;
		}
		return status;
	}

	private writeStatusIo(): void {
		this.memory.writeIoU32(IO_SYS_STATUS, this.statusWord());
	}

	private writeSupervisorFaultIo(): void {
		for (let index = 0; index < IO_SYS_SUPERVISOR_FAULT_WORD_COUNT; index += 1) {
			this.memory.writeIoU32(
				IO_SYS_SUPERVISOR_FAULT_SEQUENCE + index * IO_WORD_SIZE,
				this.supervisorFaultRegisterWords[index]!,
			);
		}
	}
}
