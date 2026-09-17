import { COLOR_STATUS_TEXT } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { CPU } from '../../../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueString, type Value } from '../../../../machine/ts/machine/cpu/value';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { prepareLuaArguments, prepareLuaLiteral, type PreparedLuaLiteral } from '../../../runtime/lua_literal';
import type { RuntimeGuestCallExecutor, RuntimeGuestCallObserver, RuntimeGuestCallRequest } from '../../../runtime/guest_call';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
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
import { ActorProjection, findRuntimeActor, readActorChoices, runtimeWorld, type ActorNode } from './runtime';

type ActorOperation = QuickPickItem & { readonly method: string; readonly payload?: string; readonly keyed?: boolean };

/** Cartlib-specific controls over real instances; the execution service knows no cartlib. */
export class ActorLabController {
	private current: ActorLabInput | undefined;
	private projection: ActorProjection;
	private readonly completionValues: Value[] = [];
	public readonly execute: RuntimeGuestCallExecutor = (prepare, observer) => {
		// Pane replacement releases its borrowed rows while GPU admission may still await.
		const generation = this.panes.openGeneration;
		const input = this.current!;
		const domain = input.domain, actorHashId = input.actorHashId;
		this.schedule({
			isCurrent: () => this.panes.openGeneration === generation && input.domain === domain && input.actorHashId === actorHashId,
			boundary: () => {
				const world = runtimeWorld(this.sources, this.guest, domain);
				if (world === undefined) return;
				return {
					request: { domain, closure: this.guest.readStringMember(world, 'request_mutation_boundary') as Closure,
						args: () => [world] },
					condition: values => {
						const receipt = values[0] as Table;
						const reachedKey = this.cpu.stringPool.find('reached')!;
						return () => receipt.getStringKey(reachedKey) === true;
					},
				};
			},
			prepare: () => {
				// Reaching the owner boundary or returning from an IRQ ends the previous heap borrow.
				this.refresh(input);
				if (input.actorHashId !== actorHashId) return;
				return prepare();
			},
		}, observer);
	};
	public constructor(
		private readonly sources: RuntimeSourceState,
		public readonly guest: SuspendedGuestSession,
		private readonly cpu: CPU,
		private readonly quickInput: QuickInputController,
		private readonly panes: EditorPanes,
		private readonly navigation: EditorNavigationController,
		private readonly schedule: (request: RuntimeGuestCallRequest, observer?: RuntimeGuestCallObserver) => void,
		public readonly canInteract: () => boolean,
	) {
		guest.onDidInvalidate(reason => this.current?.invalidate(reason === 'heap-replaced'));
	}

	public resolveInput(): ActorLabInput {
		if (this.current === undefined) {
			const input = new ActorLabInput();
			this.projection = new ActorProjection(input, this.sources, this.guest);
			input.onWillDispose(() => { this.current = undefined; });
			this.current = input;
		}
		return this.current;
	}
	public open(): void {
		const input = this.resolveInput();
		openEditorTab(this.panes, input);
		if (input.actorHashId === 0) this.selectActor(input);
	}
	public refresh(input: ActorLabInput): boolean {
		if (!input.dirty) return false;
		const changed = this.projection.update();
		input.dirty = false;
		return changed;
	}
	public selectActor(input: ActorLabInput): void {
		input.running = false;
		this.quickInput.pick('RUNNING ACTORS', 'Choose the actual instance to experiment with',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorChoices(this.sources, this.guest));
			}, choice => { input.domain = choice.domain; input.actorHashId = choice.hashId; input.selectionHashId = 0; input.dirty = true; });
	}
	public didFinishCall(completed: boolean, observer?: RuntimeGuestCallObserver): void {
		if (completed) this.cpu.readCompletionValues(this.completionValues);
		if (observer !== undefined) observer(completed, this.completionValues);
		else if (completed) {
			const message = this.completionValues.length === 0 ? 'Actor operation completed.'
				: `Result: ${this.completionValues.map(value => this.guest.previewValue(value, 1, 4)).join(', ')}`;
			showEditorMessage(message, COLOR_STATUS_TEXT, 4);
		}
		this.completionValues.length = 0;
	}

	public selected(input: ActorLabInput): ActorNode | undefined { return input.outline.rows[input.outline.selectionIndex]?.element; }

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
		const items = this.operations(node);
		this.quickInput.pick(`ACTIONS / ${node.label}`, 'Changes the running instance, not its Lua source',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(items);
			}, operation => {
				if (operation.payload !== undefined) {
					const lifetime = this.quickInput.input(operation.label, 'Lua arguments', operation.payload,
						async text => prepareLuaArguments(text), literals => this.invoke(input, node, operation, literals));
					lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				} else this.invoke(input, node, operation);
			});
	}

	public callMethod(input: ActorLabInput): void {
		input.running = false;
		const node = this.selected(input)!;
		this.quickInput.pick(`CALL / ${node.label}`, 'Stored Lua functions; selected instance is passed as self',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(readActorMethods(this.sources, this.guest, node.value!));
			}, method => {
				const lifetime = this.quickInput.input(`${node.label}:${method.label}(...)`, 'Lua arguments, excluding self; empty means no arguments', '',
					async text => prepareLuaArguments(text), literals => this.execute(() => {
						const receiver = node.value;
						if (receiver === null) return; // Target was removed while the request awaited admission.
						return { domain: input.domain, closure: this.guest.readStringMember(receiver, method.label) as Closure,
							args: () => {
								const args: Value[] = [receiver];
								for (const literal of literals) args.push(literal(this.cpu));
								return args;
							} };
					}));
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			});
	}

	private operations(node: ActorNode): readonly ActorOperation[] {
		if (node.kind === 'effect') return node.active ? ACTIVE_EFFECT_OPERATIONS : EFFECT_OPERATIONS;
		if (node.kind === 'state' && node.path === undefined) return NO_OPERATIONS;
		return OPERATIONS[node.kind];
	}
	public hasActions(input: ActorLabInput): boolean {
		const node = this.selected(input);
		return node !== undefined && (node.kind === 'actor' || node.kind === 'tree' || node.kind === 'timeline' || node.kind === 'effect'
			|| node.kind === 'state' && node.path !== undefined);
	}
	private invoke(input: ActorLabInput, node: ActorNode, operation: ActorOperation, literals?: readonly PreparedLuaLiteral[]): void {
		this.execute(() => {
			const receiver = node.receiver;
			if (receiver === null) return;
			const key = node.key;
			return { domain: input.domain, closure: this.guest.readStringMember(receiver, operation.method) as Closure,
				args: () => {
					const args: Value[] = [receiver];
					if (node.kind === 'state') args.push(valueString(this.cpu.stringPool.intern(node.path!)));
					else if (operation.keyed) args.push(key);
					if (literals !== undefined) for (const literal of literals) args.push(literal(this.cpu));
					return args;
				} };
		});
	}

	public emitEvent(input: ActorLabInput): void {
		input.running = false;
		const nameLifetime = this.quickInput.input('EMIT FROM ACTOR', 'Event name', '', async text => text, name => {
			const payloadLifetime = this.quickInput.input(`PAYLOAD / ${name}`, 'Lua literal', '{}', async text => prepareLuaLiteral(text), payload => {
				this.execute(() => {
					const actor = findRuntimeActor(this.sources, this.guest, input)!;
					const events = this.guest.readStringMember(actor, 'events');
					return { domain: input.domain, closure: this.guest.readStringMember(events, 'emit') as Closure,
						args: () => [events, valueString(this.cpu.stringPool.intern(name)), payload(this.cpu)] };
				});
			});
			payloadLifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
		});
		nameLifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
	}

	public spawn(input: ActorLabInput): void {
		input.running = false;
		const prefab = readRuntimeLuaModuleExport(this.sources, this.guest, input.domain, 'cartlib/world/prefab');
		const choices: (QuickPickItem & { id: Value })[] = [];
		if (prefab.kind === 'value' && prefab.value !== null) {
			const definitions = readRuntimeLuaModuleCapture(this.sources, this.guest, input.domain, 'cartlib/world/prefab',
				this.guest.readStringMember(prefab.value, 'define'), 'definitions');
			if (definitions.kind === 'value') this.guest.visitTableEntries(definitions.value, id => {
				choices.push({ label: this.guest.formatValue(id), description: '', detail: '', id });
			});
		}
		this.quickInput.pick('SPAWN REGISTERED PREFAB', `Current world / cart ${input.domain}`,
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				const lifetime = this.quickInput.input('SPAWN OPTIONS', 'Lua table; current world owns construction and assets', '{ pos = { x = 0, y = 0 } }',
				async text => prepareLuaLiteral(text), options => this.execute(() => {
					const world = runtimeWorld(this.sources, this.guest, input.domain)!;
					return { domain: input.domain, closure: this.guest.readStringMember(world, 'spawn') as Closure,
						args: () => [world, choice.id, options(this.cpu)] };
				}, (completed, values) => {
					if (!completed) return;
					input.actorHashId = (values[0] as Table).hashId;
					input.selectionHashId = input.actorHashId;
					input.dirty = true;
				}));
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			});
	}
}

const NO_OPERATIONS: readonly ActorOperation[] = [];
const EFFECT_OPERATIONS: readonly ActorOperation[] = [
	{ label: 'Trigger with payload', method: 'trigger', payload: '{}', keyed: true, description: 'Runs trigger gates and cooldown', detail: '' },
	{ label: 'Activate', method: 'activate', keyed: true, description: 'Adds one activation', detail: '' },
];
const ACTIVE_EFFECT_OPERATIONS: readonly ActorOperation[] = [...EFFECT_OPERATIONS,
	{ label: 'Deactivate', method: 'deactivate', keyed: true, description: 'Removes one activation', detail: '' }];
const OPERATIONS: Readonly<Record<ActorNode['kind'], readonly ActorOperation[]>> = {
	actor: [
		{ label: 'Set position', method: 'set_pos', payload: '0, 0, 0', description: 'x, y, z in cart world units', detail: '' },
		{ label: 'Add tag', method: 'add_tag', payload: "'tag'", description: '', detail: '' },
		{ label: 'Remove tag', method: 'remove_tag', payload: "'tag'", description: '', detail: '' },
		{ label: 'Despawn', method: 'mark_for_disposal', description: 'World-owned disposal and component teardown', detail: '' },
	],
	state: [{ label: 'Go to state', method: 'transition_to', description: 'Imperative navigation; bypasses event guards', detail: '' }],
	tree: [
		{ label: 'Start', method: 'start', description: '', detail: '' },
		{ label: 'Stop', method: 'stop', description: '', detail: '' },
		{ label: 'Request execution', method: 'request_execution', description: 'Schedules the next BT evaluation', detail: '' },
	],
	timeline: [
		{ label: 'Play from start', method: 'play', keyed: true, description: '', detail: '' },
		{ label: 'Stop', method: 'stop', keyed: true, description: '', detail: '' },
		{ label: 'Scrub time (ms)', method: 'scrub_time', payload: '0', keyed: true, description: 'Samples without event replay', detail: '' },
		{ label: 'Seek time (ms)', method: 'seek_time', payload: '0', keyed: true, description: 'Uses timeline seek semantics', detail: '' },
	],
	component: NO_OPERATIONS, machine: NO_OPERATIONS, effect: EFFECT_OPERATIONS,
};
