import {
	IO_APU_TRANSFER_ADDRESS,
	IO_APU_TRANSFER_CONTROL,
	IO_APU_TRANSFER_DATA,
} from '../../../spec/bmsx/io';
import {
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_BLOCK_END,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { Memory } from '../../memory/memory';
import { accrueBudgetUnits, cyclesUntilBudgetUnits, type BudgetAccrual } from '../../scheduler/budget';
import { DEVICE_SERVICE_APU, type DeviceScheduler } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import type { ApuActiveSlots } from './active_slots';
import type { ApuCommandFifo } from './command_fifo';
import { APU_SAMPLE_RATE_HZ } from '../../../spec/audio/apu';
import { ApuOutputMixer } from './output';
import type { ApuSampleMemory } from './sample_memory';
import type { ApuSampleTransferState } from './save_state';
import { ApuSampleTransfer } from './sample_transfer';

export class ApuServiceClock {
	private cpuHz = APU_SAMPLE_RATE_HZ;
	private sampleCarry = 0;
	private sampleSequence = 0;
	private lastCycle = 0;
	private voiceClockHeld = false;
	private readonly budgetAccrual: BudgetAccrual = { wholeUnits: 0, carry: 0 };
	private readonly sampleTransfer: ApuSampleTransfer;

	public constructor(
		memory: Memory,
		sampleMemory: ApuSampleMemory,
		private readonly dma: DmaController,
		private readonly scheduler: DeviceScheduler,
		private readonly commandFifo: ApuCommandFifo,
		private readonly activeSlots: ApuActiveSlots,
		private readonly audioOutput: ApuOutputMixer,
	) {
		this.sampleTransfer = new ApuSampleTransfer(memory, sampleMemory, dma, scheduler);
		memory.mapIoWrite(IO_APU_TRANSFER_ADDRESS, this, ApuServiceClock.transferAddressWriteThunk);
		memory.mapIoRead(IO_APU_TRANSFER_DATA, this, ApuServiceClock.transferDataReadThunk);
		memory.mapIoWrite(IO_APU_TRANSFER_DATA, this, ApuServiceClock.transferDataWriteThunk);
		memory.mapIoWriteReady(IO_APU_TRANSFER_DATA, ApuServiceClock.transferDataWriteReadyThunk);
		memory.mapIoWrite(IO_APU_TRANSFER_CONTROL, this, ApuServiceClock.transferControlWriteThunk);
	}

	public reset(nowCycles: number): void {
		this.sampleTransfer.reset();
		this.sampleCarry = 0;
		this.sampleSequence = 0;
		this.lastCycle = nowCycles;
		this.voiceClockHeld = false;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	}

	public dispose(): void {
		this.sampleTransfer.dispose();
		this.sampleCarry = 0;
		this.sampleSequence = 0;
		this.lastCycle = this.scheduler.currentNowCycles();
		this.voiceClockHeld = false;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
	}

	public captureSampleCarry(): number {
		return this.sampleCarry;
	}

	public captureSampleSequence(): number {
		return this.sampleSequence;
	}

	public sampleTransferStatusBits(): number {
		return this.sampleTransfer.statusBits();
	}

	public captureSampleTransferState(nowCycles: number): ApuSampleTransferState {
		return this.sampleTransfer.captureState(nowCycles);
	}

	public restore(sampleCarry: number, sampleSequence: number, sampleTransferState: ApuSampleTransferState, nowCycles: number): void {
		this.sampleCarry = sampleCarry;
		this.sampleSequence = sampleSequence;
		this.lastCycle = nowCycles;
		this.voiceClockHeld = false;
		this.sampleTransfer.restoreState(sampleTransferState, nowCycles);
	}

	public setVoiceClockHeld(held: boolean, nowCycles: number): void {
		if (this.voiceClockHeld === held) {
			return;
		}
		this.synchronize(nowCycles);
		this.voiceClockHeld = held;
		if (held) {
			this.audioOutput.outputRing.clear();
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
		} else {
			this.scheduleNext(nowCycles);
		}
	}

	public setCpuHz(cpuHz: number, nowCycles: number): void {
		this.synchronize(nowCycles);
		this.sampleTransfer.setTiming(cpuHz, nowCycles);
		this.cpuHz = cpuHz;
	}

	public synchronize(nowCycles: number): void {
		while (this.sampleTransfer.scheduledWords !== 0
			&& this.sampleTransfer.scheduledDeadline <= nowCycles) {
			const deadline = this.sampleTransfer.scheduledDeadline;
			this.advanceVoicesTo(deadline - 1);
			this.sampleTransfer.completeService();
			this.advanceVoicesTo(deadline);
		}
		this.advanceVoicesTo(nowCycles);
	}

	public scheduleNext(nowCycles: number): void {
		if (this.voiceClockHeld) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_APU);
			return;
		}
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

	private static transferAddressWriteThunk(context: ApuServiceClock, _addr: number, value: number): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.synchronizeBeforeTransferAccess(nowCycles);
		context.sampleTransfer.writeAddress(value);
		context.advanceVoicesTo(nowCycles);
	}

	private static transferDataReadThunk(context: ApuServiceClock, _addr: number, busSignals: MappedBusSignals): number {
		const nowCycles = context.scheduler.currentNowCycles();
		context.synchronizeBeforeTransferAccess(nowCycles);
		const value = (busSignals & MAPPED_BUS_MASTER_DMA) !== 0
			? context.sampleTransfer.readDmaData((busSignals & MAPPED_BUS_DMA_BLOCK_END) !== 0)
			: context.sampleTransfer.readCpuData();
		context.advanceVoicesTo(nowCycles);
		return value;
	}

	private static transferDataWriteThunk(context: ApuServiceClock, _addr: number, value: number, busSignals: MappedBusSignals): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.synchronizeBeforeTransferAccess(nowCycles);
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0) {
			context.sampleTransfer.writeDmaData(value, (busSignals & MAPPED_BUS_DMA_BLOCK_END) !== 0);
		} else {
			context.sampleTransfer.writeCpuData(value);
		}
		context.advanceVoicesTo(nowCycles);
	}

	private static transferDataWriteReadyThunk(
		context: ApuServiceClock,
		_addr: number,
		busSignals: MappedBusSignals,
	): boolean {
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0) {
			return true;
		}
		return !context.dma.ownsReadPort(IO_APU_TRANSFER_DATA)
			&& !context.dma.ownsWritePort(IO_APU_TRANSFER_DATA);
	}

	private static transferControlWriteThunk(context: ApuServiceClock, _addr: number, value: number): void {
		const nowCycles = context.scheduler.currentNowCycles();
		context.synchronizeBeforeTransferAccess(nowCycles);
		context.sampleTransfer.writeControl(value);
		context.advanceVoicesTo(nowCycles);
	}

	private synchronizeBeforeTransferAccess(nowCycles: number): void {
		while (this.sampleTransfer.scheduledWords !== 0
			&& this.sampleTransfer.scheduledDeadline < nowCycles) {
			const deadline = this.sampleTransfer.scheduledDeadline;
			this.advanceVoicesTo(deadline - 1);
			this.sampleTransfer.completeService();
			this.advanceVoicesTo(deadline);
		}
		this.advanceVoicesTo(nowCycles - 1);
		while (this.sampleTransfer.scheduledWords !== 0
			&& this.sampleTransfer.scheduledDeadline <= nowCycles) {
			this.sampleTransfer.completeService();
		}
	}

	private advanceVoicesTo(cycle: number): void {
		if (cycle <= this.lastCycle) {
			return;
		}
		const cycles = cycle - this.lastCycle;
		this.lastCycle = cycle;
		if (this.voiceClockHeld) {
			return;
		}
		accrueBudgetUnits(this.budgetAccrual, this.cpuHz, APU_SAMPLE_RATE_HZ, this.sampleCarry, cycles);
		this.sampleCarry = this.budgetAccrual.carry;
		if (this.budgetAccrual.wholeUnits !== 0) {
			this.activeSlots.advance(this.budgetAccrual.wholeUnits, this.sampleSequence);
			this.sampleSequence += this.budgetAccrual.wholeUnits;
		}
	}
}
