import {
	IO_SYS_CONTROL,
	IO_SYS_STATUS,
	SYS_CONTROL_RESET,
	SYS_CONTROL_SUPERVISOR_ENTER,
	SYS_CONTROL_SUPERVISOR_FAULT,
	SYS_CONTROL_SUPERVISOR_LEAVE,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_EXIT_REQUESTED,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
} from '../../bus/io';
import type { CPU, Value } from '../../cpu/cpu';
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
};

export class SystemController {
	private resetRequested = false;
	private supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	private supervisorResumable = false;
	private supervisorExitRequested = false;

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
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
		this.resetRequested = false;
		this.supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		this.supervisorResumable = false;
		this.supervisorExitRequested = false;
		this.memory.writeIoValue(IO_SYS_CONTROL, 0);
		this.writeStatusIo();
	}

	private static readStatus(context: SystemController): Value {
		return context.statusWord();
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
		};
	}

	public restoreState(state: SystemControllerState): void {
		this.resetRequested = state.resetRequested;
		this.supervisorPhase = state.supervisorPhase;
		this.supervisorResumable = state.supervisorResumable;
		this.supervisorExitRequested = state.supervisorExitRequested;
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
