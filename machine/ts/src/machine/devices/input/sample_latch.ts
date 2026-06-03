export type InputControllerSampleLatchState = {
	sampleArmed: boolean;
	sampleSequence: number;
	lastSampleCycle: number;
};

export class InputControllerSampleLatch {
	private sampleArmed = false;
	private sampleSequence = 0;
	private lastSampleCycle = 0;

	public reset(): void {
		this.sampleArmed = false;
		this.sampleSequence = 0;
		this.lastSampleCycle = 0;
	}

	public arm(): void {
		this.sampleArmed = true;
	}

	public cancel(): boolean {
		const wasArmed = this.sampleArmed;
		this.sampleArmed = false;
		return wasArmed;
	}

	public consumeVblankEdge(nowCycles: number): boolean {
		if (!this.sampleArmed) {
			return false;
		}
		this.sampleSequence = (this.sampleSequence + 1) >>> 0;
		this.lastSampleCycle = nowCycles >>> 0;
		this.sampleArmed = false;
		return true;
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
