import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { formatNumber } from '../../../../machine/ts/common/number_format';
import type { RuntimeGuestCallExecutor } from '../../../runtime/guest_call';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { WorkbenchSlider } from '../../ui/slider';
import type { ActorNode } from './runtime';
import type { ResourceDomain } from '../../../common/resource';

/** Latest requested seek, not a playback clock or a queue of mouse samples. */
export class ActorTimelineTransport {
	public readonly slider = new WorkbenchSlider();
	public label = '';
	public positionLabel = '';
	public durationLabel = '';
	public entryHashId = 0;
	public labelRevision = 0;
	private programHashId = 0;
	private position = 0;
	private duration: number | null = null;
	private pending: number | undefined;
	private inFlight = false;
	private generation = 0;

	public get visible(): boolean { return this.entryHashId !== 0; }
	public cancelPending(): void { this.pending = undefined; }
	public clear(): void {
		this.generation += 1;
		this.entryHashId = 0; this.programHashId = 0;
		this.pending = undefined; this.inFlight = false; this.slider.enabled = false;
	}
	public request(time: number): void { this.pending = time; }

	/** Borrow fresh instances after each CPU slice. No guest tables survive in this state. */
	public refresh(node: ActorNode | undefined, running: boolean, guest: SuspendedGuestSession,
		readback: boolean, canInteract: boolean): void {
		if (node === undefined || node.kind !== 'timeline') {
			if (this.visible) this.clear();
			return;
		}
		if (readback || this.entryHashId !== node.hashId) {
			const entry = node.value!;
			const program = guest.readStringMember(entry, 'program') as Table;
			const changed = this.entryHashId !== node.hashId || this.programHashId !== program.hashId;
			if (changed) {
				this.clear();
				this.entryHashId = node.hashId; this.programHashId = program.hashId; this.label = `SCRUB ${node.label}`;
				this.labelRevision += 1;
			}
			const duration = guest.readStringMember(program, 'duration_ms') as number | null;
			if (duration === null) {
				// Parameterized frame builders acquire their duration when played.
				if (this.duration !== null || changed) this.labelRevision += 1;
				this.slider.enabled = false; this.duration = duration; this.positionLabel = 'PLAY TO BUILD FRAMES'; this.durationLabel = '';
			} else {
				const position = guest.readStringMember(entry, 'position_ms') as number;
				if (changed || this.position !== position || this.duration === null) {
					this.position = position; this.positionLabel = `${formatNumber(position)} MS`;
					this.labelRevision += 1;
				}
				if (changed || this.duration !== duration) {
					this.duration = duration; this.durationLabel = `${formatNumber(duration)} MS`;
					this.labelRevision += 1;
					this.slider.setRange(0, duration, 1);
				}
			}
		}
		this.slider.enabled = this.duration !== null && !running && (canInteract || this.inFlight);
		if (running || this.duration === null) this.cancelPending();
		if (this.pending === undefined && !this.inFlight) this.slider.value = this.position;
	}

	/** Admit only after target refresh and control/layout cancellation for this frame. */
	public executePending(node: ActorNode | undefined, domain: ResourceDomain, guest: SuspendedGuestSession,
		canExecute: boolean, execute: RuntimeGuestCallExecutor): void {
		if (this.pending === undefined || this.inFlight || !canExecute) return;
		const time = this.pending;
		const generation = this.generation;
		this.pending = undefined; this.inFlight = true;
		execute(() => {
			if (this.generation !== generation) return;
			const receiver = node!.receiver;
			if (receiver === null) return;
			const program = guest.readStringMember(node!.value!, 'program') as Table;
			if (program.hashId !== this.programHashId) return;
			const key = node!.key;
			return { domain, closure: guest.readStringMember(receiver, 'scrub_time') as Closure, args: () => [receiver, key, time] };
		}, completed => {
			if (this.generation !== generation) return;
			this.inFlight = false;
			if (!completed) this.cancelPending();
		});
	}
}
