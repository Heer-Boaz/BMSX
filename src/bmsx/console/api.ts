import { $, runGate } from '../core/game';
import { Input } from '../input/input';
import type { PlayerInput } from '../input/playerinput';
import type { color, RectRenderSubmission } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { ConsoleFont } from './font';
import { BmsxConsoleStorage } from './storage';
import { BmsxConsolePointerButton, ConsolePointerVector, ConsolePointerViewport, ConsolePointerWheel } from './types';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { Identifier, Registerable, RomPack } from '../rompack/rompack';
import type { World, SpawnReason } from '../core/world';
import type { Registry } from '../core/registry';
import { Service } from '../core/service';
import type { EventEmitter, EventPayload } from '../core/eventemitter';
import { EventTimeline } from '../core/eventtimeline';
import { WorldObject } from '../core/object/worldobject';
import type { Game } from '../core/game';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import { taskGate, GateGroup } from '../core/taskgate';
import { StateDefinitionBuilders } from '../fsm/fsmdecorators';
import { setupFSMlibrary } from '../fsm/fsmlibrary';
import { ConsoleRenderFacade } from './console_render_facade';
import { new_vec3 } from '../utils/vector_operations';
import type { Space } from '../core/space';
import { Reviver } from '../serializer/gameserializer';
import type { RevivableObjectArgs } from '../serializer/serializationhooks';
import { Component } from '../component/basecomponent';
import { LuaComponent } from '../component/lua_component';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import type { ActionEffectDefinition } from '../action_effects/effect_types';
import { BmsxConsoleRuntime } from './runtime';
import type { ConsoleWorldObjectComponentEntry, ConsoleWorldObjectSystemEntry, ConsoleWorldObjectSpawnOptions } from './runtime';
import { instantiateBehaviorTree, behaviorTreeExists, Blackboard, type BehaviorTreeID, type BehaviorTreeContext, type ConstructorWithBTProperty } from '../ai/behaviourtree';
import { deep_clone } from '../utils/deep_clone';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | undefined;

export type BmsxConsoleApiOptions = {
	playerindex: number;
	storage: BmsxConsoleStorage;
};

const DRAW_LAYER: RectRenderSubmission['layer'] = 'ui';
const CONSOLE_TAB_SPACES = 2;

const POINTER_ACTIONS: readonly string[] = [
	'pointer_primary',
	'pointer_secondary',
	'pointer_aux',
	'pointer_back',
	'pointer_forward',
] as const;

type ConsoleComponentDescriptor = {
	className: string;
	options: Record<string, unknown>;
};

type NormalizedSpawnOptions = ConsoleWorldObjectSpawnOptions & {
	id?: string;
	space?: string;
	reason?: SpawnReason;
	position: { x: number; y: number; z: number } | null;
	orientation: { x: number; y: number; z: number } | null;
	scale: { x: number; y: number; z: number } | null;
};

export class BmsxConsoleApi {
	private readonly playerindex: number;
	private readonly storage: BmsxConsoleStorage;
	private readonly font: ConsoleFont;
	private readonly defaultPrintColorIndex = 15;
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private renderBackend: ConsoleRenderFacade = new ConsoleRenderFacade();

	constructor(options: BmsxConsoleApiOptions) {
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleApi] Game view not initialised.');
		}
		const viewport = view.viewportSize;
		if (viewport.x <= 0 || viewport.y <= 0) {
			throw new Error('[BmsxConsoleApi] Invalid viewport size.');
		}
		this.playerindex = options.playerindex;
		this.storage = options.storage;
		this.font = new ConsoleFont();
		this.reset_print_cursor();
	}

	public set_render_backend(backend: ConsoleRenderFacade | null): void {
		this.renderBackend = backend ?? new ConsoleRenderFacade();
	}

	public get display_width(): number {
		return $.view.viewportSize.x;
	}

	public get display_height(): number {
		return $.view.viewportSize.y;
	}

	public mousebtn(button: BmsxConsolePointerButton): boolean {
		const state = this.get_player_input().getActionState(this.pointer_action(button));
		return state.pressed;
	}

	public mousebtnp(button: BmsxConsolePointerButton): boolean {
		const state = this.get_player_input().getActionState(this.pointer_action(button));
		return state.guardedjustpressed;
	}

	public mousebtnr(button: BmsxConsolePointerButton): boolean {
		const state = this.get_player_input().getActionState(this.pointer_action(button));
		return state.justreleased;
	}

	private get_player_input(): PlayerInput {
		const playerInput = Input.instance.getPlayerInput(this.playerindex);
		if (!playerInput) {
			throw new Error(`[BmsxConsoleApi] Player input handler for index ${this.playerindex} is not initialised.`);
		}
		return playerInput;
	}

	private pointer_action(button: BmsxConsolePointerButton): string {
		const action = POINTER_ACTIONS[button];
		if (!action) {
			throw new Error(`[BmsxConsoleApi] Pointer button index ${button} outside supported range 0-${POINTER_ACTIONS.length - 1}.`);
		}
		return action;
	}

	public mousepos(): ConsolePointerViewport {
		return this.pointer_viewport_position();
	}

	public pointer_screen_position(): ConsolePointerVector {
		const state = this.get_player_input().getActionState('pointer_position');
		const coords = state.value2d;
		if (!coords) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: coords[0], y: coords[1], valid: true };
	}

	public pointer_delta(): ConsolePointerVector {
		const state = this.get_player_input().getActionState('pointer_delta');
		const delta = state.value2d;
		if (!delta) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: delta[0], y: delta[1], valid: true };
	}

	public pointer_viewport_position(): ConsolePointerViewport {
		return this.pointer_viewport_position_internal();
	}

	public mousewheel(): ConsolePointerWheel {
		const state = this.get_player_input().getActionState('pointer_wheel');
		const value = typeof state.value === 'number' ? state.value : 0;
		const valid = typeof state.value === 'number';
		return { value, valid };
	}

	public stat(index: number): number {
		if (!Number.isFinite(index)) {
			throw new Error('[BmsxConsoleApi] stat index must be finite.');
		}
		const value = Math.trunc(index);
		switch (value) {
			case 32: {
				const viewport = this.pointer_viewport_position_internal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.x);
			}
			case 33: {
				const viewport = this.pointer_viewport_position_internal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.y);
			}
			case 34: {
				return this.compute_pointer_button_mask();
			}
			case 36: {
				const wheel = this.mousewheel();
				if (!wheel.valid) {
					return 0;
				}
				return Math.floor(wheel.value);
			}
			default:
				return 0;
		}
	}

	public cls(colorindex: number = 0): void {
		const color = this.palette_color(colorindex);
		this.renderBackend.drawRect({
			kind: 'fill',
			x0: 0,
			y0: 0,
			x1: this.display_width,
			y1: this.display_height,
			color,
			layer: DRAW_LAYER,
		});
		this.reset_print_cursor();
	}

	public rect(x0: number, y0: number, x1: number, y1: number, colorindex: number): void {
		this.renderBackend.drawRect({ kind: 'rect', x0, y0, x1, y1, color: this.palette_color(colorindex), layer: DRAW_LAYER });
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, colorindex: number): void {
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: this.palette_color(colorindex), layer: DRAW_LAYER });
	}

	public rectfill_color(x0: number, y0: number, x1: number, y1: number, colorvalue: number | color): void {
		const resolved = typeof colorvalue === 'number' ? this.palette_color(colorvalue) : colorvalue;
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: resolved, layer: DRAW_LAYER });
	}

	public sprite(
		img_id: string,
		x: number,
		y: number,
		options?: { scale?: number; flip_h?: boolean; flip_v?: boolean; colorize?: color }
	): void {
		const entry = $.rompack.img[img_id];
		const width = entry.imgmeta.width;
		const height = entry.imgmeta.height;
		const scale = options?.scale ?? 1;
		this.renderBackend.drawSprite({
			kind: 'sprite',
			imgId: img_id,
			spriteIndex: null,
			originX: 0,
			originY: 0,
			baseX: x,
			baseY: y,
			drawX: x,
			drawY: y,
			scale,
			layer: DRAW_LAYER,
			flipH: options?.flip_h === true,
			flipV: options?.flip_v === true,
			spriteId: null,
			instanceId: img_id,
			width,
			height,
			positionDirty: false,
			colorize: options?.colorize,
		});
	}

	public write(text: string, x?: number, y?: number, colorindex?: number): void {
		const { baseX, baseY, color, font, autoAdvance } = this.resolve_write_context(this.font, x, y, colorindex);
		this.draw_multiline_text(text, baseX, baseY, color, font);
		if (autoAdvance) {
			this.advance_print_cursor(font.lineHeight());
		}
	}

	public write_with_font(text: string, x?: number, y?: number, colorindex?: number, font?: ConsoleFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, colorindex);
		this.draw_multiline_text(text, baseX, baseY, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight());
		}
	}

	public check_action_state(playerindex: number, actiondefinition: string): boolean {
		if (!Number.isInteger(playerindex) || playerindex <= 0) {
			throw new Error('[BmsxConsoleApi] check_action_state requires a positive integer player index.');
		}
		if (typeof actiondefinition !== 'string') {
			throw new Error('[BmsxConsoleApi] check_action_state requires an action definition string.');
		}
		const trimmed = actiondefinition.trim();
		if (trimmed.length === 0) {
			throw new Error('[BmsxConsoleApi] check_action_state requires a non-empty action definition.');
		}
		const playerInput = Input.instance.getPlayerInput(playerindex);
		if (!playerInput) {
			throw new Error(`[BmsxConsoleApi] Player input handler for index ${playerindex} is not initialised.`);
		}
		return playerInput.checkActionTriggered(trimmed);
	}

	public cartdata(namespace: string): void {
		this.storage.setNamespace(namespace);
	}

	public dset(index: number, value: number): void {
		this.storage.setValue(index, value);
	}

	public dget(index: number): number {
		return this.storage.getValue(index);
	}

	public sfx(id: string, options?: AudioPlayOptions): void {
		$.playaudio(id, options);
	}

	public stop_sfx(): void {
		$.sndmaster.stopEffect();
	}

	public music(id: string | null, options?: AudioPlayOptions): void {
		if (!id) {
			$.sndmaster.stopMusic();
			return;
		}
		$.sndmaster.stopMusic();
		void $.sndmaster.play(id, options as SoundMasterPlayRequest | ModulationParams | RandomModulationParams | undefined);
	}

	public stop_music(): void {
		$.sndmaster.stopMusic();
	}

	public set_master_volume(volume: number): void {
		$.sndmaster.volume = volume;
	}

	public pause_audio(): void {
		$.sndmaster.pause();
	}

	public resume_audio(): void {
		$.sndmaster.resume();
	}

	public world(): World {
		return $.world;
	}

	public world_object(id: Identifier): WorldObject | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] world_object id must be a non-empty string.');
		}
		return $.world.getFromCurrentSpace(id);
	}

	public world_objects(): WorldObject[] {
		return $.world.allObjectsFromSpaces;
	}

	public spawn_world_object(class_ref: string, options?: Record<string, unknown>): string {
		const rawOptions = options ? this.clone_state_machine_data(options) : {};
		if (rawOptions && !this.is_plain_object(rawOptions)) {
			throw new Error('[BmsxConsoleApi] spawn_world_object options must be a table/object.');
		}
		const normalized = this.normalize_spawn_options(rawOptions as Record<string, unknown>);
		const runtime = BmsxConsoleRuntime.instance;
		if (runtime) {
			runtime.applyConsoleWorldObjectDefaults(class_ref, normalized);
		}
		const ctor = this.resolve_world_object_constructor(class_ref);
		if (normalized.id && $.world.exists(normalized.id)) {
			throw new Error(`[BmsxConsoleApi] World object '${normalized.id}' already exists.`);
		}
		const ctorOptions: RevivableObjectArgs & { id?: string; fsm_id?: string } = {};
		if (normalized.id) ctorOptions.id = normalized.id;
		const instance = new ctor(ctorOptions);
		this.apply_spawn_orientation(instance, normalized);
		const componentDescriptors = runtime
			? runtime.materializeComponentEntries(normalized.components)
			: this.materialize_component_entries_fallback(normalized.components);
		this.attach_spawn_components(instance, componentDescriptors);
		if (runtime) {
			runtime.primeLuaWorldObjectInstance(instance, normalized);
		}
		const spawnPos = normalized.position ? new_vec3(normalized.position.x, normalized.position.y, normalized.position.z) : undefined;
		if (normalized.space) {
			const space = this.lookup_space(normalized.space);
			const reasonOpts = normalized.reason ? { reason: normalized.reason } : undefined;
			space.spawn(instance, spawnPos, reasonOpts);
		} else {
			const reasonOpts = normalized.reason ? { reason: normalized.reason } : undefined;
			$.world.spawn(instance, spawnPos, reasonOpts);
		}
		if (runtime) {
			runtime.onConsoleWorldObjectSpawned(instance);
		}
		return instance.id;
	}

	public spawn_object(definition_id: string, overrides?: Record<string, unknown>): string {
		if (typeof definition_id !== 'string' || definition_id.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] spawn_object requires a non-empty definition id.');
		}
		const runtime = this.require_console_runtime();
		const definition = runtime.getWorldObjectDefinition(definition_id.trim());
		if (!definition) {
			throw new Error(`[BmsxConsoleApi] World object definition '${definition_id}' is not registered.`);
		}
		const overridesClone = overrides ? this.clone_state_machine_data(overrides) : {};
		if (overridesClone && !this.is_plain_object(overridesClone)) {
			throw new Error('[BmsxConsoleApi] spawn_object overrides must be a table/object.');
		}
		return this.spawn_world_object(definition.class_ref, overridesClone as Record<string, unknown>);
	}

	public despawn(id: Identifier, options?: { dispose?: boolean }): void {
		const object = this.require_world_object(id, 'despawn');
		$.exile(object);
		if (options && options.dispose === true) {
			object.dispose();
		}
	}

	public attach_fsm(object_id: Identifier, machine_id: Identifier): void {
		const object = this.require_world_object(object_id, 'attach_fsm');
		object.sc.ensureStatemachine(machine_id, object.id);
	}

	public attach_bt(object_id: Identifier, tree_id: BehaviorTreeID): void {
		const trimmed = typeof tree_id === 'string' ? tree_id.trim() : '';
		if (trimmed.length === 0) {
			throw new Error('[BmsxConsoleApi] attach_bt requires a non-empty behavior tree id.');
		}
		if (!behaviorTreeExists(trimmed)) {
			throw new Error(`[BmsxConsoleApi] Behavior tree '${trimmed}' is not registered.`);
		}
		const object = this.require_world_object(object_id, 'attach_bt');
		const ctor = object.constructor as ConstructorWithBTProperty;
		if (Object.prototype.hasOwnProperty.call(ctor, 'linkedBTs')) {
			const linked = ctor.linkedBTs ?? new Set<BehaviorTreeID>();
			if (!linked.has(trimmed)) {
				const next = new Set(linked);
				next.add(trimmed);
				ctor.linkedBTs = next;
			}
		}
		const contexts = (object as { btreecontexts?: Record<string, BehaviorTreeContext> }).btreecontexts;
		if (contexts && !contexts[trimmed]) {
			contexts[trimmed] = {
				tree_id: trimmed,
				running: true,
				root: instantiateBehaviorTree(trimmed),
				blackboard: new Blackboard({ id: trimmed }),
			};
		}
	}

	public register_component(descriptor: Record<string, unknown>): string {
		const runtime = this.require_console_runtime();
		return runtime.registerComponentDefinition(descriptor);
	}

	public define_component(descriptor: Record<string, unknown>): string {
		return this.register_component(descriptor);
	}

	public register_component_preset(descriptor: Record<string, unknown>): string {
		const runtime = this.require_console_runtime();
		return runtime.registerComponentPreset(descriptor);
	}

	public define_component_preset(descriptor: Record<string, unknown>): string {
		return this.register_component_preset(descriptor);
	}

	public register_world_object(descriptor: Record<string, unknown>): string {
		const runtime = this.require_console_runtime();
		return runtime.registerWorldObjectDefinition(descriptor);
	}

	public register_service(descriptor: Record<string, unknown>): Record<string, unknown> {
		const runtime = this.require_console_runtime();
		return runtime.registerServiceDefinition(descriptor);
	}

	public define_service(descriptor: Record<string, unknown>): Record<string, unknown> {
		return this.register_service(descriptor);
	}

	public attach_component(object_id: Identifier, component: string | { id: string; id_local?: string; state?: Record<string, unknown> }): string {
		const runtime = this.require_console_runtime();
		const object = this.require_world_object(object_id, 'attach_component');
		const options = typeof component === 'string' ? { id: component } : (component ?? {});
		const rawId = (options as { id?: unknown }).id;
		if (typeof rawId !== 'string' || rawId.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] attach_component requires an id field.');
		}
		const definition_id = rawId.trim();
		const id_local = (options as { id_local?: string }).id_local;
		const stateRaw = (options as { state?: unknown }).state;
		let state: Record<string, unknown> | undefined;
		if (stateRaw !== undefined) {
			if (!this.is_plain_object(stateRaw)) {
				throw new Error('[BmsxConsoleApi] attach_component state must be a table/object.');
			}
			state = this.clone_state_machine_data(stateRaw as Record<string, unknown>);
		}
		if (state && !this.is_plain_object(state)) {
			throw new Error('[BmsxConsoleApi] attach_component state must be a plain object.');
		}
		const instance = runtime.createComponentInstance({
			definition_id,
			parent_id: object.id,
			id_local,
			state,
		});
		if (instance.isUniqueDefinition) {
			const existing = object.get_components(LuaComponent);
			if (existing.some(entry => entry.definition_id === definition_id)) {
				throw new Error(`[BmsxConsoleApi] Lua component '${definition_id}' is marked unique and already attached to '${object_id}'.`);
			}
		}
		object.add_component(instance);
		return instance.id;
	}

	public register_effect(descriptor: ActionEffectDefinition): string {
		const runtime = this.require_console_runtime();
		const definition = runtime.registerEffectDefinition(descriptor);
		return definition.id;
	}

	public define_effect(descriptor: ActionEffectDefinition): string {
		return this.register_effect(descriptor);
	}

	public grant_effect(object_id: Identifier, effect_id: string): void {
		if (typeof effect_id !== 'string' || effect_id.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] grant_effect requires a non-empty effect id.');
		}
		const runtime = this.require_console_runtime();
		const object = this.require_world_object(object_id, 'grant_effect');
		const component = object.get_unique_component(ActionEffectComponent);
		if (!component) {
			throw new Error(`[BmsxConsoleApi] World object '${object_id}' does not have an ActionEffectComponent.`);
		}
		const definition = runtime.getEffectDefinition(effect_id.trim());
		if (!definition) {
			throw new Error(`[BmsxConsoleApi] Lua effect '${effect_id}' is not registered.`);
		}
		component.grant_effect(definition);
	}

	public trigger_effect(object_id: Identifier, effect_id: string, options?: { payload?: Record<string, unknown> }): boolean {
		if (typeof effect_id !== 'string' || effect_id.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] trigger_effect requires a non-empty effect id.');
		}
		const object = this.require_world_object(object_id, 'trigger_effect');
		const component = object.get_unique_component(ActionEffectComponent);
		if (!component) {
			throw new Error(`[BmsxConsoleApi] World object '${object_id}' does not have an ActionEffectComponent.`);
		}
		const trimmedId = effect_id.trim() as any;
		const payload = options?.payload as any;
		const result = payload !== undefined
			? component.trigger(trimmedId, { payload })
			: component.trigger(trimmedId);
		return result === 'ok';
	}

	public add_component(object_id: Identifier, component_ref: string, options?: Record<string, unknown>): string {
		const object = this.require_world_object(object_id, 'add_component');
		const rawOptions = options ? this.clone_state_machine_data(options) : {};
		if (rawOptions && !this.is_plain_object(rawOptions)) {
			throw new Error('[BmsxConsoleApi] add_component options must be a table/object.');
		}
		const descriptor: ConsoleComponentDescriptor = {
			className: component_ref,
			options: rawOptions as Record<string, unknown>,
		};
		const component = this.attach_component_by_descriptor(object, descriptor);
		return component.id;
	}

	public remove_component(object_id: Identifier, component_id: string): void {
		if (typeof component_id !== 'string' || component_id.length === 0) {
			throw new Error('[BmsxConsoleApi] remove_component component_id must be a non-empty string.');
		}
		const object = this.require_world_object(object_id, 'remove_component');
		const component = object.get_component_by_id(component_id);
		if (!component) {
			throw new Error(`[BmsxConsoleApi] Component '${component_id}' not found on object '${object_id}'.`);
		}
		component.dispose();
	}

	public registry(): Registry {
		return $.registry;
	}

	public registry_ids(): Identifier[] {
		return $.registry.getRegisteredEntityIds();
	}

	public rget(id: Identifier): Registerable | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] rget id must be a non-empty string.');
		}
		return $.registry.get(id);
	}

	public services(): Service[] {
		return Array.from($.registry.iterate(Service));
	}

	public service(id: Identifier): Service | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[BmsxConsoleApi] service id must be a non-empty string.');
		}
		return $.registry.get<Service>(id);
	}

	public game(): Game {
		return $;
	}

	public rompack(): RomPack | undefined {
		return $.rompack;
	}

	public events(): EventEmitter {
		return $.event_emitter;
	}

	private resolveEmitter(
		emitter_or_id: Identifier | Registerable | null | undefined,
		options?: { required?: boolean; context?: string }
	): Registerable | null {
		const context = options?.context ?? 'emit';
		if (emitter_or_id === undefined || emitter_or_id === null) {
			if (options?.required) {
				throw new Error(`[BmsxConsoleApi] ${context} requires a non-empty emitter or emitter id.`);
			}
			return null;
		}
		if (typeof emitter_or_id === 'string') {
			const emitter = $.registry.get(emitter_or_id);
			if (!emitter) {
				throw new Error(`[BmsxConsoleApi] Emitter '${emitter_or_id}' not found.`);
			}
			return emitter;
		}
		return emitter_or_id;
	}

	public emit(event_name: string, emitter_or_id?: Identifier | Registerable | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('[BmsxConsoleApi] emit requires a non-empty event name.');
		}
		const emitter = this.resolveEmitter(emitter_or_id);
		$.emit(event_name, emitter, payload);
	}

	public emit_gameplay(event_name: string, emitter_or_id: Identifier | Registerable | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('[BmsxConsoleApi] emit_gameplay requires a non-empty event name.');
		}
		const emitter = this.resolveEmitter(emitter_or_id, { required: true, context: 'emit_gameplay' });
		$.emit_gameplay(event_name, emitter as any, payload);
	}

	public timelines(): EventTimeline[] {
		return Array.from($.registry.iterate(EventTimeline));
	}

	public taskgate(name: string): GateGroup {
		return taskGate.group(name);
	}

	public rungate(): GateGroup {
		return runGate;
	}

	private require_console_runtime(): BmsxConsoleRuntime {
		return BmsxConsoleRuntime.instance!;
	}

	public register_prepared_fsm(id: string, blueprint: StateMachineBlueprint, options?: { setup?: boolean }): void {
		this.set_fsm_blueprint_factory(id, blueprint);
		if (!options || options.setup !== false) {
			setupFSMlibrary();
		}
	}

	public register_behavior_tree(descriptor: Record<string, unknown>): void {
		const runtime = this.require_console_runtime();
		runtime.registerBehaviorTreeDefinition(descriptor);
	}

	private set_fsm_blueprint_factory(id: string, blueprint: StateMachineBlueprint): void {
		const snapshot = this.clone_state_machine_data(blueprint);
		StateDefinitionBuilders[id] = () => this.clone_state_machine_data(snapshot);
	}

	private resolve_world_object_constructor(class_ref: string): new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject {
		return this.resolve_constructor(class_ref.trim()) as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
	}

	private resolve_component_constructor(class_ref: string): new (opts: Record<string, unknown>) => Component {
		return this.resolve_constructor(class_ref.trim()) as new (opts: Record<string, unknown>) => Component;
	}

	private resolve_constructor(ref: string): unknown {
		const map = Reviver.constructors;
		return map?.[ref] ?? (globalThis as Record<string, unknown>)[ref];
	}

	private normalize_spawn_options(raw: Record<string, unknown>): NormalizedSpawnOptions {
		const normalized: NormalizedSpawnOptions = {
			id: undefined,
			space: undefined,
			reason: undefined,
			position: null,
			orientation: null,
			scale: null,
			components: [],
			fsms: [],
			behavior_trees: [],
			effects: [],
			tags: [],
			defaults: undefined,
		};
		if (typeof raw.id === 'string') {
			const trimmed = raw.id.trim();
			if (trimmed.length === 0) {
				throw new Error('[BmsxConsoleApi] spawn_world_object options.id must be a non-empty string.');
			}
			normalized.id = trimmed;
		}
		const fsmsRaw = raw.fsms;
		if (fsmsRaw !== undefined) {
			normalized.fsms = this.normalize_spawn_system_entries(fsmsRaw, 'fsms', false);
		}
		if (raw.space !== undefined) {
			if (typeof raw.space !== 'string' || raw.space.trim().length === 0) {
				throw new Error('[BmsxConsoleApi] spawn_world_object options.space must be a non-empty string when provided.');
			}
			normalized.space = raw.space.trim();
		}
		if (raw.reason !== undefined) {
			if (typeof raw.reason !== 'string' || raw.reason.trim().length === 0) {
				throw new Error('[BmsxConsoleApi] spawn_world_object options.reason must be a non-empty string when provided.');
			}
			const reason = raw.reason.trim();
			if (reason !== 'fresh' && reason !== 'transfer' && reason !== 'revive') {
				throw new Error('[BmsxConsoleApi] spawn_world_object options.reason must be one of fresh, transfer, or revive.');
			}
			normalized.reason = reason as SpawnReason;
		}
		if (raw.position !== undefined) {
			normalized.position = this.normalize_vector3(raw.position, 0);
		}
		const orientationSource = raw.rotation !== undefined ? raw.rotation : raw.orientation;
		if (orientationSource !== undefined) {
			normalized.orientation = this.normalize_vector3(orientationSource, 0);
		}
		if (raw.scale !== undefined) {
			normalized.scale = this.normalize_vector3(raw.scale, 1);
		}
		if (raw.components !== undefined) {
			normalized.components = this.normalize_spawn_component_entries(raw.components);
		}

		const behaviorTreesRaw = raw.behavior_trees;
		if (behaviorTreesRaw !== undefined) {
			normalized.behavior_trees = this.normalize_spawn_system_entries(behaviorTreesRaw, 'behavior trees', true);
		}

		if (raw.effects !== undefined) {
			normalized.effects = this.normalize_string_list(raw.effects);
		}
		if (raw.tags !== undefined) {
			normalized.tags = this.normalize_string_list(raw.tags);
		}
		if (raw.defaults !== undefined) {
			if (!this.is_plain_object(raw.defaults)) {
				throw new Error('[BmsxConsoleApi] spawn_world_object defaults must be a table/object.');
			}
			normalized.defaults = this.clone_state_machine_data(raw.defaults as Record<string, unknown>);
		}
		return normalized;
	}

	private normalize_vector3(source: unknown, defaultValue: number): { x: number; y: number; z: number } {
		const table = source as { x?: number; y?: number; z?: number };
		return {
			x: table.x ?? defaultValue,
			y: table.y ?? defaultValue,
			z: table.z ?? defaultValue,
		};
	}

	private normalize_spawn_component_entries(raw: unknown): ConsoleWorldObjectComponentEntry[] {
		if (!Array.isArray(raw)) {
			throw new Error('[BmsxConsoleApi] spawn_world_object options.components must be an array.');
		}
		const entries: ConsoleWorldObjectComponentEntry[] = [];
		for (let index = 0; index < raw.length; index += 1) {
			const entry = raw[index];
			if (typeof entry === 'string') {
				const trimmed = entry.trim();
				if (trimmed.length === 0) {
					throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] must be a non-empty string.`);
				}
				entries.push({ kind: 'component', descriptor: { classname: trimmed, options: {} } });
				continue;
			}
			if (!this.is_plain_object(entry)) {
				throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] must be a string or table/object.`);
			}
			const record = entry as Record<string, unknown>;
			const preset = record.preset;
			if (typeof preset === 'string') {
				const paramsRaw = record.params;
				let params: Record<string, unknown> = {};
				if (paramsRaw !== undefined) {
					params = this.clone_state_machine_data(paramsRaw as Record<string, unknown>);
				}
				entries.push({ kind: 'preset', presetId: preset, params });
				continue;
			}
			const classCandidate = record.class ?? record.className ?? record.type ?? record.name;
			if (typeof classCandidate !== 'string' || classCandidate.trim().length === 0) {
				throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] requires a non-empty 'class' field.`);
			}
			let options: Record<string, unknown>;
			if (record.options !== undefined) {
				if (!this.is_plain_object(record.options)) {
					throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}].options must be a table/object.`);
				}
				options = this.clone_state_machine_data(record.options as Record<string, unknown>);
			} else {
				const clone = this.clone_state_machine_data(record);
				delete clone.class;
				delete clone.className;
				delete clone.type;
				delete clone.name;
				delete clone.preset;
				delete clone.params;
				delete clone.options;
				options = clone;
			}
			entries.push({ kind: 'component', descriptor: { classname: classCandidate.trim(), options } });
		}
		return entries;
	}

	private normalize_spawn_system_entries(raw: unknown, label: string, allowAutoTick: boolean): ConsoleWorldObjectSystemEntry[] {
		if (raw === undefined || raw === null) {
			return [];
		}
		const entries: ConsoleWorldObjectSystemEntry[] = [];
		const push = (value: Record<string, unknown>, indexLabel: string) => {
			const idCandidate = value.id;
			if (typeof idCandidate !== 'string' || idCandidate.trim().length === 0) {
				throw new Error(`[BmsxConsoleApi] ${label} entry ${indexLabel} is missing a valid id.`);
			}
			const entry: ConsoleWorldObjectSystemEntry = { id: idCandidate.trim() };
			const contextCandidate = value.context;
			if (typeof contextCandidate === 'string' && contextCandidate.trim().length > 0) {
				entry.context = contextCandidate.trim();
			}
			if (allowAutoTick) {
				const autoCandidate = value.auto_tick;
				if (typeof autoCandidate === 'boolean') {
					entry.auto_tick = autoCandidate;
				}
			}
			const activeCandidate = value.active;
			if (typeof activeCandidate === 'boolean') {
				entry.active = activeCandidate;
			}
			entries.push(entry);
		};
		if (typeof raw === 'string') {
			const trimmed = raw.trim();
			if (trimmed.length === 0) {
				throw new Error(`[BmsxConsoleApi] ${label} string entries must not be empty.`);
			}
			entries.push({ id: trimmed });
			return entries;
		}
		if (Array.isArray(raw)) {
			for (let index = 0; index < raw.length; index += 1) {
				const value = raw[index];
				if (typeof value === 'string') {
					const trimmed = value.trim();
					if (trimmed.length === 0) {
						throw new Error(`[BmsxConsoleApi] ${label}[${index}] must not be empty.`);
					}
					entries.push({ id: trimmed });
					continue;
				}
				if (!this.is_plain_object(value)) {
					throw new Error(`[BmsxConsoleApi] ${label}[${index}] must be a string or table/object.`);
				}
				push(value as Record<string, unknown>, `[${index}]`);
			}
			return entries;
		}
		if (this.is_plain_object(raw)) {
			push(raw as Record<string, unknown>, '');
			return entries;
		}
		throw new Error(`[BmsxConsoleApi] ${label} must be provided as a string, table, or array.`);
	}

	private normalize_string_list(value: unknown): string[] {
		if (value === undefined || value === null) {
			return [];
		}
		if (typeof value === 'string') {
			const trimmed = value.trim();
			return trimmed.length > 0 ? [trimmed] : [];
		}
		if (!Array.isArray(value)) {
			throw new Error('[BmsxConsoleApi] Expected a string or array of strings.');
		}
		const result: string[] = [];
		for (let index = 0; index < value.length; index += 1) {
			const entry = value[index];
			if (typeof entry !== 'string') {
				continue;
			}
			const trimmed = entry.trim();
			if (trimmed.length > 0) {
				result.push(trimmed);
			}
		}
		return result;
	}

	private apply_spawn_orientation(instance: WorldObject, options: NormalizedSpawnOptions): void {
		if (options.orientation) {
			instance.orientation = new_vec3(options.orientation.x, options.orientation.y, options.orientation.z);
		}
		if (options.scale) {
			instance.sx = options.scale.x;
			instance.sy = options.scale.y;
			instance.sz = options.scale.z;
		}
	}

	private attach_spawn_components(object: WorldObject, descriptors: ConsoleComponentDescriptor[]): void {
		for (let index = 0; index < descriptors.length; index += 1) {
			this.attach_component_by_descriptor(object, descriptors[index]);
		}
	}

	private materialize_component_entries_fallback(entries: ReadonlyArray<ConsoleWorldObjectComponentEntry>): ConsoleComponentDescriptor[] {
		const descriptors: ConsoleComponentDescriptor[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]!;
			if (entry.kind === 'preset') {
				throw new Error('[BmsxConsoleApi] Component presets require the console runtime to be active.');
			}
			descriptors.push({
				className: entry.descriptor.classname,
				options: this.clone_state_machine_data(entry.descriptor.options),
			});
		}
		return descriptors;
	}

	private attach_component_by_descriptor(object: WorldObject, descriptor: ConsoleComponentDescriptor): Component {
		const ctor = this.resolve_component_constructor(descriptor.className);
		const optionsClone = this.clone_state_machine_data(descriptor.options);
		if (optionsClone && !this.is_plain_object(optionsClone)) {
			throw new Error('[BmsxConsoleApi] Component options must be a table/object.');
		}
		const prepared = optionsClone ? { ...optionsClone } : {};
		const parentField = (prepared as { parentid?: string }).parentid;
		if (parentField !== undefined && parentField !== object.id) {
			throw new Error('[BmsxConsoleApi] Component options cannot override parent assignment.');
		}
		delete (prepared as { parentid?: string }).parentid;
		(prepared as { parent_or_id: WorldObject }).parent_or_id = object;
		const component = new ctor(prepared);
		object.add_component(component);
		return component;
	}

	private lookup_space(spaceId: string): Space {
		const space = $.world.getSpace(spaceId);
		if (!space) {
			throw new Error(`[BmsxConsoleApi] Space '${spaceId}' not found.`);
		}
		return space;
	}

	private require_world_object(id: Identifier, context: string): WorldObject {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error(`[BmsxConsoleApi] ${context} requires a non-empty object id.`);
		}
		const object = $.world.getWorldObject<WorldObject>(id);
		if (!object) {
			throw new Error(`[BmsxConsoleApi] World object '${id}' not found.`);
		}
		return object;
	}

	private is_plain_object(value: unknown): value is Record<string, unknown> {
		if (value === null) return false;
		if (typeof value !== 'object') return false;
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	private clone_state_machine_data<T>(source: T): T {
		// Preserve function handlers on FSM blueprints (JSON stringify would drop them).
		return deep_clone(source);
	}

	private pointer_viewport_position_internal(): ConsolePointerViewport {
		const screen = this.pointer_screen_position();
		if (!screen.valid) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const view = $.view;
		if (!view) {
			throw new Error('[BmsxConsoleApi] Game view not initialised.');
		}
		const rect = view.surface.measureDisplay();
		const width = rect.width;
		const height = rect.height;
		if (width <= 0 || height <= 0) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const relativeX = screen.x - rect.left;
		const relativeY = screen.y - rect.top;
		const inside = relativeX >= 0 && relativeX < width && relativeY >= 0 && relativeY < height;
		const viewportX = (relativeX / width) * this.display_width;
		const viewportY = (relativeY / height) * this.display_height;
		return { x: viewportX, y: viewportY, valid: true, inside };
	}

	private compute_pointer_button_mask(): number {
		let mask = 0;
		if (this.mousebtn(BmsxConsolePointerButton.Primary)) {
			mask |= 1;
		}
		if (this.mousebtn(BmsxConsolePointerButton.Secondary)) {
			mask |= 2;
		}
		if (this.mousebtn(BmsxConsolePointerButton.Auxiliary)) {
			mask |= 4;
		}
		if (this.mousebtn(BmsxConsolePointerButton.Back)) {
			mask |= 8;
		}
		if (this.mousebtn(BmsxConsolePointerButton.Forward)) {
			mask |= 16;
		}
		return mask;
	}

	private expand_tabs(text: string): string {
		if (text.indexOf('\t') === -1) {
			return text;
		}
		let result = '';
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				for (let j = 0; j < CONSOLE_TAB_SPACES; j++) {
					result += ' ';
				}
			} else {
				result += ch;
			}
		}
		return result;
	}


	private palette_color(index: number): color {
		if (!Number.isInteger(index)) {
			throw new Error('[BmsxConsoleApi] Color index must be an integer.');
		}
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`[BmsxConsoleApi] Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}

	private resolve_write_context(font: ConsoleFont, x: number, y: number, colorindex: number | undefined): {
		baseX: number;
		baseY: number;
		color: color;
		autoAdvance: boolean;
		font: ConsoleFont;
	} {
		const hasExplicitPosition = x !== undefined && y !== undefined;
		if (hasExplicitPosition) {
			this.textCursorHomeX = x;
			this.textCursorX = this.textCursorHomeX;
			this.textCursorY = y;
		}
		if (colorindex) {
			this.textCursorColorIndex = colorindex;
		}
		const baseX = this.textCursorX;
		const baseY = this.textCursorY;
		const color = this.palette_color(this.textCursorColorIndex);
		return { baseX, baseY, color, autoAdvance: true, font };
	}

	private draw_multiline_text(text: string, x: number, y: number, color: color, font: ConsoleFont): number {
		const lines = text.split('\n');
		let cursorY = y;
		for (let i = 0; i < lines.length; i += 1) {
			const expanded = this.expand_tabs(lines[i]);
			if (expanded.length > 0) {
				this.renderBackend.drawText({ kind: 'print', text: expanded, x, y: cursorY, color }, font);
			}
			if (i < lines.length - 1) {
				cursorY += font.lineHeight();
			}
		}
		this.textCursorX = this.textCursorHomeX;
		this.textCursorY = cursorY;
		return cursorY;
	}

	private advance_print_cursor(lineHeight: number): void {
		this.textCursorY += lineHeight;
		const limit = this.display_height - lineHeight;
		if (this.textCursorY >= limit) {
			this.textCursorY = 0;
		}
	}

	private reset_print_cursor(): void {
		this.textCursorHomeX = 0;
		this.textCursorX = 0;
		this.textCursorY = 0;
		this.textCursorColorIndex = this.defaultPrintColorIndex;
	}
}
