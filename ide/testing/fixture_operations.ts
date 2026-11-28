import { StockStringIndex } from '../../toolchain/ts/firmware/stock_string_index';
import { asFloat, asInteger, asStringId, isNil, isTruthy, valueInteger, valueIsInteger, type Value, valuePayload } from '../../machine/ts/machine/cpu/value';
import type { FixtureTarget } from './target';
import type { TestInput } from './input';

export interface FixtureOutput {
	log(tick: number, value: Value): void;
	captureRequested(tick: number, label: string): void;
	captured(sequence: number, label: string): void;
	observeFsm(recorder: number): void;
	observeActionEffects(recorder: number): void;
}

type FixtureWait =
	| { kind: 'ticks'; target: number }
	| { kind: 'input'; target: number }
	| { kind: 'boundary'; receipt: number; deadline: number }
	| { kind: 'capture'; tick: number; label: string };

/** Transport for compiled context yields, independent of case outcomes or play lifetime. */
export class FixtureOperations {
	private wait: FixtureWait | null = null;
	private readonly stringIndex: StockStringIndex;
	public constructor(private readonly target: FixtureTarget, private readonly input: TestInput, private readonly output: FixtureOutput,
		private readonly bindingChanged: () => void) {
		this.stringIndex = new StockStringIndex(target.runtime.machine.memory);
	}
	public get waiting(): boolean { return this.wait !== null; }
	public get observesPublication(): boolean { return this.wait?.kind === 'boundary'; }
	public shouldStopAtPublication(): boolean {
		return this.wait?.kind === 'boundary'
			&& isTruthy(this.target.runtime.machine.cpu.tables.getStringKey(this.wait.receipt, this.stringIndex.find('reached')!));
	}

	/** The compiled context owns this protocol. Unknown operations are errors, not no-ops. */
	public accept(values: readonly Value[]): string | undefined {
		const runtime = this.target.runtime, cpu = runtime.machine.cpu, pool = cpu.stringPool;
		const operation = pool.toString(asStringId(values[1]));
		const tick = runtime.frameScheduler.lastTickSequence;
		switch (operation) {
			case 'fsm': this.output.observeFsm(valuePayload(values[2])); break;
			case 'actioneffects': this.output.observeActionEffects(valuePayload(values[2])); break;
			case 'log': this.output.log(tick, values[2]); break;
			case 'ticks': this.wait = { kind: 'ticks', target: tick + (valueIsInteger(values[2]) ? asInteger(values[2]) : asFloat(values[2])) }; break;
			case 'key': {
				const pad = values[4];
				this.wait = { kind: 'input', target: this.input.key(pool.toString(asStringId(values[2])), isTruthy(values[3]),
					isNil(pad) ? null : valueIsInteger(pad) ? asInteger(pad) : asFloat(pad)) };
				break;
			}
			case 'press': {
				const samples = values[3], pad = values[4];
				this.wait = { kind: 'input', target: this.input.press(pool.toString(asStringId(values[2])),
					valueIsInteger(samples) ? asInteger(samples) : asFloat(samples),
					isNil(pad) ? null : valueIsInteger(pad) ? asInteger(pad) : asFloat(pad)) };
				break;
			}
			case 'boundary':
				this.wait = { kind: 'boundary', receipt: valuePayload(values[2]), deadline: tick + (valueIsInteger(values[3]) ? asInteger(values[3]) : asFloat(values[3])) };
				this.bindingChanged();
				break;
			case 'capture': {
				const label = pool.toString(asStringId(values[2]));
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
			case 'boundary': {
				const reached = runtime.machine.cpu.tables.getStringKey(wait.receipt, this.stringIndex.find('reached')!);
				ready = isTruthy(reached) || runtime.frameScheduler.lastTickSequence >= wait.deadline;
				if (ready) args[1] = reached;
				break;
			}
			case 'capture':
				ready = runtime.frameScheduler.lastTickSequence > wait.tick && this.target.present();
				if (ready) {
					const sequence = this.target.presenter.presentationSequence;
					this.output.captured(sequence, wait.label);
					args[1] = valueInteger(sequence);
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
