import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU, type DeviceScheduler } from '../../scheduler/device';
import type { ApuActiveSlots } from './active_slots';
import type { ApuCommandFifo } from './command_fifo';
import { APU_SAMPLE_RATE_HZ } from './contracts';
import { ApuOutputMixer } from './output';

export class ApuServiceClock {
	private cpuHz = APU_SAMPLE_RATE_HZ;
	private sampleCarry = 0;
	private lastCycle = 0;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };

	public constructor(
		private readonly scheduler: DeviceScheduler,
		private readonly commandFifo: ApuCommandFifo,
		private readonly activeSlots: ApuActiveSlots,
		private readonly audioOutput: ApuOutputMixer,
	) {}

	public reset(nowCycles: number): void {
		this.sampleCarry = 0;
		this.lastCycle = nowCycles;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	}

	public captureSampleCarry(): number {
		return this.sampleCarry;
	}

	public restore(sampleCarry: number, nowCycles: number): void {
		this.sampleCarry = sampleCarry;
		this.lastCycle = nowCycles;
	}

	public setCpuHz(cpuHz: number, nowCycles: number): void {
		this.synchronize(nowCycles);
		this.cpuHz = cpuHz;
	}

	public synchronize(nowCycles: number): void {
		const cycles = nowCycles - this.lastCycle;
		this.lastCycle = nowCycles;
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, cycles);
		this.sampleCarry = this.budgetAccrual.carry;
		if (this.budgetAccrual.wholeUnits !== 0) {
			this.activeSlots.advance(this.budgetAccrual.wholeUnits);
		}
	}

	public scheduleNext(nowCycles: number): void {
		if (!this.commandFifo.empty) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_APU, nowCycles);
			return;
		}
		const serviceFrames = this.audioOutput.samplesUntilNextEvent(ApuOutputMixer.MIX_BATCH_FRAMES);
		this.scheduler.scheduleDeviceService(
			DEVICE_SERVICE_APU,
			nowCycles + cyclesUntilBudgetUnits(this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, serviceFrames),
		);
	}
}
