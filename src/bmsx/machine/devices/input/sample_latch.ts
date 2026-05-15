import { Input } from '../../../input/manager';
import { InputControllerActionTable } from './action_table';
import { InputControllerEventFifo } from './event_fifo';

export type InputControllerSampleLatchState = {
	sampleArmed: boolean;
	sampleSequence: number;
	lastSampleCycle: number;
};

export class InputControllerSampleLatch {
	private sampleArmed = false;
	private sampleSequence = 0;
	private lastSampleCycle = 0;

	public constructor(
		private readonly input: Input,
		private readonly actionTable: InputControllerActionTable,
		private readonly eventFifo: InputControllerEventFifo,
	) {}

	public reset(): void {
		this.sampleArmed = false;
		this.sampleSequence = 0;
		this.lastSampleCycle = 0;
	}

	public arm(): void {
		this.sampleArmed = true;
	}

	public cancel(): void {
		this.sampleArmed = false;
	}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleArmed) {
			return;
		}
		this.sampleSequence = (this.sampleSequence + 1) >>> 0;
		this.lastSampleCycle = nowCycles >>> 0;
		this.input.samplePlayers(currentTimeMs);
		this.actionTable.sampleCommittedActions(this.eventFifo);
		this.sampleArmed = false;
	}

	public captureState(): InputControllerSampleLatchState {
		return {
			sampleArmed: this.sampleArmed,
			sampleSequence: this.sampleSequence,
			lastSampleCycle: this.lastSampleCycle,
		};
	}

	public restoreState(state: InputControllerSampleLatchState): void {
		this.sampleArmed = state.sampleArmed;
		this.sampleSequence = state.sampleSequence;
		this.lastSampleCycle = state.lastSampleCycle;
	}
}
