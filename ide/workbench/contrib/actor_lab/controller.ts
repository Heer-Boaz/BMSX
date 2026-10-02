import { readActionEffectInstances } from '../behavior_lens/action_effect_runtime';
import type { ResourceDomain } from '../../../common/resource';
import { COLOR_STATUS_TEXT } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { HostRewind } from '../../../../hosts/common/rewind';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { prepareLuaArguments, prepareLuaLiteral } from '../../../runtime/lua_literal';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { openEditorTab } from '../../ui/tabs';
import type { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { EditorNavigationController } from '../resources/navigation';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import { canOpenBehaviorInspectionSource } from '../behavior_lens/inspection_source';
import { inspectActorNode } from './inspection';
import { readActorMethods } from './methods';
import { ActorLabInput } from './editor_input';
import { runtimeWorld, type ActorNode } from './runtime';
import { ActorStateGraph } from './state_graph';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { ActorProjection, readActorChoices } from './projection';
import { actorActions } from './operations';
import { captureActorTarget, resolveActorTarget } from './target';
import type { ActorExecutionService, ActorExecutionResult, ActorInvocation } from './execution';

/** Actor Lab interaction and presentation; the shared domain service owns execution. */
export class ActorLabController {
	private current: ActorLabInput | undefined;
	private projection: ActorProjection;
	private historyRestorePending = false;
	public readonly canInteract = (domain?: ResourceDomain) => domain === undefined ? this.execution.canExecute : this.execution.canExecuteIn(domain);
	public constructor(
		private readonly sources: RuntimeSourceState,
		public readonly guest: SuspendedGuestSession,
		private readonly cpu: CPU,
		private readonly quickInput: QuickInputController,
		private readonly panes: EditorPanes,
		private readonly navigation: EditorNavigationController,
		private readonly execution: ActorExecutionService,
		private readonly rewind: HostRewind,
	) {
		guest.onDidInvalidate(reason => {
			const input = this.current;
			if (input === undefined) return;
			// A hidden pane must resolve its bookmark before a new branch can reuse
			// identities from the discarded future. Replay itself is not that branch.
			if (reason === 'execution' && this.historyRestorePending && !this.rewind.seeking && !this.rewind.playing) this.refresh(input);
			input.invalidate(reason);
			if (reason !== 'execution') this.historyRestorePending = reason === 'history-restored';
		});
	}

	public resolveInput(): ActorLabInput {
		if (this.current === undefined) {
			const input = new ActorLabInput();
			this.projection = new ActorProjection(input, this.sources, this.guest);
			input.onWillDispose(() => { this.current = undefined; this.historyRestorePending = false; });
			this.current = input;
		}
		return this.current;
	}
	public open(): void {
		const input = this.resolveInput();
		openEditorTab(this.panes, input);
		if (input.actorHashId === 0) this.selectActor(input);
	}
	public auditionEvent(domain: ResourceDomain, name: string): void {
		const input = this.resolveInput();
		input.running = false;
		openEditorTab(this.panes, input);
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
			const effectHashId = choice.effect.hashId;
			const input = this.resolveInput();
			input.domain = domain;
			input.actorHashId = actorHashId;
			input.selectionHashId = actorHashId;
			input.running = false; input.dirty = true;
			openEditorTab(this.panes, input);
			this.refresh(input);
			if (!this.projection.reveal(effectHashId)) { showEditorMessage('Effect owner is not a mounted world actor.', COLOR_STATUS_TEXT, 4); return; }
			this.actions(input);
		});
	}
	public refresh(input: ActorLabInput): boolean {
		// Read the requested history position, not an intermediate replay checkpoint.
		if (!input.dirty || this.rewind.seeking) return false;
		const changed = this.projection.update();
		input.dirty = false;
		this.historyRestorePending = false;
		return changed;
	}
	public selectActor(input: ActorLabInput, accepted?: () => void, domain = this.cpu.activeCartridgeSlot()): void {
		input.running = false;
		this.quickInput.pick('RUNNING ACTORS', 'Choose the actual instance to experiment with',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorChoices(this.sources, this.guest, domain));
			}, choice => { input.stateGraph = undefined; input.domain = choice.domain; input.actorHashId = choice.hashId; input.selectionHashId = choice.hashId; input.dirty = true; accepted?.(); });
	}
	private run(input: ActorLabInput, request: ActorInvocation, observer?: (result: ActorExecutionResult) => void, current: () => boolean = () => true): void {
		const generation = this.panes.openGeneration, domain = input.domain, actor = input.actorHashId;
		const operation = this.execution.start(request, { isCurrent: () => this.panes.openGeneration === generation
			&& input.domain === domain && input.actorHashId === actor && current() });
		void operation.completion.then(result => {
			if (observer !== undefined) observer(result);
			else showEditorMessage(result.status === 'completed' ? result.values.length === 0 ? 'Actor call completed.'
				: `Result: ${result.values.join(', ')}` : result.reason!, COLOR_STATUS_TEXT, 4);
		});
	}
	public scrub(input: ActorLabInput, node: ActorNode, time: number, programHashId: number, current: () => boolean, finished: (completed: boolean) => void): void {
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, node, this.guest);
		this.run(input, { kind: 'scrub', target, time, programHashId }, result => finished(result.status === 'completed'), current);
	}

	public selected(input: ActorLabInput): ActorNode | undefined {
		if (input.dirty) return undefined;
		if (input.stateGraph === undefined) return input.outline.rows[input.outline.selectionIndex]?.element.node;
		const target = input.stateGraph.selectedTarget;
		return target === undefined ? undefined : resolveActorTarget(input.runtime.roots, target, this.guest);
	}

	public openStateGraph(input: ActorLabInput, font: BFont): void {
		const selected = this.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(this.sources, this.guest, input.domain)!.hashId, input.runtime.roots, selected, this.guest);
		let length = target.path.length;
		while (target.path[length - 1].kind !== 'machine') length--;
		input.stateGraph = new ActorStateGraph({ ...target, path: target.path.slice(0, length) }, font);
		input.stateGraph.refresh(input.runtime.roots, this.guest);
	}

	public inspect(input: ActorLabInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const selected = this.selected(input)!;
		input.running = false;
		const items = inspectActorNode(this.sources, this.guest, selected);
		const lifetime = inspector.show({ title: `${selected.label} / LIVE INSTANCE`, items,
			canOpenSource: item => canOpenBehaviorInspectionSource(this.sources, item),
			openSource: item => {
				const source = item.source!;
				this.navigation.focusChunkSourceForContext(source.resource.domain, source.resource.path, {
					row: source.range.start.line - 1, startColumn: source.range.start.column - 1, endColumn: source.range.start.column - 1,
				});
			},
		});
		lifetime.add({ dispose: this.guest.onDidInvalidate(() => inspector.hide()) });
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
					const lifetime = this.quickInput.input(operation.label, 'Lua arguments', operation.payload,
						async text => prepareLuaArguments(text), args => this.run(input, { kind: 'action', target, method: operation.method, args }));
					lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
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
				const lifetime = this.quickInput.input(`${node.label}:${method.label}(...)`, 'Lua arguments, excluding self; empty means no arguments', '',
					async text => prepareLuaArguments(text), args => this.run(input, { kind: 'method', target, method: method.label, identity, args }));
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
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
		const nameLifetime = this.quickInput.input('EMIT FROM ACTOR', 'Event name', eventName, async text => text, name => {
			const payloadLifetime = this.quickInput.input(`PAYLOAD / ${name}`, 'Lua literal', '{}', async text => prepareLuaLiteral(text), payload => {
				this.run(input, { kind: 'event', target, name, payload });
			});
			payloadLifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
		});
		nameLifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
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
				const lifetime = this.quickInput.input('SPAWN OPTIONS', 'Lua table; current world owns construction and assets', '{ pos = { x = 0, y = 0 } }',
				async text => prepareLuaLiteral(text), options => this.run(input, { kind: 'spawn', domain: input.domain,
					worldHashId: runtimeWorld(this.sources, this.guest, input.domain)!.hashId,
					definitionId: choice.id, definition: choice.definition, options }, result => {
					if (result.status !== 'completed') return;
					input.actorHashId = result.spawnedActorHashId!;
					input.selectionHashId = input.actorHashId;
					input.dirty = true;
				}));
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			});
	}
}
