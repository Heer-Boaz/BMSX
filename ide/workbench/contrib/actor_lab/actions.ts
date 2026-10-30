import { readActionEffectInstances } from '../behavior_lens/action_effect_runtime';
import type { ResourceDomain } from '../../../common/resource';
import { showEditorMessage } from '../../../common/feedback_state';
import type { InputFocusTarget } from '../../../input/focus';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { prepareLuaArguments, prepareLuaLiteral } from '../../../runtime/lua_literal';
import type { SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { QuickPickItem } from '../../services/quick_input/provider';
import type { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { canOpenBehaviorInspectionSource } from '../behavior_lens/inspection_source';
import { actorDetailsPropertyMatchesSelection, captureActorDetailsSelection, type ActorDetailsProperty } from './details';
import { readActorMethods } from './methods';
import type { ActorLabInput } from './editor_input';
import { runtimeWorld, type ActorNode } from './runtime';
import { readActorChoices } from './projection';
import { actorActions } from './operations';
import { captureActorTarget } from './target';
import type { ActorExecutionResult, ActorInvocation } from './execution';
import { createActorMemberChoices } from './member_choices';

/** Prompt chains and pending invocations belong to one actual editor pane's group. */
export class ActorLabEditorActions {
	public constructor(private readonly group: EditorGroupView, private readonly quickInput: QuickInputController,
		private readonly origin: InputFocusTarget) {}
	public testEffect(input: ActorLabInput, domain: ResourceDomain): void {
		const controller = input.controller;
		this.quickInput.pick('TEST GRANTED EFFECT', 'Trigger gates, payload, cooldown and activation use the real instance', (_origin, lifetime) => {
			lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(readActionEffectInstances(controller.sources, controller.guest, domain).items);
		}, choice => {
			const actorHashId = (controller.guest.readStringMember(choice.component, 'owner') as import('../../../../machine/ts/machine/cpu/table').Table).hashId;
			const effectHashId = choice.effect.hashId, componentHashId = choice.component.hashId, key = controller.guest.identity(choice.key);
			input.domain = domain;
			input.follow.stop(); input.stateGraph = undefined; input.presentation = 'outline'; input.historical = false;
			input.actorHashId = actorHashId;
			input.selectionPath = undefined;
			input.interaction.running = false; input.dirty = true;
			controller.refresh(input);
			const effect = input.runtime.roots[0]?.children.find(node => node.hashId === componentHashId)?.children
				.find(node => node.hashId === effectHashId && controller.guest.matchesIdentity(node.key, key));
			if (effect === undefined) { showEditorMessage('Effect owner is not a mounted world actor.', 'info', 4); return; }
			controller.projection.reveal(effect);
			this.actions(input);
		});
	}

	public selectActor(input: ActorLabInput, accepted?: () => void, domain = input.controller.cpu.activeCartridgeSlot()): void {
		const controller = input.controller;
		input.interaction.running = false;
		this.quickInput.pick('RUNNING ACTORS', 'Choose the actual instance to experiment with',
			(_origin, lifetime) => {
				lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorChoices(controller.sources, controller.guest, domain));
			}, choice => {
				controller.inspectActor(input, choice.domain, choice.hashId);
				accepted?.();
			});
	}

	public findMember(input: ActorLabInput, accepted: () => void): void {
		const controller = input.controller;
		input.interaction.running = false;
		this.quickInput.pick('FIND IN ACTOR', 'Find a member by name, kind or owner path', (_origin, lifetime) => {
			lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return createActorMemberChoices(input.runtime.roots, controller.selected(input));
		}, choice => {
			input.follow.stop();
			controller.projection.reveal(choice.node);
			accepted();
		});
	}
	private run(input: ActorLabInput, request: ActorInvocation, observer?: (result: ActorExecutionResult) => void, current: () => boolean = () => true): void {
		const controller = input.controller;
		const domain = input.domain, actor = input.actorHashId;
		let attached = true;
		const isCurrent = () => attached
			&& input.domain === domain && input.actorHashId === actor && current();
		const operation = controller.execution.start(request, { isCurrent });
		const unbind = this.origin.scope.onDidRetireContext(() => { attached = false; });
		void operation.completion.then(result => {
			unbind();
			if (!isCurrent()) return;
			if (observer !== undefined) observer(result);
			else showEditorMessage(result.status === 'completed' ? result.values.length === 0 ? 'Actor call completed.'
				: `Result: ${result.values.join(', ')}` : result.reason!, 'info', 4);
		});
	}
	public scrub(input: ActorLabInput, node: ActorNode, time: number, programHashId: number, current: () => boolean, finished: (completed: boolean) => void): void {
		const controller = input.controller;
		const target = captureActorTarget(input.domain, runtimeWorld(controller.sources, controller.guest, input.domain)!.hashId, input.runtime.roots, node, controller.guest);
		this.run(input, { kind: 'scrub', target, time, programHashId }, result => finished(result.status === 'completed'), current);
	}

	public inspect(input: ActorLabInput, inspector: WorkbenchPropertyInspector<ActorDetailsProperty>, focus = true, focusReturn?: InputFocusTarget): void {
		const controller = input.controller;
		controller.refreshDetails(input);
		input.detailsWindow.open = true;
		const lifetime = inspector.show({ title: 'DETAILS', items: input.details!.items, focusReturn, dismissible: false,
			canOpenSource: item => !input.dirty && !controller.rewind.seeking
				&& (item.watch === undefined ? input.details!.available : item.watch.available && !item.watch.retired)
				&& canOpenBehaviorInspectionSource(controller.authoringSources.catalog, item),
			openSource: item => {
				const source = item.source!;
				controller.navigation.focusChunkSourceForContext(this.group, source.resource.contextId, source.resource.path, {
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

	public actions(input: ActorLabInput): void {
		const controller = input.controller;
		input.interaction.running = false;
		const node = controller.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(controller.sources, controller.guest, input.domain)!.hashId, input.runtime.roots, node, controller.guest);
		const items = actorActions(node).map(action => ({ ...action, detail: '' }));
		this.quickInput.pick(`ACTIONS / ${node.label}`, 'Changes the running instance, not its Lua source',
			(_origin, lifetime) => {
				lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(items);
			}, operation => {
				if (operation.payload !== undefined) {
					this.quickInput.input(operation.label, 'Lua arguments', operation.payload,
						async text => prepareLuaArguments(text), args => this.run(input, { kind: 'action', target, method: operation.method, args }), lifetime => {
							lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
						});
				} else this.run(input, { kind: 'action', target, method: operation.method, args: [] });
			});
	}

	public callMethod(input: ActorLabInput): void {
		const controller = input.controller;
		input.interaction.running = false;
		const node = controller.selected(input)!;
		const target = captureActorTarget(input.domain, runtimeWorld(controller.sources, controller.guest, input.domain)!.hashId, input.runtime.roots, node, controller.guest);
		this.quickInput.pick(`CALL / ${node.label}`, 'Stored Lua functions; selected instance is passed as self',
			(_origin, lifetime) => {
				lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorMethods(controller.sources, controller.guest, node.value!).map(method => ({
					label: method.name, description: '', detail: method.source === undefined ? '' : `${method.source.resource.path}:${method.source.range.start.line}`,
				})));
			}, method => {
				const identity = controller.guest.identity(controller.guest.readStringMember(node.value, method.label));
				this.quickInput.input(`${node.label}:${method.label}(...)`, 'Lua arguments, excluding self; empty means no arguments', '',
					async text => prepareLuaArguments(text), args => this.run(input, { kind: 'method', target, method: method.label, identity, args }), lifetime => {
						lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
					});
			});
	}

	public emitEvent(input: ActorLabInput, eventName = ''): void {
		const controller = input.controller;
		input.interaction.running = false;
		const target = captureActorTarget(input.domain, runtimeWorld(controller.sources, controller.guest, input.domain)!.hashId, input.runtime.roots, input.runtime.roots[0], controller.guest);
		this.quickInput.input('EMIT FROM ACTOR', 'Event name', eventName, async text => text, name => {
			this.quickInput.input(`PAYLOAD / ${name}`, 'Lua literal', '{}', async text => prepareLuaLiteral(text), payload => {
				this.run(input, { kind: 'event', target, name, payload });
			}, lifetime => {
				lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
			});
		}, lifetime => {
			lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
		});
	}

	public spawn(input: ActorLabInput): void {
		const controller = input.controller;
		input.interaction.running = false;
		const prefab = readRuntimeLuaModuleExport(controller.sources, controller.guest, input.domain, 'cartlib/world/prefab');
		const choices: (QuickPickItem & { id: SuspendedValueIdentity; definition: SuspendedValueIdentity })[] = [];
		if (prefab.kind === 'value' && prefab.value !== null) {
			const definitions = readRuntimeLuaModuleCapture(controller.sources, controller.guest, input.domain, 'cartlib/world/prefab',
				controller.guest.readStringMember(prefab.value, 'define'), 'definitions');
			if (definitions.kind === 'value') controller.guest.visitTableEntries(definitions.value, (id, definition) => {
				choices.push({ label: controller.guest.formatValue(id), description: '', detail: '', id: controller.guest.identity(id), definition: controller.guest.identity(definition) });
			});
		}
		this.quickInput.pick('SPAWN REGISTERED PREFAB', `Current world / cart ${input.domain}`,
			(_origin, lifetime) => {
				lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.quickInput.input('SPAWN OPTIONS', 'Lua table; current world owns construction and assets', '{ pos = { x = 0, y = 0 } }',
				async text => prepareLuaLiteral(text), options => this.run(input, { kind: 'spawn', domain: input.domain,
					worldHashId: runtimeWorld(controller.sources, controller.guest, input.domain)!.hashId,
					definitionId: choice.id, definition: choice.definition, options }, result => {
					if (result.status !== 'completed') return;
					input.stateGraph = undefined; input.presentation = 'outline'; input.follow.stop(); input.historical = false;
					input.actorHashId = result.spawnedActorHashId!;
					input.selectionPath = undefined;
					input.dirty = true;
					controller.refresh(input); controller.projection.reveal(input.runtime.roots[0]);
				}), lifetime => {
					lifetime.add({ dispose: controller.guest.onDidInvalidate(() => this.quickInput.hide()) });
				});
			});
	}
}
