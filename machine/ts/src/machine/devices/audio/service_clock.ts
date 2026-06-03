import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU, type DeviceScheduler } from '../../scheduler/device';
import type { ApuCommandFifo } from './command_fifo';
import { APU_SAMPLE_RATE_HZ } from './contracts';
import type { ApuSlotBank } from './slot_bank';

export class ApuServiceClock {
	private cpuHz = APU_SAMPLE_RATE_HZ;
	private sampleCarry = 0;
	private availableSamples = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };

	public constructor(
		private readonly scheduler: DeviceScheduler,
		private readonly commandFifo: ApuCommandFifo,
		private readonly slots: ApuSlotBank,
	) {}

	public reset(): void {
		this.sampleCarry = 0;
		this.availableSamples = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	}

	public captureSampleCarry(): number {
		return this.sampleCarry;
	}

	public captureAvailableSamples(): number {
		return this.availableSamples;
	}

	public restore(sampleCarry: number, availableSamples: number): void {
		this.sampleCarry = sampleCarry;
		this.availableSamples = availableSamples;
	}

	public setCpuHz(cpuHz: number): void {
		this.cpuHz = cpuHz;
	}

	public clearBudget(): void {
		this.sampleCarry = 0;
		this.availableSamples = 0;
	}

	public accrueCycles(cycles: number): void {
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, cycles);
		this.sampleCarry = this.budgetAccrual.carry;
		this.availableSamples += this.budgetAccrual.wholeUnits;
	}

	public pendingSamples(): boolean {
		return this.availableSamples !== 0;
	}

	public consumeSamples(): number {
		const samples = this.availableSamples;
		this.availableSamples = 0;
		return samples;
	}

	public scheduleNext(nowCycles: number): void {
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
}
