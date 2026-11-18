/** Optional host-only GC measurements. Never captured, restored or used for pacing. */
export type GcTimingPhase = 'rootsNanoseconds' | 'traceNanoseconds' | 'markAgainNanoseconds'
	| 'weakNanoseconds' | 'sweepNanoseconds' | 'stringReclaimNanoseconds';

export class GcDiagnostics {
	public collections = 0;
	public fullCollections = 0;
	public steps = 0;
	public totalNanoseconds = 0;
	public rootsNanoseconds = 0;
	public traceNanoseconds = 0;
	public markAgainNanoseconds = 0;
	public weakNanoseconds = 0;
	public sweepNanoseconds = 0;
	public stringReclaimNanoseconds = 0;
	/** Enclosing atomic interval; overlaps its roots, trace and weak measurements. */
	public atomicNanoseconds = 0;
	/** Lifetime maximum, not a counter to subtract across snapshots. */
	public maxStepNanoseconds = 0;
	public stepsOver2ms = 0;
	public stepsOver8ms = 0;
	private stepStart = 0;
	private phaseStart = 0;
	private atomicStart = 0;
	private inAtomic = false;
	private currentPhase: GcTimingPhase | null = null;

	public constructor(private readonly clock = () => performance.now() * 1e6) {}

	public beginStep(): void {
		++this.steps;
		this.stepStart = this.clock();
		this.currentPhase = null;
		this.inAtomic = false;
	}
	public phase(phase: GcTimingPhase): void {
		const now = this.clock();
		if (this.currentPhase !== null) this[this.currentPhase] += now - this.phaseStart;
		this.currentPhase = phase;
		this.phaseStart = now;
	}
	public beginAtomic(): void { this.atomicStart = this.clock(); this.inAtomic = true; }
	public endStep(): void {
		const now = this.clock();
		if (this.currentPhase !== null) this[this.currentPhase] += now - this.phaseStart;
		if (this.inAtomic) this.atomicNanoseconds += now - this.atomicStart;
		const elapsed = now - this.stepStart;
		this.totalNanoseconds += elapsed;
		this.maxStepNanoseconds = Math.max(this.maxStepNanoseconds, elapsed);
		if (elapsed > 2e6) ++this.stepsOver2ms;
		if (elapsed > 8e6) ++this.stepsOver8ms;
	}
}
