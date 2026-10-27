import { readActionEffectInstances } from '../behavior_lens/action_effect_runtime';
import type { ResourceDomain } from '../../../common/resource';
import type { InputFocusTarget } from '../../../input/focus';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { HostRewind } from '../../../../hosts/common/rewind';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { prepareLuaArguments, prepareLuaLiteral } from '../../../runtime/lua_literal';
import type { RuntimeSourceState, RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../services/quick_input/provider';
import type { ActorLabTabId } from '../../ui/tab/id';
import type { ActorLabViewport } from './viewport';
import type { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { EditorNavigationController } from '../resources/navigation';
import { canOpenBehaviorInspectionSource } from '../behavior_lens/inspection_source';
import { ActorDetails, actorDetailsPropertyMatchesSelection, captureActorDetailsSelection, type ActorDetailsProperty } from './details';
import type { ActorPropertyWatch } from './watches';
import { readActorMethods } from './methods';
import { ActorLabInput } from './editor_input';
import { runtimeWorld, type ActorNode } from './runtime';
import { ActorStateGraph } from './state_graph';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { ActorProjection, readActorChoices } from './projection';
import { actorActions } from './operations';
import { actorTargetsEqual, captureActorTarget, resolveActorTarget, type ActorTarget } from './target';
import type { ActorExecutionService, ActorExecutionResult, ActorInvocation } from './execution';
import { ActorLabNavigationSelection } from './navigation_selection';
import { createActorMemberChoices } from './member_choices';
import { ActorViewportPicker } from './viewport_pick';

/** Actor Lab interaction and presentation; the shared domain service owns execution. */
export class ActorLabController {
	private current: ActorLabInput | undefined;
	private projection: ActorProjection;
	private navigationGeneration = 0;
	private readonly unbindGuest: () => void;
	private readonly unbindReview: () => void;
	public readonly viewportPicker: ActorViewportPicker;
	public readonly canInteract = (domain?: ResourceDomain) => domain === undefined ? this.execution.canExecute : this.execution.canExecuteIn(domain);
	public constructor(
		private readonly sources: RuntimeInstalledSourceState,
		public readonly guest: SuspendedGuestSession,
		private readonly cpu: CPU,
		private readonly quickInput: QuickInputController,
		private readonly group: EditorGroupView,
		private readonly navigation: EditorNavigationController,
		private readonly execution: ActorExecutionService,
		public readonly rewind: HostRewind,
		private readonly authoringSources: RuntimeSourceState,
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
			if (this.group.model.findById(this.current.id) === this.current) this.group.removeEditor(this.current);
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
	public open(): void {
		const input = this.resolveInput();
		if (!this.group.openEditor(input)) return;
		if (input.actorHashId === 0) this.selectActor(input);
	}
	public auditionEvent(domain: ResourceDomain, name: string): void {
		const input = this.resolveInput();
		if (!this.group.openEditor(input)) return;
		input.running = false;
		if (input.domain === domain) this.refresh(input);
		if (input.domain !== domain || input.actorHashId === 0) this.selectActor(input, () => { this.refresh(input); this.emitEvent(input, name); }, domain);
		else this.emitEvent(input, name);
	}
	public testEffect(domain: ResourceDomain): void {
		this.quickInput.pick('TEST GRANTED EFFECT', 'Trigger gates, payload, cooldown and activation use the real instance', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(readActionEffectInstances(this.sources, this.guest, domain).items);
		}, choice => {
			const actorHashId = (this.guest.readStringMember(choice.component, 'parent') as import('../../../../machine/ts/machine/cpu/table').Table).hashId;
			const effectHashId = choice.effect.hashId, componentHashId = choice.component.hashId, key = this.guest.identity(choice.key);
			const input = this.resolveInput();
			if (!this.group.openEditor(input)) return;
			input.domain = domain;
			input.follow.stop(); input.stateGraph = undefined; input.presentation = 'outline'; input.historical = false;
			input.actorHashId = actorHashId;
			input.selectionPath = undefined;
			input.running = false; input.dirty = true;
			this.refresh(input);
			const effect = input.runtime.roots[0]?.children.find(node => node.hashId === componentHashId)?.children
				.find(node => node.hashId === effectHashId && this.guest.matchesIdentity(node.key, key));
			if (effect === undefined) { showEditorMessage('Effect owner is not a mounted world actor.', 'info', 4); return; }
			this.projection.reveal(effect);
			this.actions(input);
		});
	}
	public refresh(input: ActorLabInput): boolean {
		// Read the requested history position, not an intermediate replay checkpoint.
		if (this.rewind.seeking) return false;
		let changed = false;
		if (input.dirty) {
			changed = this.projection.update(); input.dirty = false;
			if (input.detailsWindow.open && input.detailsWindow.collapsed) {
				this.followDetailsSelection(input);
				input.details!.resolveSubject(input.runtime, input.domain, input.worldHashId, input.historical);
			}
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
		input.running = false;
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

	public selectActor(input: ActorLabInput, accepted?: () => void, domain = this.cpu.activeCartridgeSlot()): void {
		input.running = false;
		this.quickInput.pick('RUNNING ACTORS', 'Choose the actual instance to experiment with',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorChoices(this.sources, this.guest, domain));
			}, choice => {
				this.inspectActor(input, choice.domain, choice.hashId);
				accepted?.();
			});
	}
	public inspectActor(input: ActorLabInput, domain: ResourceDomain, hashId: number): void {
		input.running = false; input.timeline.clear();
		input.stateGraph = undefined; input.presentation = 'outline'; input.follow.stop(); input.historical = this.rewind.active;
		input.domain = domain; input.actorHashId = hashId; input.selectionPath = undefined; input.dirty = true;
		this.refresh(input); this.projection.reveal(input.runtime.roots[0]);
	}
	public findMember(input: ActorLabInput, accepted: () => void): void {
		input.running = false;
		this.quickInput.pick('FIND IN ACTOR', 'Find a member by name, kind or owner path', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return createActorMemberChoices(input.runtime.roots, this.selected(input));
		}, choice => {
			input.follow.stop();
			this.projection.reveal(choice.node);
			accepted();
		});
	}
	private run(input: ActorLabInput, request: ActorInvocation, observer?: (result: ActorExecutionResult) => void, current: () => boolean = () => true): void {
		const generation = this.group.panes.openGeneration, domain = input.domain, actor = input.actorHashId;
		const operation = this.execution.start(request, { isCurrent: () => this.group.panes.openGeneration === generation
			&& input.domain === domain && input.actorHashId === actor && current() });
		void operation.completion.then(result => {
			if (observer !== undefined) observer(result);
			else showEditorMessage(result.status === 'completed' ? result.values.length === 0 ? 'Actor call completed.'
				: `Result: ${result.values.join(', ')}` : result.reason!, 'info', 4);
		});
	}
	public scrub(input: ActorLabInput, node: ActorNode, time: number, programHashId: number, current: () => boolean, finished: (completed: boolean) => void): void {
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, node, this.guest);
		this.run(input, { kind: 'scrub', target, time, programHashId }, result => finished(result.status === 'completed'), current);
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

	/** Collapse can follow scalar selection/title without formatting the hidden property client. */
	public followDetailsSelection(input: ActorLabInput): void {
		if (input.dirty || this.rewind.seeking) return;
		input.details!.followSelection(input.domain, input.worldHashId, input.actorHashId, input.presentation === 'outline'
			? input.selectionPath : input.stateGraph!.selectionBookmark?.path, input.runtime);
	}

	public setDetailsLocked(input: ActorLabInput, locked: boolean): void {
		input.details!.setLocked(locked);
		if (!locked) this.followDetailsSelection(input);
	}

	public inspect(input: ActorLabInput, inspector: WorkbenchPropertyInspector<ActorDetailsProperty>, focus = true, focusReturn?: InputFocusTarget): void {
		this.refreshDetails(input);
		input.detailsWindow.open = true;
		const lifetime = inspector.show({ title: 'DETAILS', items: input.details!.items, focusReturn, dismissible: false,
			canOpenSource: item => !input.dirty && !this.rewind.seeking
				&& (item.watch === undefined ? input.details!.available : item.watch.available && !item.watch.retired)
				&& canOpenBehaviorInspectionSource(this.authoringSources.catalog, item),
			openSource: item => {
				const source = item.source!;
				this.navigation.focusChunkSourceForContext(this.group, source.resource.contextId, source.resource.path, {
					row: source.range.start.line - 1, startColumn: source.range.start.column - 1, endColumn: source.range.start.column - 1,
				});
			},
			onDidClose: () => { input.detailsWindow.open = false; },
		}, focus);
		const selection = inspector.model.rows.findIndex(row => actorDetailsPropertyMatchesSelection(row.element, input.detailsSelection));
		if (selection >= 0) inspector.model.selectionIndex = selection;
		lifetime.add({ dispose: () => {
			const selected = inspector.model.rows[inspector.model.selectionIndex]?.element;
			input.detailsSelection = selected === undefined ? undefined : captureActorDetailsSelection(selected);
			input.detailsScroll = inspector.model.viewport.scrollTop;
		} });
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
		input.running = false;
		input.follow.stop(); input.stateGraph = undefined; input.presentation = 'outline';
		input.domain = target.domain; input.actorHashId = target.actorHashId;
		input.selectionPath = undefined; input.dirty = true;
		this.refresh(input);
		this.projection.reveal(resolveActorTarget(input.runtime.roots, target, this.guest)!);
		input.detailsSelection = { kind: 'property', identity: item.watch!.property };
	}

	public actions(input: ActorLabInput): void {
		input.running = false;
		const node = this.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, node, this.guest);
		const items = actorActions(node).map(action => ({ ...action, detail: '' }));
		this.quickInput.pick(`ACTIONS / ${node.label}`, 'Changes the running instance, not its Lua source',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(items);
			}, operation => {
				if (operation.payload !== undefined) {
					this.quickInput.input(operation.label, 'Lua arguments', operation.payload,
						async text => prepareLuaArguments(text), args => this.run(input, { kind: 'action', target, method: operation.method, args }), lifetime => {
							lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
						});
				} else this.run(input, { kind: 'action', target, method: operation.method, args: [] });
			});
	}

	public callMethod(input: ActorLabInput): void {
		input.running = false;
		const node = this.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, node, this.guest);
		this.quickInput.pick(`CALL / ${node.label}`, 'Stored Lua functions; selected instance is passed as self',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorMethods(this.sources, this.guest, node.value!).map(method => ({
					label: method.name, description: '', detail: method.source === undefined ? '' : `${method.source.resource.path}:${method.source.range.start.line}`,
				})));
			}, method => {
				const identity = this.guest.identity(this.guest.readStringMember(node.value, method.label));
				this.quickInput.input(`${node.label}:${method.label}(...)`, 'Lua arguments, excluding self; empty means no arguments', '',
					async text => prepareLuaArguments(text), args => this.run(input, { kind: 'method', target, method: method.label, identity, args }), lifetime => {
						lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
					});
			});
	}

	public hasActions(input: ActorLabInput): boolean {
		const node = this.selected(input);
		return node !== undefined && (node.kind === 'actor' || node.kind === 'tree' || node.kind === 'timeline' || node.kind === 'effect'
			|| node.kind === 'state' && node.path !== undefined);
	}
	public emitEvent(input: ActorLabInput, eventName = ''): void {
		input.running = false;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, input.runtime.roots[0], this.guest);
		this.quickInput.input('EMIT FROM ACTOR', 'Event name', eventName, async text => text, name => {
			this.quickInput.input(`PAYLOAD / ${name}`, 'Lua literal', '{}', async text => prepareLuaLiteral(text), payload => {
				this.run(input, { kind: 'event', target, name, payload });
			}, lifetime => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			});
		}, lifetime => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
		});
	}

	public spawn(input: ActorLabInput): void {
		input.running = false;
		const prefab = readRuntimeLuaModuleExport(this.sources, this.guest, input.domain, 'cartlib/world/prefab');
		const choices: (QuickPickItem & { id: SuspendedValueIdentity; definition: SuspendedValueIdentity })[] = [];
		if (prefab.kind === 'value' && prefab.value !== null) {
			const definitions = readRuntimeLuaModuleCapture(this.sources, this.guest, input.domain, 'cartlib/world/prefab',
				this.guest.readStringMember(prefab.value, 'define'), 'definitions');
			if (definitions.kind === 'value') this.guest.visitTableEntries(definitions.value, (id, definition) => {
				choices.push({ label: this.guest.formatValue(id), description: '', detail: '', id: this.guest.identity(id), definition: this.guest.identity(definition) });
			});
		}
		this.quickInput.pick('SPAWN REGISTERED PREFAB', `Current world / cart ${input.domain}`,
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.quickInput.input('SPAWN OPTIONS', 'Lua table; current world owns construction and assets', '{ pos = { x = 0, y = 0 } }',
				async text => prepareLuaLiteral(text), options => this.run(input, { kind: 'spawn', domain: input.domain,
					worldHashId: runtimeWorld(this.sources, this.guest, input.domain)!.hashId,
					definitionId: choice.id, definition: choice.definition, options }, result => {
					if (result.status !== 'completed') return;
					input.stateGraph = undefined; input.presentation = 'outline'; input.follow.stop(); input.historical = false;
					input.actorHashId = result.spawnedActorHashId!;
					input.selectionPath = undefined;
					input.dirty = true;
					this.refresh(input); this.projection.reveal(input.runtime.roots[0]);
				}), lifetime => {
					lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				});
			});
	}
}
