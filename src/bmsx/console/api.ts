import { $, $rompack, runGate } from '../core/game';
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
import { DirectConsoleRenderBackend, type ConsoleRenderBackend } from './render_backend';
import { new_vec3 } from '../utils/vector_operations';
import { id_to_space_symbol, type Space } from '../core/space';
import { Reviver } from '../serializer/gameserializer';
import type { RevivableObjectArgs } from '../serializer/serializationhooks';
import { Component } from '../component/basecomponent';
import { LuaComponent } from '../component/lua_component';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { BmsxConsoleRuntime } from './runtime';
import type { ConsoleWorldObjectComponentEntry, ConsoleWorldObjectSystemEntry, ConsoleWorldObjectSpawnOptions } from './runtime';
import { instantiateBehaviorTree, behaviorTreeExists, Blackboard, type BehaviorTreeID, type BehaviorTreeContext, type ConstructorWithBTProperty } from '../ai/behaviourtree';

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
	private frameIndex: number = 0;
	private deltaSecondsValue: number = 0;
	private renderBackend: ConsoleRenderBackend = new DirectConsoleRenderBackend();

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
		this.resetPrintCursor();
	}

	public set_render_backend(backend: ConsoleRenderBackend | null): void {
		this.renderBackend = backend ?? new DirectConsoleRenderBackend();
	}

	public begin_frame(frame: number, deltaSeconds: number): void {
		if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
			throw new Error('[BmsxConsoleApi] Delta seconds must be a finite non-negative number.');
		}
		this.frameIndex = frame;
		this.deltaSecondsValue = deltaSeconds;
		this.renderBackend.beginFrame();
	}

	public begin_paused_frame(frame: number): void {
		this.frameIndex = frame;
		this.deltaSecondsValue = 0;
		this.renderBackend.beginFrame();
	}

	public end_frame(): void {
		this.renderBackend.endFrame();
	}

	public frame_number(): number {
		return this.frameIndex;
	}

	public delta_seconds(): number {
		return this.deltaSecondsValue;
	}

	public get display_width(): number {
		return $.view.viewportSize.x;
	}

	public get display_height(): number {
		return $.view.viewportSize.y;
	}

	public mousebtn(button: BmsxConsolePointerButton): boolean {
		const state = this.getPlayerInput().getActionState(this.pointerAction(button));
		return state.pressed;
	}

	public mousebtnp(button: BmsxConsolePointerButton): boolean {
		const state = this.getPlayerInput().getActionState(this.pointerAction(button));
		return state.guardedjustpressed;
	}

	public mousebtnr(button: BmsxConsolePointerButton): boolean {
		const state = this.getPlayerInput().getActionState(this.pointerAction(button));
		return state.justreleased;
	}

	private getPlayerInput(): PlayerInput {
		const playerInput = Input.instance.getPlayerInput(this.playerindex);
		if (!playerInput) {
			throw new Error(`[BmsxConsoleApi] Player input handler for index ${this.playerindex} is not initialised.`);
		}
		return playerInput;
	}

	private pointerAction(button: BmsxConsolePointerButton): string {
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
		const state = this.getPlayerInput().getActionState('pointer_position');
		const coords = state.value2d;
		if (!coords) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: coords[0], y: coords[1], valid: true };
	}

	public pointer_delta(): ConsolePointerVector {
		const state = this.getPlayerInput().getActionState('pointer_delta');
		const delta = state.value2d;
		if (!delta) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: delta[0], y: delta[1], valid: true };
	}

	public pointer_viewport_position(): ConsolePointerViewport {
		return this.pointerViewportPositionInternal();
	}

	public mousewheel(): ConsolePointerWheel {
		const state = this.getPlayerInput().getActionState('pointer_wheel');
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
				const viewport = this.pointerViewportPositionInternal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.x);
			}
			case 33: {
				const viewport = this.pointerViewportPositionInternal();
				if (!viewport.valid) {
					return 0;
				}
				return Math.floor(viewport.y);
			}
		case 34: {
			return this.computePointerButtonMask();
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
		const color = this.paletteColor(colorindex);
		this.renderBackend.drawRect({
			kind: 'fill',
			x0: 0,
			y0: 0,
			x1: this.display_width,
			y1: this.display_height,
			color,
			layer: DRAW_LAYER,
		});
		this.resetPrintCursor();
	}

	public rect(x0: number, y0: number, x1: number, y1: number, colorindex: number): void {
		this.renderBackend.drawRect({ kind: 'rect', x0, y0, x1, y1, color: this.paletteColor(colorindex), layer: DRAW_LAYER });
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, colorindex: number): void {
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: this.paletteColor(colorindex), layer: DRAW_LAYER });
	}

	public rectfill_color(x0: number, y0: number, x1: number, y1: number, colorvalue: color): void {
		this.renderBackend.drawRect({ kind: 'fill', x0, y0, x1, y1, color: colorvalue, layer: DRAW_LAYER });
	}

	public write(text: string, x?: number, y?: number, colorindex?: number): void {
		const { baseX, baseY, color, font, autoAdvance } = this.resolveWriteContext(this.font, x, y, colorindex);
		this.drawMultilineText(text, baseX, baseY, color, font);
		if (autoAdvance) {
			this.advancePrintCursor(font.lineHeight());
		}
	}

	public write_with_font(text: string, x?: number, y?: number, colorindex?: number, font?: ConsoleFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolveWriteContext(renderFont, x, y, colorindex);
		this.drawMultilineText(text, baseX, baseY, color, renderFont);
		if (autoAdvance) {
			this.advancePrintCursor(renderFont.lineHeight());
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
		const rawOptions = options ? this.cloneStateMachineData(options) : {};
		if (rawOptions && !this.isPlainObject(rawOptions)) {
			throw new Error('[BmsxConsoleApi] spawn_world_object options must be a table/object.');
		}
		const normalized = this.normalizeSpawnOptions(rawOptions as Record<string, unknown>);
		const runtime = BmsxConsoleRuntime.instance;
		if (runtime) {
			runtime.applyConsoleWorldObjectDefaults(class_ref, normalized);
		}
		const ctor = this.resolveWorldObjectConstructor(class_ref);
		if (normalized.id && $.world.exists(normalized.id)) {
			throw new Error(`[BmsxConsoleApi] World object '${normalized.id}' already exists.`);
		}
		const ctorOptions: RevivableObjectArgs & { id?: string; fsm_id?: string } = {};
		if (normalized.id) ctorOptions.id = normalized.id;
		const instance = new ctor(ctorOptions);
		this.applySpawnOrientation(instance, normalized);
		const componentDescriptors = runtime
			? runtime.materializeComponentEntries(normalized.components)
			: this.materializeComponentEntriesFallback(normalized.components);
		this.attachSpawnComponents(instance, componentDescriptors);
		if (runtime) {
			runtime.primeLuaWorldObjectInstance(instance, normalized);
		}
		const spawnPos = normalized.position ? new_vec3(normalized.position.x, normalized.position.y, normalized.position.z) : undefined;
		if (normalized.space) {
			const space = this.lookupSpace(normalized.space);
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
		const runtime = this.requireConsoleRuntime('spawn_object');
		const definition = runtime.getWorldObjectDefinition(definition_id.trim());
		if (!definition) {
			throw new Error(`[BmsxConsoleApi] World object definition '${definition_id}' is not registered.`);
		}
		const overridesClone = overrides ? this.cloneStateMachineData(overrides) : {};
		if (overridesClone && !this.isPlainObject(overridesClone)) {
			throw new Error('[BmsxConsoleApi] spawn_object overrides must be a table/object.');
		}
		return this.spawn_world_object(definition.class_ref, overridesClone as Record<string, unknown>);
	}

	public despawn(id: Identifier, options?: { dispose?: boolean }): void {
		const object = this.requireWorldObject(id, 'despawn');
		$.exile(object);
		if (options && options.dispose === true) {
			object.dispose();
		}
	}

	public attach_fsm(object_id: Identifier, machine_id: Identifier): void {
		const object = this.requireWorldObject(object_id, 'attach_fsm');
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
		const object = this.requireWorldObject(object_id, 'attach_bt');
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
		const runtime = this.requireConsoleRuntime('register_component');
		return runtime.registerComponentDefinition(descriptor);
	}

	public define_component(descriptor: Record<string, unknown>): string {
		return this.register_component(descriptor);
	}

	public register_component_preset(descriptor: Record<string, unknown>): string {
		const runtime = this.requireConsoleRuntime('register_component_preset');
		return runtime.registerComponentPreset(descriptor);
	}

	public define_component_preset(descriptor: Record<string, unknown>): string {
		return this.register_component_preset(descriptor);
	}

	public register_worldobject(descriptor: Record<string, unknown>): string {
		const runtime = this.requireConsoleRuntime('register_worldobject');
		return runtime.registerWorldObjectDefinition(descriptor);
	}

	public register_service(descriptor: Record<string, unknown>): Record<string, unknown> {
		const runtime = this.requireConsoleRuntime('register_service');
		return runtime.registerServiceDefinition(descriptor);
	}

	public define_service(descriptor: Record<string, unknown>): Record<string, unknown> {
		return this.register_service(descriptor);
	}

	public attach_component(object_id: Identifier, component: string | { id: string; id_local?: string; state?: Record<string, unknown> }): string {
		const runtime = this.requireConsoleRuntime('attach_component');
		const object = this.requireWorldObject(object_id, 'attach_component');
		const options = typeof component === 'string' ? { id: component } : (component ?? {});
		const rawId = (options as { id?: unknown }).id;
		if (typeof rawId !== 'string' || rawId.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] attach_component requires an id field.');
		}
		const definition_id = rawId.trim();
		const idLocalRaw = (options as { id_local?: unknown }).id_local;
		const id_local = typeof idLocalRaw === 'string' && idLocalRaw.trim().length > 0 ? idLocalRaw.trim() : undefined;
		const stateRaw = (options as { state?: unknown }).state;
		let state: Record<string, unknown> | undefined;
		if (stateRaw !== undefined) {
			if (!this.isPlainObject(stateRaw)) {
				throw new Error('[BmsxConsoleApi] attach_component state must be a table/object.');
			}
			state = this.cloneStateMachineData(stateRaw as Record<string, unknown>);
		}
		if (state && !this.isPlainObject(state)) {
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

	public register_ability(descriptor: Record<string, unknown>): string {
		const runtime = this.requireConsoleRuntime('register_ability');
		const definition = runtime.registerAbilityDefinition(descriptor);
		return definition.id;
	}

	public define_ability(descriptor: Record<string, unknown>): string {
		return this.register_ability(descriptor);
	}

	public grant_ability(object_id: Identifier, ability_id: string): void {
		if (typeof ability_id !== 'string' || ability_id.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] grant_ability requires a non-empty ability id.');
		}
		const runtime = this.requireConsoleRuntime('grant_ability');
		const object = this.requireWorldObject(object_id, 'grant_ability');
		const asc = object.get_unique_component(AbilitySystemComponent);
		if (!asc) {
			throw new Error(`[BmsxConsoleApi] World object '${object_id}' does not have an AbilitySystemComponent.`);
		}
		const definition = runtime.getAbilityDefinition(ability_id.trim());
		if (!definition) {
			throw new Error(`[BmsxConsoleApi] Lua ability '${ability_id}' is not registered.`);
		}
		asc.grant_ability(definition);
	}

	public request_ability(object_id: Identifier, ability_id: string, options?: { payload?: Record<string, unknown>; source?: Identifier | null }): boolean {
		if (typeof ability_id !== 'string' || ability_id.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] request_ability requires a non-empty ability id.');
		}
		const object = this.requireWorldObject(object_id, 'request_ability');
		const asc = object.get_unique_component(AbilitySystemComponent);
		if (!asc) {
			throw new Error(`[BmsxConsoleApi] World object '${object_id}' does not have an AbilitySystemComponent.`);
		}
		const trimmedId = ability_id.trim() as any;
		const payload = options?.payload as any;
		const result = payload !== undefined
			? asc.request_ability(trimmedId, { payload })
			: asc.request_ability(trimmedId);
		return result.ok === true;
	}

	public add_component(object_id: Identifier, component_ref: string, options?: Record<string, unknown>): string {
		const object = this.requireWorldObject(object_id, 'add_component');
		const rawOptions = options ? this.cloneStateMachineData(options) : {};
		if (rawOptions && !this.isPlainObject(rawOptions)) {
			throw new Error('[BmsxConsoleApi] add_component options must be a table/object.');
		}
		const descriptor: ConsoleComponentDescriptor = {
			className: component_ref,
			options: rawOptions as Record<string, unknown>,
		};
		const component = this.attachComponentByDescriptor(object, descriptor);
		return component.id;
	}

	public remove_component(object_id: Identifier, component_id: string): void {
		if (typeof component_id !== 'string' || component_id.length === 0) {
			throw new Error('[BmsxConsoleApi] remove_component component_id must be a non-empty string.');
		}
		const object = this.requireWorldObject(object_id, 'remove_component');
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
		return $rompack;
	}

	public events(): EventEmitter {
		return $.event_emitter;
	}

	private getEmitter(emitter_or_id: Identifier | null): Registerable | null {
		if (typeof emitter_or_id === 'string') {
			return $.registry.get(emitter_or_id);
		}
		return emitter_or_id;
	}

	private validateEmitter(emitter_or_id: Identifier | Registerable, emitter?: Registerable): void {
		if (emitter_or_id && !emitter) {
			throw new Error(`[BmsxConsoleApi] Emitter '${emitter_or_id}' not found.`);
		}
		if (!emitter_or_id) throw new Error('[BmsxConsoleApi] emit requires a non-empty emitter or emitter id.');
	}

	public emit(event_name: string, emitter_or_id?: Identifier, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('[BmsxConsoleApi] emit requires a non-empty event name.');
		}
		const emitter: Registerable | null = this.getEmitter(emitter_or_id);
		this.validateEmitter(emitter_or_id, emitter);
		$.emit(event_name, emitter, payload);
	}

	public emit_gameplay(event_name: string, emitter_or_id: Identifier | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('[BmsxConsoleApi] emit_gameplay requires a non-empty event name.');
		}
		const emitter = this.getEmitter(emitter_or_id);
		this.validateEmitter(emitter_or_id, emitter);
		$.emit_gameplay(event_name, emitter as any, payload);
	}

	public emit_presentation(event_name: string, emitter_or_id: Identifier | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('[BmsxConsoleApi] emit_presentation requires a non-empty event name.');
		}
		const emitter = this.getEmitter(emitter_or_id);
		this.validateEmitter(emitter_or_id, emitter);
		$.emit_presentation(event_name, emitter, payload);
	}

	public timelines(): EventTimeline[] {
		return Array.from($.registry.iterate(EventTimeline));
	}

	public taskgate(name: string): GateGroup {
		if (typeof name !== 'string' || name.length === 0) {
			throw new Error('[BmsxConsoleApi] taskgate requires a non-empty group name.');
		}
		return taskGate.group(name);
	}

	public rungate(): GateGroup {
		return runGate;
	}

	private requireConsoleRuntime(context: string): BmsxConsoleRuntime {
		const runtime = BmsxConsoleRuntime.instance;
		if (!runtime) {
			throw new Error(`[BmsxConsoleApi] ${context} requires the console runtime to be active.`);
		}
		return runtime;
	}

	public register_fsm(blueprint: Record<string, unknown>): void {
		if (!blueprint || typeof blueprint !== 'object') {
			throw new Error('[BmsxConsoleApi] register_fsm blueprint must be a table/object.');
		}
		const idValue = (blueprint as { id?: unknown }).id;
		if (typeof idValue !== 'string' || idValue.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] register_fsm blueprint requires a non-empty id field.');
		}
		const runtime = BmsxConsoleRuntime.instance;
		if (runtime) {
			runtime.registerStateMachineDefinition(blueprint);
			return;
		}
		const prepared = this.cloneStateMachineData(blueprint) as StateMachineBlueprint;
		this.register_prepared_fsm(idValue.trim(), prepared);
	}

	public register_prepared_fsm(id: string, blueprint: StateMachineBlueprint, options?: { setup?: boolean }): void {
		const trimmed = typeof id === 'string' ? id.trim() : '';
		if (trimmed.length === 0) {
			throw new Error('[BmsxConsoleApi] register_prepared_fsm id must be a non-empty string.');
		}
		if (typeof blueprint !== 'object' || blueprint === null) {
			throw new Error('[BmsxConsoleApi] register_prepared_fsm blueprint must be an object.');
		}
		BmsxConsoleRuntime.injectConsoleTimelineMetadata(trimmed, blueprint);
		this.setFsmBlueprintFactory(trimmed, blueprint);
		if (!options || options.setup !== false) {
			setupFSMlibrary();
		}
	}

	public register_behavior_tree(descriptor: Record<string, unknown>): void {
		if (!descriptor || typeof descriptor !== 'object') {
			throw new Error('[BmsxConsoleApi] register_behavior_tree requires a descriptor table.');
		}
		const runtime = this.requireConsoleRuntime('register_behavior_tree');
		runtime.registerBehaviorTreeDefinition(descriptor);
	}

	private setFsmBlueprintFactory(id: string, blueprint: StateMachineBlueprint): void {
		const snapshot = this.cloneStateMachineData(blueprint);
		StateDefinitionBuilders[id] = () => this.cloneStateMachineData(snapshot);
	}

	private resolveWorldObjectConstructor(class_ref: string): new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject {
		if (typeof class_ref !== 'string' || class_ref.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] spawn_world_object requires a non-empty class reference.');
		}
		if (class_ref === 'WorldObject') {
			return WorldObject as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
		}
		const ctorUnknown = this.resolveConstructor(class_ref.trim());
		if (typeof ctorUnknown !== 'function') {
			throw new Error(`[BmsxConsoleApi] World object constructor '${class_ref}' not found.`);
		}
		const ctor = ctorUnknown as new (opts: RevivableObjectArgs & { id?: string; fsm_id?: string }) => WorldObject;
		if (!(ctor.prototype instanceof WorldObject)) {
			throw new Error(`[BmsxConsoleApi] Constructor '${class_ref}' does not extend WorldObject.`);
		}
		return ctor;
	}

	private resolveComponentConstructor(class_ref: string): new (opts: Record<string, unknown>) => Component {
		if (typeof class_ref !== 'string' || class_ref.trim().length === 0) {
			throw new Error('[BmsxConsoleApi] Component reference must be a non-empty string.');
		}
		const ctorUnknown = this.resolveConstructor(class_ref.trim());
		if (typeof ctorUnknown !== 'function') {
			throw new Error(`[BmsxConsoleApi] Component constructor '${class_ref}' not found.`);
		}
		const ctor = ctorUnknown as new (opts: Record<string, unknown>) => Component;
		if (!(ctor.prototype instanceof Component)) {
			throw new Error(`[BmsxConsoleApi] Constructor '${class_ref}' does not extend Component.`);
		}
		return ctor;
	}

	private resolveConstructor(ref: string): unknown {
		if (!ref) return undefined;
		const map = Reviver.constructors;
		if (map && map[ref]) {
			return map[ref];
		}
		const globalScope = globalThis as Record<string, unknown>;
		if (globalScope && typeof globalScope[ref] === 'function') {
			return globalScope[ref];
		}
		return undefined;
	}

	private normalizeSpawnOptions(raw: Record<string, unknown>): NormalizedSpawnOptions {
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
			abilities: [],
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
		const fsmsRaw = raw.fsms ?? raw.state_machines ?? raw.stateMachines ?? raw.machines;
		if (fsmsRaw !== undefined) {
			normalized.fsms = this.normalizeSpawnSystemEntries(fsmsRaw, 'fsms', false);
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
			normalized.position = this.normalizeVector3(raw.position, 'spawn_world_object options.position', false, 0);
		}
		const orientationSource = raw.rotation !== undefined ? raw.rotation : raw.orientation;
		if (orientationSource !== undefined) {
			normalized.orientation = this.normalizeVector3(orientationSource, 'spawn_world_object options.orientation', true, 0);
		}
		if (raw.scale !== undefined) {
			normalized.scale = this.normalizeVector3(raw.scale, 'spawn_world_object options.scale', true, 1);
		}
		if (raw.components !== undefined) {
			normalized.components = this.normalizeSpawnComponentEntries(raw.components);
		}

		const behaviorTreesRaw = raw.bts ?? raw.behavior_trees ?? raw.behaviorTrees;
		if (behaviorTreesRaw !== undefined) {
			normalized.behavior_trees = this.normalizeSpawnSystemEntries(behaviorTreesRaw, 'behavior trees', true);
		}

		if (raw.abilities !== undefined) {
			normalized.abilities = this.normalizeStringList(raw.abilities);
		}
		if (raw.tags !== undefined) {
			normalized.tags = this.normalizeStringList(raw.tags);
		}
		if (raw.defaults !== undefined) {
			if (!this.isPlainObject(raw.defaults)) {
				throw new Error('[BmsxConsoleApi] spawn_world_object defaults must be a table/object.');
			}
			normalized.defaults = this.cloneStateMachineData(raw.defaults as Record<string, unknown>);
		}
		return normalized;
	}

	private normalizeVector3(source: unknown, context: string, allowPartial: boolean, defaultValue: number): { x: number; y: number; z: number } {
		if (!this.isPlainObject(source)) {
			throw new Error(`[BmsxConsoleApi] ${context} must be a table/object.`);
		}
		const table = source as Record<string, unknown>;
		const hasX = table.x !== undefined;
		const hasY = table.y !== undefined;
		const result = { x: defaultValue, y: defaultValue, z: defaultValue };
		if (!allowPartial && (!hasX || !hasY)) {
			throw new Error(`[BmsxConsoleApi] ${context} requires at least x and y values.`);
		}
		if (hasX) {
			result.x = this.expectFiniteNumber(table.x, `${context}.x`);
		}
		if (hasY) {
			result.y = this.expectFiniteNumber(table.y, `${context}.y`);
		}
		if (table.z !== undefined) {
			result.z = this.expectFiniteNumber(table.z, `${context}.z`);
		} else {
			result.z = defaultValue;
		}
		return result;
	}

	private normalizeSpawnComponentEntries(raw: unknown): ConsoleWorldObjectComponentEntry[] {
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
			if (!this.isPlainObject(entry)) {
				throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] must be a string or table/object.`);
			}
			const record = entry as Record<string, unknown>;
			const preset = record.preset ?? record.presetId ?? record.preset_id;
			if (typeof preset === 'string' && preset.trim().length > 0) {
				const paramsRaw = record.params ?? record.arguments ?? record.options ?? record.config;
				let params: Record<string, unknown> = {};
				if (paramsRaw !== undefined) {
					if (!this.isPlainObject(paramsRaw)) {
						throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] preset params must be a table/object.`);
					}
					params = this.cloneStateMachineData(paramsRaw as Record<string, unknown>);
				}
				entries.push({ kind: 'preset', presetId: preset.trim(), params });
				continue;
			}
			const classCandidate = record.class ?? record.className ?? record.type ?? record.name;
			if (typeof classCandidate !== 'string' || classCandidate.trim().length === 0) {
				throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}] requires a non-empty 'class' field.`);
			}
			let options: Record<string, unknown>;
			if (record.options !== undefined) {
				if (!this.isPlainObject(record.options)) {
					throw new Error(`[BmsxConsoleApi] spawn_world_object components[${index}].options must be a table/object.`);
				}
				options = this.cloneStateMachineData(record.options as Record<string, unknown>);
			} else {
				const clone = this.cloneStateMachineData(record);
				delete clone.class;
				delete clone.className;
				delete clone.type;
				delete clone.name;
				delete clone.preset;
				delete clone.presetId;
				delete clone.preset_id;
				delete clone.params;
				delete clone.arguments;
				delete clone.config;
				delete clone.options;
				options = clone;
			}
			entries.push({ kind: 'component', descriptor: { classname: classCandidate.trim(), options } });
		}
		return entries;
	}

	private normalizeSpawnSystemEntries(raw: unknown, label: string, allowAutoTick: boolean): ConsoleWorldObjectSystemEntry[] {
		if (raw === undefined || raw === null) {
			return [];
		}
		const entries: ConsoleWorldObjectSystemEntry[] = [];
		const push = (value: Record<string, unknown>, indexLabel: string) => {
			const idCandidate = value.id
				?? value.fsm ?? value.fsmId ?? value.machine ?? value.machine_id
				?? value.tree ?? value.tree_id ?? value.bt ?? value.btId;
			if (typeof idCandidate !== 'string' || idCandidate.trim().length === 0) {
				throw new Error(`[BmsxConsoleApi] ${label} entry ${indexLabel} is missing a valid id.`);
			}
			const entry: ConsoleWorldObjectSystemEntry = { id: idCandidate.trim() };
			const contextCandidate = value.context ?? value.slot ?? value.scope ?? value.alias;
			if (typeof contextCandidate === 'string' && contextCandidate.trim().length > 0) {
				entry.context = contextCandidate.trim();
			}
			if (allowAutoTick) {
				const autoCandidate = value.auto_tick ?? value.autoTick ?? value.auto;
				if (typeof autoCandidate === 'boolean') {
					entry.auto_tick = autoCandidate;
				}
			}
			const activeCandidate = value.active ?? value.enabled ?? value.running;
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
				if (!this.isPlainObject(value)) {
					throw new Error(`[BmsxConsoleApi] ${label}[${index}] must be a string or table/object.`);
				}
				push(value as Record<string, unknown>, `[${index}]`);
			}
			return entries;
		}
		if (this.isPlainObject(raw)) {
			push(raw as Record<string, unknown>, '');
			return entries;
		}
		throw new Error(`[BmsxConsoleApi] ${label} must be provided as a string, table, or array.`);
	}

	private normalizeStringList(value: unknown): string[] {
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

	private applySpawnOrientation(instance: WorldObject, options: NormalizedSpawnOptions): void {
		if (options.orientation) {
			instance.orientation = new_vec3(options.orientation.x, options.orientation.y, options.orientation.z);
		}
		if (options.scale) {
			instance.sx = options.scale.x;
			instance.sy = options.scale.y;
			instance.sz = options.scale.z;
		}
	}

	private attachSpawnComponents(object: WorldObject, descriptors: ConsoleComponentDescriptor[]): void {
		for (let index = 0; index < descriptors.length; index += 1) {
			this.attachComponentByDescriptor(object, descriptors[index]);
		}
	}

	private materializeComponentEntriesFallback(entries: ReadonlyArray<ConsoleWorldObjectComponentEntry>): ConsoleComponentDescriptor[] {
		const descriptors: ConsoleComponentDescriptor[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]!;
			if (entry.kind === 'preset') {
				throw new Error('[BmsxConsoleApi] Component presets require the console runtime to be active.');
			}
			descriptors.push({
				className: entry.descriptor.classname,
				options: this.cloneStateMachineData(entry.descriptor.options),
			});
		}
		return descriptors;
	}

	private attachComponentByDescriptor(object: WorldObject, descriptor: ConsoleComponentDescriptor): Component {
		const ctor = this.resolveComponentConstructor(descriptor.className);
		const optionsClone = this.cloneStateMachineData(descriptor.options);
		if (optionsClone && !this.isPlainObject(optionsClone)) {
			throw new Error('[BmsxConsoleApi] Component options must be a table/object.');
		}
		const prepared = optionsClone ? { ...optionsClone } : {};
		const parentField = (prepared as { parentid?: string }).parentid;
		if (parentField !== undefined && parentField !== object.id) {
			throw new Error('[BmsxConsoleApi] Component options cannot override parentid.');
		}
		(prepared as { parentid: string }).parentid = object.id;
		const component = new ctor(prepared);
		object.add_component(component);
		return component;
	}

	private lookupSpace(spaceId: string): Space {
		const spaces = $.world[id_to_space_symbol];
		if (!spaces) {
			throw new Error('[BmsxConsoleApi] World spaces are not initialised.');
		}
		const space = spaces[spaceId];
		if (!space) {
			throw new Error(`[BmsxConsoleApi] Space '${spaceId}' not found.`);
		}
		return space;
	}

	private requireWorldObject(id: Identifier, context: string): WorldObject {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error(`[BmsxConsoleApi] ${context} requires a non-empty object id.`);
		}
		const object = $.world.getWorldObject<WorldObject>(id);
		if (!object) {
			throw new Error(`[BmsxConsoleApi] World object '${id}' not found.`);
		}
		return object;
	}

	private expectFiniteNumber(value: unknown, context: string): number {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`[BmsxConsoleApi] ${context} must be a finite number.`);
		}
		return value;
	}

	private isPlainObject(value: unknown): value is Record<string, unknown> {
		if (value === null) return false;
		if (typeof value !== 'object') return false;
		const proto = Object.getPrototypeOf(value);
		return proto === Object.prototype || proto === null;
	}

	private cloneStateMachineData<T>(source: T): T {
		return JSON.parse(JSON.stringify(source)) as T;
	}

	private pointerViewportPositionInternal(): ConsolePointerViewport {
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

	private computePointerButtonMask(): number {
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

	private expandTabs(text: string): string {
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


	private paletteColor(index: number): color {
		if (!Number.isInteger(index)) {
			throw new Error('[BmsxConsoleApi] Color index must be an integer.');
		}
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`[BmsxConsoleApi] Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}

	private resolveWriteContext(font: ConsoleFont, x: number, y: number, colorindex: number | undefined): {
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
		const color = this.paletteColor(this.textCursorColorIndex);
		return { baseX, baseY, color, autoAdvance: true, font };
	}

	private drawMultilineText(text: string, x: number, y: number, color: color, font: ConsoleFont): number {
		const lines = text.split('\n');
		let cursorY = y;
		for (let i = 0; i < lines.length; i += 1) {
			const expanded = this.expandTabs(lines[i]);
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

	private advancePrintCursor(lineHeight: number): void {
		this.textCursorY += lineHeight;
		const limit = this.display_height - lineHeight;
		if (this.textCursorY >= limit) {
			this.textCursorY = 0;
		}
	}

	private resetPrintCursor(): void {
		this.textCursorHomeX = 0;
		this.textCursorX = 0;
		this.textCursorY = 0;
		this.textCursorColorIndex = this.defaultPrintColorIndex;
	}
}
