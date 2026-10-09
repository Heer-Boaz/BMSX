import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import type { FixtureTarget } from './target';
import type { TestInput } from './input';

export interface FixtureOutput {
	log(tick: number, value: Value): void;
	captureRequested(tick: number, label: string): void;
	captured(sequence: number, label: string): void;
	observeFsm(recorder: Table): void;
	observeActionEffects(recorder: Table): void;
}

type FixtureWait =
	| { kind: 'ticks'; target: number }
	| { kind: 'input'; target: number }
	| { kind: 'boundary'; receipt: Table; deadline: number }
	| { kind: 'capture'; tick: number; label: string };

/** Transport for compiled context yields, independent of case outcomes or play lifetime. */
export class FixtureOperations {
	private wait: FixtureWait | null = null;
	private readonly reachedKey;
	public constructor(private readonly target: FixtureTarget, private readonly input: TestInput, private readonly output: FixtureOutput,
		private readonly bindingChanged: () => void) {
		this.reachedKey = target.runtime.machine.cpu.stringPool.intern('reached');
	}
	public get waiting(): boolean { return this.wait !== null; }
	public get observesPublication(): boolean { return this.wait?.kind === 'boundary'; }
	public shouldStopAtPublication(): boolean {
		return this.wait?.kind === 'boundary' && this.wait.receipt.getStringKey(this.reachedKey) === true;
	}

	/** The compiled context owns this protocol. Unknown operations are errors, not no-ops. */
	public accept(values: readonly Value[]): string | undefined {
		const runtime = this.target.runtime, pool = runtime.machine.cpu.stringPool;
		const operation = pool.toString(asStringId(values[1] as StringValue));
		const tick = runtime.frameScheduler.lastTickSequence;
		switch (operation) {
			case 'fsm': this.output.observeFsm(values[2] as Table); break;
			case 'actioneffects': this.output.observeActionEffects(values[2] as Table); break;
			case 'log': this.output.log(tick, values[2]); break;
			case 'ticks': this.wait = { kind: 'ticks', target: tick + (values[2] as number) }; break;
			case 'key': this.wait = { kind: 'input', target: this.input.key(pool.toString(asStringId(values[2] as StringValue)), values[3] as boolean, values[4] as number | null) }; break;
			case 'press': this.wait = { kind: 'input', target: this.input.press(pool.toString(asStringId(values[2] as StringValue)), values[3] as number, values[4] as number | null) }; break;
			case 'boundary':
				this.wait = { kind: 'boundary', receipt: values[2] as Table, deadline: tick + (values[3] as number) };
				this.bindingChanged();
				break;
			case 'capture': {
				const label = pool.toString(asStringId(values[2] as StringValue));
				this.wait = { kind: 'capture', tick, label };
				this.output.captureRequested(tick, label);
				break;
			}
			default: return operation;
		}
		return undefined;
	}

	/** Replies are real receipt/input/presentation completions; no elapsed-host-time simulation. */
	public advance(args: Value[], cycles: number): boolean {
		const runtime = this.target.runtime, wait = this.wait!;
		let ready: boolean;
		switch (wait.kind) {
			case 'ticks': ready = runtime.frameScheduler.lastTickSequence >= wait.target; break;
			case 'input': ready = this.input.samples >= wait.target; break;
			case 'boundary':
				ready = wait.receipt.getStringKey(this.reachedKey) === true || runtime.frameScheduler.lastTickSequence >= wait.deadline;
				if (ready) args[1] = wait.receipt.getStringKey(this.reachedKey);
				break;
			case 'capture':
				ready = runtime.frameScheduler.lastTickSequence > wait.tick && this.target.present();
				if (ready) {
					const sequence = this.target.presenter.presentationSequence;
					this.output.captured(sequence, wait.label);
					args[1] = sequence;
				}
				break;
		}
		if (ready) this.cancel();
		else this.target.advanceGame(cycles);
		return ready;
	}

	public cancel(): void {
		const publication = this.observesPublication;
		this.wait = null;
		if (publication) this.bindingChanged();
	}
}
