import {
	IO_SYS_CONTROL,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	IO_SYS_STATUS,
	SYS_PRINT_BUFFER_BYTES,
	SYS_CONTROL_RESET,
	SYS_CONTROL_SUPERVISOR_ENTER,
	SYS_CONTROL_SUPERVISOR_FAULT,
	SYS_CONTROL_SUPERVISOR_LEAVE,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_EXIT_REQUESTED,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../bus/io';
import type { CPU, Value } from '../../cpu/cpu';
import { encodeUtf8Codepoint } from '../../../common/utf8';
import type { DmaController } from '../dma/controller';
import type { GeometryController } from '../geometry/controller';
import type { GxGpu } from '../gx/gpu';
import type { IrqController } from '../irq/controller';
import { Memory } from '../../memory/memory';
import { DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';

export const SYSTEM_SUPERVISOR_PHASE_USER = 0;
export const SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE = 1;
export const SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR = 2;
export const SYSTEM_SUPERVISOR_PHASE_ACTIVE = 3;
export const SYSTEM_SUPERVISOR_PHASE_LEAVING = 4;

export type SystemControllerState = {
	resetRequested: boolean;
	supervisorPhase: number;
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
	private supervisorResumable = false;
	private supervisorExitRequested = false;
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
	) {
		memory.mapIoWrite(IO_SYS_CONTROL, this, SystemController.writeControl);
		memory.mapIoRead(IO_SYS_STATUS, this, SystemController.readStatus);
		memory.mapIoRead(IO_SYS_PRINT_CHAR, this, SystemController.readPrintChar);
		memory.mapIoWrite(IO_SYS_PRINT_CHAR, this, SystemController.writePrintChar);
		memory.mapIoRead(IO_SYS_PRINT_FLUSH, this, SystemController.readPrintByteCount);
		memory.mapIoWrite(IO_SYS_PRINT_FLUSH, this, SystemController.flushPrintLine);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
		this.resetRequested = false;
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.printBuffer.fill(0);
		this.printReadIndex = 0;
		this.printByteCount = 0;
		this.clearHostOutput();
		this.memory.writeIoValue(IO_SYS_CONTROL, 0);
		this.writeStatusIo();
	}

	private static readStatus(context: SystemController): Value {
		return context.statusWord();
	}

	private static readPrintChar(context: SystemController): Value {
		if (context.printByteCount === 0) {
			return 0;
		}
		const value = context.printBuffer[context.printReadIndex];
		context.printReadIndex = (context.printReadIndex + 1) & (SYS_PRINT_BUFFER_BYTES - 1);
		context.printByteCount -= 1;
		return value;
	}

	private static readPrintByteCount(context: SystemController): Value {
		return context.printByteCount;
	}

	private static writePrintChar(context: SystemController, _address: number, value: Value): void {
		const codepoint = (value as number) >>> 0;
		const byteCount = encodeUtf8Codepoint(codepoint, context.printEncodingBytes);
		context.appendRingByte(codepoint <= 0xff ? codepoint : 0x3f);
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

	private static writeControl(context: SystemController, _address: number, value: Value): void {
		const control = (value as number) >>> 0;
		if ((control & SYS_CONTROL_RESET) !== 0) {
			context.resetRequested = true;
			context.cpu.requestYield();
		}
		if (!context.cpu.isUserMode()) {
			if ((control & SYS_CONTROL_SUPERVISOR_ENTER) !== 0) {
				context.enterSupervisor();
			}
			if ((control & SYS_CONTROL_SUPERVISOR_FAULT) !== 0) {
				context.enterSupervisorFault();
			}
			if ((control & SYS_CONTROL_SUPERVISOR_LEAVE) !== 0) {
				context.beginSupervisorLeave();
			}
		}
		context.memory.writeIoValue(IO_SYS_CONTROL, 0);
	}

	public requestSupervisorLineEdge(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_USER) {
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE;
			this.supervisorResumable = true;
			this.supervisorExitRequested = false;
			this.gpu.beginSupervisorQuiesce();
			this.dma.beginSupervisorQuiesce();
			this.geometry.beginSupervisorQuiesce();
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
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE) {
			if (!this.gpu.supervisorQuiescent()
				|| !this.dma.supervisorQuiescent()
				|| !this.geometry.supervisorQuiescent()) {
				return;
			}
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
			this.cpu.abortStalledMemoryWrite();
			this.cpu.requestNonMaskableInterrupt();
			this.writeStatusIo();
			return;
		}
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_LEAVING) {
			if (!this.gpu.supervisorQuiescent()
				|| !this.dma.supervisorQuiescent()
				|| !this.geometry.supervisorQuiescent()) {
				return;
			}
			this.gpu.leaveSupervisorContext();
			this.dma.leaveSupervisorContext();
			this.geometry.leaveSupervisorContext();
			this.irq.leaveSupervisorContext();
			this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
			this.supervisorResumable = false;
			this.supervisorExitRequested = false;
			this.writeStatusIo();
		}
	}

	private enterSupervisor(): void {
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
		this.supervisorExitRequested = false;
		this.writeStatusIo();
	}

	private enterSupervisorFault(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_LEAVING) {
			return;
		}
		this.cpu.cancelNonMaskableInterrupt();
		this.dma.enterSupervisorFaultContext();
		this.gpu.enterSupervisorFaultContext();
		this.geometry.enterSupervisorFaultContext();
		this.irq.enterSupervisorFaultContext();
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ACTIVE;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.writeStatusIo();
	}

	private beginSupervisorLeave(): void {
		if (this.supervisorPhase !== SYSTEM_SUPERVISOR_PHASE_ACTIVE || !this.supervisorResumable) {
			return;
		}
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_LEAVING;
		this.supervisorExitRequested = false;
		this.gpu.beginSupervisorQuiesce();
		this.dma.beginSupervisorQuiesce();
		this.geometry.beginSupervisorQuiesce();
		this.writeStatusIo();
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
	}

	public cpuHeld(): boolean {
		return this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_LEAVING;
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
		this.supervisorResumable = state.supervisorResumable;
		this.supervisorExitRequested = state.supervisorExitRequested;
		this.printBuffer.set(state.printBuffer);
		this.printReadIndex = state.printReadIndex;
		this.printByteCount = state.printByteCount;
		this.clearHostOutput();
		this.memory.writeIoValue(IO_SYS_CONTROL, 0);
		this.writeStatusIo();
	}

	public postLoad(): void {
		if (this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE
			|| this.supervisorPhase === SYSTEM_SUPERVISOR_PHASE_LEAVING) {
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
		this.memory.writeIoValue(IO_SYS_STATUS, this.statusWord());
	}
}
