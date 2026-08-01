import {
	IO_SYS_CONTROL,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	IO_SYS_STATUS,
	IO_SYS_TIME_MS,
	SYS_PRINT_BUFFER_BYTES,
	SYS_CONTROL_RESET,
	SYS_CONTROL_SUPERVISOR_ENTER,
	SYS_CONTROL_SUPERVISOR_FAULT,
	SYS_CONTROL_SUPERVISOR_LEAVE,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_EXIT_REQUESTED,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../../spec/bmsx/io';
import type { CPU } from '../../cpu/cpu';
import { encodeUtf8Codepoint } from '../../../common/utf8';
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

export type SystemControllerState = {
	resetRequested: boolean;
	supervisorPhase: number;
	supervisorTransitionTarget: number;
	supervisorResumable: boolean;
	supervisorExitRequested: boolean;
	printBuffer: Uint8Array;
	printReadIndex: number;
	printByteCount: number;
};

const ASCII_NEWLINE = 10;

export class SystemController {
	private resetRequested = false;
	private supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	private supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	private supervisorResumable = false;
	private supervisorExitRequested = false;
	private supervisorFaultSequence = 0;
	private supervisorFaultCauseWord = 0;
	private supervisorFaultEpcWord = 0;
	private supervisorFaultBadAddressWord = 0;
	private supervisorFaultLuaReasonWord = 0;
	private readonly printBuffer = new Uint8Array(SYS_PRINT_BUFFER_BYTES);
	private printReadIndex = 0;
	private printByteCount = 0;
	private readonly hostOutputBuffer = new Uint8Array(SYS_PRINT_BUFFER_BYTES);
	private hostOutputReadIndex = 0;
	private hostOutputByteCount = 0;
	private hostOutputCompleteByteCount = 0;
	private hostOutputLineOverflowed = false;
	private readonly printEncodingBytes = new Uint8Array(4);

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly scheduler: DeviceScheduler,
		private readonly irq: IrqController,
		private readonly dma: DmaController,
		private readonly geometry: GeometryController,
		private readonly gpu: GxGpu,
		private readonly imgdec: ImgDecController,
		private cpuHz: number,
	) {
		memory.mapIoWrite(IO_SYS_CONTROL, this, SystemController.writeControl);
		memory.mapIoRead(IO_SYS_STATUS, this, SystemController.readStatus);
		memory.mapIoRead(IO_SYS_TIME_MS, this, SystemController.readTimeMilliseconds);
		memory.mapIoRead(IO_SYS_FRAME_MS_Q16, this, SystemController.readFrameMillisecondsQ16);
		memory.mapIoRead(IO_SYS_CYCLES_PER_FRAME, this, SystemController.readCyclesPerFrame);
		memory.mapIoRead(IO_SYS_PRINT_CHAR, this, SystemController.readPrintChar);
		memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, SystemController.writePrintChar);
		memory.mapIoRead(IO_SYS_PRINT_FLUSH, this, SystemController.readPrintByteCount);
		memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, SystemController.flushPrintLine);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
		this.resetRequested = false;
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.printBuffer.fill(0);
		this.printReadIndex = 0;
		this.printByteCount = 0;
		this.clearHostOutput();
		this.memory.writeIoU32(IO_SYS_CONTROL, 0);
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

	private static readPrintChar(context: SystemController): number {
		if (context.printByteCount === 0) {
			return 0;
		}
		const value = context.printBuffer[context.printReadIndex];
		context.printReadIndex = (context.printReadIndex + 1) & (SYS_PRINT_BUFFER_BYTES - 1);
		context.printByteCount -= 1;
		return value;
	}

	private static readPrintByteCount(context: SystemController): number {
		return context.printByteCount;
	}

	private static writePrintChar(context: SystemController, _address: number, value: number): void {
		const byteCount = encodeUtf8Codepoint(value, context.printEncodingBytes);
		context.appendRingByte(value <= 0xff ? value : 0x3f);
		if (!context.reserveHostOutputBytes(byteCount)) {
			return;
		}
		for (let index = 0; index < byteCount; index += 1) {
			context.appendHostOutputByte(context.printEncodingBytes[index]);
		}
	}

	private static flushPrintLine(context: SystemController): void {
		context.appendRingByte(ASCII_NEWLINE);
		if (context.reserveHostOutputBytes(1)) {
			context.appendHostOutputByte(ASCII_NEWLINE);
			context.hostOutputCompleteByteCount = context.hostOutputByteCount;
		}
		context.hostOutputLineOverflowed = false;
	}

	private reserveHostOutputBytes(byteCount: number): boolean {
		if (this.hostOutputLineOverflowed) {
			return false;
		}
		if (this.hostOutputByteCount + byteCount <= SYS_PRINT_BUFFER_BYTES) {
			return true;
		}
		this.hostOutputByteCount = this.hostOutputCompleteByteCount;
		this.hostOutputLineOverflowed = true;
		return false;
	}

	private clearHostOutput(): void {
		this.hostOutputReadIndex = 0;
		this.hostOutputByteCount = 0;
		this.hostOutputCompleteByteCount = 0;
		this.hostOutputLineOverflowed = false;
	}

	private appendHostOutputByte(value: number): void {
		this.hostOutputBuffer[(this.hostOutputReadIndex + this.hostOutputByteCount) & (SYS_PRINT_BUFFER_BYTES - 1)] = value;
		this.hostOutputByteCount += 1;
	}

	public hostOutputAvailableByteCount(): number {
		return this.hostOutputCompleteByteCount;
	}

	public readHostOutputByte(): number {
		const value = this.hostOutputBuffer[this.hostOutputReadIndex];
		this.hostOutputReadIndex = (this.hostOutputReadIndex + 1) & (SYS_PRINT_BUFFER_BYTES - 1);
		this.hostOutputByteCount -= 1;
		this.hostOutputCompleteByteCount -= 1;
		return value;
	}

	private appendRingByte(value: number): void {
		if (this.printByteCount === SYS_PRINT_BUFFER_BYTES) {
			this.printReadIndex = (this.printReadIndex + 1) & (SYS_PRINT_BUFFER_BYTES - 1);
			this.printByteCount -= 1;
		}
		this.printBuffer[(this.printReadIndex + this.printByteCount) & (SYS_PRINT_BUFFER_BYTES - 1)] = value;
		this.printByteCount += 1;
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
			if ((value & SYS_CONTROL_SUPERVISOR_LEAVE) !== 0) {
				context.beginSupervisorLeave();
			}
		}
		context.memory.writeIoU32(IO_SYS_CONTROL, 0);
	}

	public requestSupervisorLineEdge(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_USER) {
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
			this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
			this.supervisorResumable = false;
			this.supervisorExitRequested = false;
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
			this.supervisorExitRequested = false;
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
		this.supervisorExitRequested = false;
		this.writeStatusIo();
	}

	private enterSupervisorFault(): void {
		this.supervisorFaultCauseWord = this.cpu.readCauseWord();
		this.supervisorFaultEpcWord = this.cpu.readEpcWord();
		this.supervisorFaultBadAddressWord = this.cpu.readBadAddressWord();
		this.supervisorFaultLuaReasonWord = this.cpu.readLuaFaultReasonWord();
		this.supervisorFaultSequence = (this.supervisorFaultSequence + 1) >>> 0;
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ACTIVE) {
			this.supervisorExitRequested = false;
			this.writeStatusIo();
			return;
		}
		this.cpu.cancelNonMaskableInterrupt();
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_USER) {
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
			this.gpu.beginSupervisorControlQuiesce();
			this.dma.beginSupervisorControlQuiesce();
			this.geometry.beginSupervisorQuiesce();
			this.imgdec.beginSupervisorQuiesce();
		}
		this.supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_FAULT;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.writeStatusIo();
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		this.cpu.requestYield();
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

	public readSupervisorFaultSequence(): number {
		return this.supervisorFaultSequence;
	}

	public readSupervisorFaultCauseWord(): number {
		return this.supervisorFaultCauseWord;
	}

	public readSupervisorFaultEpcWord(): number {
		return this.supervisorFaultEpcWord;
	}

	public readSupervisorFaultBadAddressWord(): number {
		return this.supervisorFaultBadAddressWord;
	}

	public readSupervisorFaultLuaReasonWord(): number {
		return this.supervisorFaultLuaReasonWord;
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
			printBuffer: this.printBuffer.slice(),
			printReadIndex: this.printReadIndex,
			printByteCount: this.printByteCount,
		};
	}

	public restoreState(state: SystemControllerState): void {
		this.resetRequested = state.resetRequested;
		this.supervisorPhase = state.supervisorPhase;
		this.supervisorTransitionTarget = state.supervisorTransitionTarget;
		this.supervisorResumable = state.supervisorResumable;
		this.supervisorExitRequested = state.supervisorExitRequested;
		this.printBuffer.set(state.printBuffer);
		this.printReadIndex = state.printReadIndex;
		this.printByteCount = state.printByteCount;
		this.clearHostOutput();
		this.memory.writeIoU32(IO_SYS_CONTROL, 0);
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
}
