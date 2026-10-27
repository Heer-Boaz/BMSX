import type { ResourceDomain } from '../../../common/resource';
import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { HostRewind } from '../../../../hosts/common/rewind';
import type { RuntimeSourceState, RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { ActorLabEditorPane } from './editor_pane';
import type { ActorLabTabId } from '../../ui/tab/id';
import type { ActorLabViewport } from './viewport';
import type { EditorNavigationController } from '../resources/navigation';
import { ActorDetails, captureActorDetailsSelection, type ActorDetailsProperty } from './details';
import type { ActorPropertyWatch } from './watches';
import { ActorLabInput } from './editor_input';
import { runtimeWorld, type ActorNode } from './runtime';
import { ActorStateGraph } from './state_graph';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { ActorProjection } from './projection';
import { actorTargetsEqual, captureActorTarget, resolveActorTarget, type ActorTarget } from './target';
import type { ActorExecutionService } from './execution';
import { ActorLabNavigationSelection } from './navigation_selection';
import { ActorViewportPicker } from './viewport_pick';

/** Actor Lab interaction and presentation; the shared domain service owns execution. */
export class ActorLabController {
	private current: ActorLabInput | undefined;
	public projection: ActorProjection;
	private navigationGeneration = 0;
	private readonly unbindGuest: () => void;
	private readonly unbindReview: () => void;
	public readonly viewportPicker: ActorViewportPicker;
	public readonly canInteract = (domain?: ResourceDomain) => domain === undefined ? this.execution.canExecute : this.execution.canExecuteIn(domain);
	public constructor(
		public readonly sources: RuntimeInstalledSourceState,
		public readonly guest: SuspendedGuestSession,
		public readonly cpu: CPU,
		private readonly parts: EditorParts,
		public readonly navigation: EditorNavigationController,
		public readonly execution: ActorExecutionService,
		public readonly rewind: HostRewind,
		public readonly authoringSources: RuntimeSourceState,
		public readonly viewport: ActorLabViewport,
		private readonly inputId: ActorLabTabId = 'actor-lab', private readonly title = 'ACTOR LAB',
	) {
		this.viewportPicker = new ActorViewportPicker(sources, guest);
		this.unbindGuest = guest.onDidInvalidate(reason => {
			this.viewportPicker.invalidate(reason);
			if (reason === 'heap-replaced') this.navigationGeneration++;
			const input = this.current;
			if (input === undefined) return;
			input.invalidate(reason);
		});
		this.unbindReview = guest.onWillEndHistoryReview(() => {
			this.navigationGeneration++;
			const input = this.current;
			if (input !== undefined) {
				// Admission observes the physical position even after an interrupted seek.
				this.projection.resumeHistory();
				input.details!.resumeHistory(input.runtime, input.domain, input.worldHashId);
				input.dirty = false;
			}
		});
	}
	public dispose(): void {
		this.unbindGuest(); this.unbindReview();
		if (this.current !== undefined) {
			const group = this.parts.findGroup(this.current);
			if (group !== undefined) group.removeEditor(this.current);
			else this.current.dispose();
		}
	}

	public resolveInput(): ActorLabInput {
		if (this.current === undefined) {
			const input = new ActorLabInput(this, this.inputId, this.title, this.inputId === 'actor-lab');
			input.details = new ActorDetails(this.sources, this.guest);
			this.projection = new ActorProjection(input, this.sources, this.guest);
			input.onWillDispose(() => { this.current = undefined; });
			this.current = input;
		}
		return this.current;
	}
	public open(destination: EditorGroupView): void {
		const input = this.resolveInput();
		if (!this.parts.revealEditor(input, destination)) return;
		if (input.actorHashId === 0) (this.parts.findGroup(input)!.panes.activePane as ActorLabEditorPane).actorActions.selectActor(input);
	}
	public auditionEvent(destination: EditorGroupView, domain: ResourceDomain, name: string): void {
		const input = this.resolveInput();
		if (!this.parts.revealEditor(input, destination)) return;
		const actions = (this.parts.findGroup(input)!.panes.activePane as ActorLabEditorPane).actorActions;
		input.interaction.running = false;
		if (input.domain === domain) this.refresh(input);
		if (input.domain !== domain || input.actorHashId === 0) actions.selectActor(input, () => { this.refresh(input); actions.emitEvent(input, name); }, domain);
		else actions.emitEvent(input, name);
	}
	public testEffect(destination: EditorGroupView, domain: ResourceDomain): void {
		const input = this.resolveInput();
		if (!this.parts.revealEditor(input, destination)) return;
		(this.parts.findGroup(input)!.panes.activePane as ActorLabEditorPane).actorActions.testEffect(input, domain);
	}
	public refresh(input: ActorLabInput): boolean {
		// Read the requested history position, not an intermediate replay checkpoint.
		if (this.rewind.seeking) return false;
		let changed = false;
		if (input.dirty) {
			changed = this.projection.update(); input.dirty = false;
		}
		if (input.presentation === 'outline' && input.actorPresent && input.follow.pending !== undefined) {
			const scope = resolveActorTarget(input.runtime.roots, input.follow.pending, this.guest);
			if (scope !== undefined) changed = this.projection.revealActive(scope) || changed;
			input.follow.pending = undefined;
		}
		return changed;
	}

	public layoutNavigation(input: ActorLabInput): void {
		if (input.dirty || !input.actorPresent) return;
		if (input.presentation === 'outline') this.projection.layout();
		else if (input.follow.pending !== undefined) {
			input.stateGraph!.revealActive(input.follow.pending);
			input.follow.pending = undefined;
		}
	}

	public captureSelection(input: ActorLabInput): ActorLabNavigationSelection {
		const world = input.actorHashId === 0 ? undefined : runtimeWorld(this.sources, this.guest, input.domain);
		return new ActorLabNavigationSelection(input, world?.hashId, this.navigationGeneration);
	}

	public restoreSelection(input: ActorLabInput, selection: ActorLabNavigationSelection, font: BFont): void {
		input.interaction.running = false;
		input.timeline.clear();
		input.follow.stop();
		const previousGraph = input.stateGraph;
		input.stateGraph = undefined;
		input.presentation = 'outline';
		input.selectionPath = undefined;
		input.outline.selectionIndex = -1;
		const target = selection.target;
		const world = target === undefined || selection.generation !== this.navigationGeneration ? undefined : runtimeWorld(this.sources, this.guest, target.domain);
		const available = world !== undefined && world.hashId === target!.worldHashId;
		input.actorHashId = available ? target!.actorHashId : 0;
		if (target !== undefined) input.domain = target.domain;
		input.dirty = true;
		this.refresh(input);
		if (available && input.actorPresent) {
			const node = resolveActorTarget(input.runtime.roots, target!, this.guest);
			if (node !== undefined) this.projection.reveal(node);
			else { input.outline.selectionIndex = -1; input.selectionPath = target!.path.length === 0 ? undefined : target!.path; }
			if (selection.graph !== undefined) {
				const graph = previousGraph?.matchesTarget(selection.graph.target) ? previousGraph : new ActorStateGraph(selection.graph.target, font);
				graph.refresh(input.runtime.roots, this.guest);
				graph.layout(font);
				graph.restoreSelection(target!.path.length === 0 ? undefined : target, selection.graph.kind);
				input.stateGraph = graph;
				input.presentation = 'graph';
			}
			if (selection.follow !== undefined) input.follow.start(selection.follow);
		}
		selection.restoreDetails(input, selection.generation === this.navigationGeneration);
		if (!input.dirty) input.details!.resolveSubject(input.runtime, input.domain, input.worldHashId, input.historical);
	}

	public activityScope(input: ActorLabInput): ActorTarget | undefined {
		const selected = this.selected(input);
		if (selected === undefined) return;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, selected, this.guest);
		let length = target.path.length;
		if (selected.kind === 'state') while (target.path[length - 1].kind !== 'machine') length--;
		else if (selected.kind === 'timeline' || selected.kind === 'effect') length--;
		return length === target.path.length ? target : { ...target, path: target.path.slice(0, length) };
	}

	public inspectActor(input: ActorLabInput, domain: ResourceDomain, hashId: number): void {
		input.interaction.running = false; input.timeline.clear();
		input.stateGraph = undefined; input.presentation = 'outline'; input.follow.stop(); input.historical = this.rewind.active;
		input.domain = domain; input.actorHashId = hashId; input.selectionPath = undefined; input.dirty = true;
		this.refresh(input); this.projection.reveal(input.runtime.roots[0]);
	}
	public selected(input: ActorLabInput): ActorNode | undefined {
		if (input.dirty || !input.actorPresent) return undefined;
		if (input.presentation === 'outline') return input.outline.rows[input.outline.selectionIndex]?.element.node;
		const target = input.stateGraph!.selectedTarget;
		return target === undefined ? undefined : resolveActorTarget(input.runtime.roots, target, this.guest);
	}

	public openStateGraph(input: ActorLabInput, font: BFont): boolean {
		const selected = this.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, selected, this.guest);
		let length = target.path.length;
		while (target.path[length - 1].kind !== 'machine') length--;
		const machineTarget = { ...target, path: target.path.slice(0, length) };
		if (input.stateGraph === undefined || !input.stateGraph.matchesTarget(machineTarget)) input.stateGraph = new ActorStateGraph(machineTarget, font);
		input.stateGraph.refresh(input.runtime.roots, this.guest);
		input.stateGraph.layout(font);
		const previous = input.stateGraph.selectedTarget;
		input.stateGraph.selectTarget(target);
		input.presentation = 'graph';
		input.follow.pending = input.follow.target;
		return previous === undefined || !actorTargetsEqual(previous, target);
	}

	public openOutline(input: ActorLabInput): void {
		const target = input.stateGraph!.selectedTarget;
		input.presentation = 'outline';
		if (target !== undefined) {
			const selected = resolveActorTarget(input.runtime.roots, target, this.guest);
			if (selected !== undefined) this.projection.reveal(selected);
		} else if (input.stateGraph!.status === 'available') {
			input.outline.selectionIndex = -1;
			input.rememberSelection();
		}
		input.follow.pending = input.follow.target;
	}

	public refreshDetails(input: ActorLabInput): readonly ActorDetailsProperty[] | undefined {
		if (input.dirty || this.rewind.seeking) return;
		this.followDetailsSelection(input);
		return input.details!.refreshSubject(input.runtime, input.domain, input.worldHashId, input.historical);
	}

	/** Hidden Details retain selection without formatting a property client. */
	public followDetailsSelection(input: ActorLabInput): void {
		if (input.dirty || this.rewind.seeking) return;
		input.details!.followSelection(input.domain, input.worldHashId, input.actorHashId, input.presentation === 'outline'
			? input.selectionPath : input.stateGraph!.selectionBookmark?.path, input.runtime);
	}

	public setDetailsLocked(input: ActorLabInput, locked: boolean): void {
		input.details!.setLocked(locked);
		if (!locked) this.followDetailsSelection(input);
	}

	/** Resolve either a pinned row or its original property without display-label matching. */
	private selectedPropertyWatch(input: ActorLabInput, item: ActorDetailsProperty): ActorPropertyWatch | undefined {
		if (item.watch !== undefined) return item.watch;
		if (item.watchIdentity === undefined) return;
		const details = input.details!;
		return details.subject === undefined ? undefined : details.watches.find(details.subject, item.watchIdentity);
	}

	public canPinProperty(input: ActorLabInput, item: ActorDetailsProperty): boolean {
		return !this.rewind.seeking && item.watch === undefined && item.watchIdentity !== undefined
			&& !input.dirty && input.details!.available && this.selectedPropertyWatch(input, item) === undefined;
	}
	public pinProperty(input: ActorLabInput, item: ActorDetailsProperty): void {
		const details = input.details!;
		const watch = details.watches.add(details.subject!, details.subjectPath, item);
		input.detailsSelection = { kind: 'watch', id: watch.id };
	}
	public canUnpinProperty(input: ActorLabInput, item: ActorDetailsProperty): boolean {
		return this.selectedPropertyWatch(input, item) !== undefined;
	}
	public unpinProperty(input: ActorLabInput, item: ActorDetailsProperty): void {
		input.details!.watches.remove(this.selectedPropertyWatch(input, item)!);
		input.detailsSelection = item.watch === undefined ? captureActorDetailsSelection(item) : undefined;
	}
	public canRevealPinnedProperty(input: ActorLabInput, item: ActorDetailsProperty): boolean {
		return !input.dirty && !this.rewind.seeking && item.watch !== undefined && item.watch.available && !item.watch.retired;
	}
	public revealPinnedProperty(input: ActorLabInput, item: ActorDetailsProperty): void {
		const target = item.watch!.target;
		input.interaction.running = false;
		input.follow.stop(); input.stateGraph = undefined; input.presentation = 'outline';
		input.domain = target.domain; input.actorHashId = target.actorHashId;
		input.selectionPath = undefined; input.dirty = true;
		this.refresh(input);
		this.projection.reveal(resolveActorTarget(input.runtime.roots, target, this.guest)!);
		input.detailsSelection = { kind: 'property', identity: item.watch!.property };
	}

	public hasActions(input: ActorLabInput): boolean {
		const node = this.selected(input);
		return node !== undefined && (node.kind === 'actor' || node.kind === 'tree' || node.kind === 'timeline' || node.kind === 'effect'
			|| node.kind === 'state' && node.path !== undefined);
	}

}
