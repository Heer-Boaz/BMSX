import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueToString, type Value } from '../../../../machine/ts/machine/cpu/value';
import { RetainedSequence } from '../../../common/retained_sequence';
import type { FixtureOutput } from '../../../testing/fixture_operations';
import { FsmTransitionObservation } from '../../../testing/observations/fsm_transition';
import { ActionEffectObservation, type ActionEffectActivityKind, type ActionEffectTriggerOutcome } from '../../../testing/observations/actioneffect';

export type PlayFsmFact = { sequence: number; millisecondsWord: number; tick: number; lane: string;
	previous: string; target: string; outcome: 'committed' | 'rejected' };
export type PlayEffectFact = { sequence: number; millisecondsWord: number; tick: number; effect: string }
	& ({ kind: 'trigger'; outcome: ActionEffectTriggerOutcome } | { kind: ActionEffectActivityKind; count: number });
export type PlayCapture = { readonly label: string; readonly requestedTick: number; sequence: number | undefined };

/** Bounded interactive evidence, not assertions or an automatic test result. */
export class PlayEvidence implements FixtureOutput {
	public readonly logs = new RetainedSequence<{ tick: number; text: string }>(512);
	public readonly captures = new RetainedSequence<PlayCapture>(64);
	public fsmTrace: { instance: string; machine: string; facts: RetainedSequence<PlayFsmFact> } | undefined;
	public effectTrace: { owner: string; definition: string; facts: RetainedSequence<PlayEffectFact> } | undefined;
	public epoch = 0;
	public revision = 0;
	private fsm: FsmTransitionObservation | undefined;
	private effects: ActionEffectObservation | undefined;
	private capture: PlayCapture | undefined;
	private restored = false;
	public constructor(private readonly runtime: Runtime, private readonly readContext: () => Table) {}
	public get droppedFsmFacts(): number { return this.fsm === undefined ? 0 : this.fsm.droppedCount; }
	public get droppedEffectFacts(): number { return this.effects === undefined ? 0 : this.effects.droppedCount; }
	public log(tick: number, value: Value): void {
		this.logs.push({ tick, text: valueToString(value, this.runtime.machine.cpu.stringPool) }); this.revision++;
	}
	public captureRequested(tick: number, label: string): void {
		this.capture = { label, requestedTick: tick, sequence: undefined };
		this.captures.push(this.capture); this.revision++;
	}
	public captured(sequence: number): void { this.capture!.sequence = sequence; this.capture = undefined; this.revision++; }
	public observeFsm(channel: Table): void {
		this.fsm = new FsmTransitionObservation(channel, this.runtime.machine.cpu.stringPool,
			(sequence, millisecondsWord, tick, lane, previous, target, outcome) => {
				this.fsmTrace!.facts.push({ sequence, millisecondsWord, tick, lane, previous, target, outcome }); this.revision++;
			}, 'rolling');
		this.fsmTrace = { instance: this.fsm.instanceId, machine: this.fsm.machineId, facts: new RetainedSequence(1024) };
		this.revision++;
	}
	public observeActionEffects(channel: Table): void {
		this.effects = new ActionEffectObservation(channel, this.runtime.machine.cpu.stringPool, {
			trigger: (sequence, millisecondsWord, tick, effect, outcome) => {
				this.effectTrace!.facts.push({ sequence, millisecondsWord, tick, effect, kind: 'trigger', outcome }); this.revision++;
			},
			activity: (sequence, millisecondsWord, tick, effect, kind, count) => {
				this.effectTrace!.facts.push({ sequence, millisecondsWord, tick, effect, kind, count }); this.revision++;
			},
		}, 'rolling');
		this.effectTrace = { owner: this.effects.ownerId, definition: this.effects.definitionId, facts: new RetainedSequence(1024) };
		this.revision++;
	}
	/** Replay cannot retain recorder tables or append historical work to the live evidence epoch. */
	public didRestore(): void {
		this.dispose(); this.restored = true; this.fsmTrace = undefined; this.effectTrace = undefined;
		this.epoch++; this.revision++;
	}
	public drain(): void {
		if (this.restored) {
			const pool = this.runtime.machine.cpu.stringPool, context = this.readContext();
			const fsm = context.getStringKey(pool.find('fsm_recorder')!);
			const effects = context.getStringKey(pool.find('actioneffect_recorder')!);
			if (fsm !== null) { this.observeFsm(fsm as Table); this.fsm!.discardPublished(); }
			if (effects !== null) { this.observeActionEffects(effects as Table); this.effects!.discardPublished(); }
			this.restored = false;
		}
		const tick = this.runtime.frameScheduler.lastTickSequence;
		this.fsm?.drain(tick); this.effects?.drain(tick);
	}
	public dispose(): void { this.fsm = undefined; this.effects = undefined; }
}
