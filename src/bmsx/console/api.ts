import { $, runGate } from '../core/game';
import { Input } from '../input/input';
import type { PlayerInput } from '../input/playerinput';
import type { color } from '../render/shared/render_types';
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
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import type { ActionEffectDefinition, ActionEffectId } from '../action_effects/effect_types';
import { BmsxConsoleRuntime } from './runtime';
import { instantiateBehaviorTree, behaviorTreeExists, Blackboard, type BehaviorTreeID, type ConstructorWithBTProperty, BehaviorTreeDefinition } from '../ai/behaviourtree';
import { deep_clone } from '../utils/deep_clone';
import { Component, type ComponentAttachOptions } from '../component/basecomponent';
import { actionEffectRegistry } from '../action_effects/effect_registry';
import { Reviver } from '../serializer/gameserializer';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | undefined;

export type BmsxConsoleApiOptions = {
	playerindex: number;
	storage: BmsxConsoleStorage;
};

const CONSOLE_TAB_SPACES = 2;

const POINTER_ACTIONS: readonly string[] = [
	'pointer_primary',
	'pointer_secondary',
	'pointer_aux',
	'pointer_back',
	'pointer_forward',
] as const;

export class BmsxConsoleApi {
	private readonly playerindex: number;
	private readonly storage: BmsxConsoleStorage;
	private readonly font: ConsoleFont;
	private readonly defaultPrintColorIndex = 15;
	private readonly worldObjectDefs = new Map<string, Partial<WorldObject>>();
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private renderBackend: ConsoleRenderFacade = new ConsoleRenderFacade();

	constructor(options: BmsxConsoleApiOptions) {
		const view = $.view;
		if (!view) {
			throw new Error('Game view not initialised.');
		}
		const viewport = view.viewportSize;
		if (viewport.x <= 0 || viewport.y <= 0) {
			throw new Error('Invalid viewport size.');
		}
		this.playerindex = options.playerindex;
		this.storage = options.storage;
		this.font = new ConsoleFont();
		this.reset_print_cursor();
	}

	public set_render_backend(backend: ConsoleRenderFacade | null): void {
		if (backend) {
			this.renderBackend = backend;
		}
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

	public get keyboard() {
		return $.input.getPlayerInput(1).inputHandlers.keyboard;
	}

	private get_player_input(): PlayerInput {
		const playerInput = Input.instance.getPlayerInput(this.playerindex);
		if (!playerInput) {
			throw new Error(`Player input handler for index ${this.playerindex} is not initialised.`);
		}
		return playerInput;
	}

	private pointer_action(button: BmsxConsolePointerButton): string {
		const action = POINTER_ACTIONS[button];
		if (!action) {
			throw new Error(`Pointer button index ${button} outside supported range 0-${POINTER_ACTIONS.length - 1}.`);
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
			throw new Error('stat index must be finite.');
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
		this.renderBackend.rect({
			kind: 'fill',
			x0: 0,
			y0: 0,
			x1: this.display_width,
			y1: this.display_height,
			z: 0,
			color,
		});
		this.reset_print_cursor();
	}

	public rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.renderBackend.rect({ kind: 'rect', x0, y0, x1, y1, z, color: this.palette_color(colorindex) });
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		this.renderBackend.rect({ kind: 'fill', x0, y0, x1, y1, z, color: this.palette_color(colorindex) });
	}

	public rectfill_color(x0: number, y0: number, x1: number, y1: number, z: number, colorvalue: number | color): void {
		const resolved = typeof colorvalue === 'number' ? this.palette_color(colorvalue) : colorvalue;
		this.renderBackend.rect({ kind: 'fill', x0, y0, x1, y1, z, color: resolved });
	}

	public sprite(img_id: string, x: number, y: number, z: number, options?: { scale?: number; flip_h?: boolean; flip_v?: boolean; colorize?: color, }): void {
		const entry = this.rompack.img[img_id];
		const width = entry.imgmeta.width;
		const height = entry.imgmeta.height;
		const scale = options?.scale ?? 1;
		this.renderBackend.sprite({
			kind: 'sprite',
			imgId: img_id,
			spriteIndex: null,
			originX: 0,
			originY: 0,
			baseX: x,
			baseY: y,
			drawX: x,
			drawY: y,
			z,
			scale,
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

	public write(text: string, x?: number, y?: number, z?: number, colorindex?: number): void {
		const { baseX, baseY, color, font, autoAdvance } = this.resolve_write_context(this.font, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, font);
		if (autoAdvance) {
			this.advance_print_cursor(font.lineHeight());
		}
	}

	public write_with_font(text: string, x?: number, y?: number, z?: number, colorindex?: number, font?: ConsoleFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight());
		}
	}

	public check_action_state(playerindex: number, actiondefinition: string): boolean {
		if (!Number.isInteger(playerindex) || playerindex <= 0) {
			throw new Error('check_action_state requires a positive integer player index.');
		}
		if (typeof actiondefinition !== 'string') {
			throw new Error('check_action_state requires an action definition string.');
		}
		const trimmed = actiondefinition.trim();
		if (trimmed.length === 0) {
			throw new Error('check_action_state requires a non-empty action definition.');
		}
		const playerInput = Input.instance.getPlayerInput(playerindex);
		if (!playerInput) {
			throw new Error(`Player input handler for index ${playerindex} is not initialised.`);
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
			throw new Error('world_object id must be a non-empty string.');
		}
		return $.world.getFromCurrentSpace(id);
	}

	public world_objects(): WorldObject[] {
		return $.world.allObjectsFromSpaces;
	}

	public spawn_world_object(class_ref: string, options?: Partial<WorldObject>): Identifier {
		const instance = $.world.spawn(class_ref, options);
		return instance.id;
	}

	public attach_fsm(id: Identifier, machine_id: Identifier): void {
		$.world.getWorldObject(id).sc.add_statemachine(id, machine_id);
	}

	public attach_bt(object_id: Identifier, tree_id: BehaviorTreeID): void {
		if (typeof tree_id !== 'string' || tree_id.trim().length === 0) {
			throw new Error('attach_bt requires a non-empty behavior tree id.');
		}
		if (!behaviorTreeExists(tree_id)) {
			throw new Error(`Behavior tree '${tree_id}' is not registered.`);
		}
		const obj = $.world.getWorldObject(object_id);
		const ctor = obj.constructor as ConstructorWithBTProperty;
		const linked = ctor.linkedBTs ?? new Set<BehaviorTreeID>();
		if (!linked.has(tree_id)) {
			const next = new Set(linked);
			next.add(tree_id);
			ctor.linkedBTs = next;
		}

		const contexts = obj.btreecontexts;
		if (!contexts?.[tree_id]) {
			contexts[tree_id] = {
				tree_id: tree_id,
				running: true,
				root: instantiateBehaviorTree(tree_id),
				blackboard: new Blackboard({ id: tree_id }),
			};
		}
	}

	public register_component(descriptor: Partial<Component>): string {
		return descriptor.id as string;
	}

	public register_world_object(descriptor: Partial<WorldObject>): string {
		const id = descriptor.id as string;
		this.worldObjectDefs.set(id, descriptor);
		return id;
	}

	public register_service(descriptor: Partial<Service>) {
		return descriptor;
	}

	public attach_component(object_id: Identifier, component: string | { id: string; id_local?: string; state?: Record<string, unknown> }): string {
		const obj = $.world.getWorldObject(object_id);
		const componentId = typeof component === 'string' ? component : component.id;
		const ctor = (Reviver.constructors?.[componentId] as new (opts: ComponentAttachOptions) => Component)
			|| ((globalThis as Record<string, unknown>)[componentId] as new (opts: ComponentAttachOptions) => Component);
		const instanceOpts: ComponentAttachOptions = {
			parent_or_id: obj,
			id_local: typeof component === 'object' ? component.id_local : undefined,
		};
		const instance = new ctor(instanceOpts);
		if (typeof component === 'object' && component.state) {
			Object.assign(instance, component.state);
		}
		obj.add_component(instance);
		return instance.id;
	}

	public register_effect(descriptor: ActionEffectDefinition): string {
		actionEffectRegistry.register(descriptor);
		return descriptor.id;
	}

	public spawn_object(definition_id: Identifier, overrides?: Partial<WorldObject>): Identifier {
		const def = this.worldObjectDefs.get(definition_id) as {
			class?: string;
			components?: Array<string | { id: string; id_local?: string; state?: Record<string, unknown> }>;
			fsms?: Identifier[];
			effects?: ActionEffectId[];
			defaults?: Record<string, unknown>;
		};
		const ctorRef = def?.class as string;
		const ctor = (Reviver.constructors?.[ctorRef] as new (opts?: { id?: Identifier }) => WorldObject)
			|| ((globalThis as Record<string, unknown>)[ctorRef] as new (opts?: { id?: Identifier }) => WorldObject);
		const instance = new ctor({ id: overrides?.id });
		if (def?.defaults) {
			Object.assign(instance, def.defaults);
		}
		if (overrides) {
			Object.assign(instance, overrides);
		}
		const components = def?.components;
		if (components) {
			for (let index = 0; index < components.length; index += 1) {
				this.attach_component(instance.id, components[index]);
			}
		}
		const fsms = def?.fsms;
		if (fsms) {
			for (let i = 0; i < fsms.length; i += 1) {
				instance.sc.add_statemachine(fsms[i], instance.id);
			}
		}
		const effects = def?.effects;
		if (effects && effects.length > 0) {
			let effectComponent = instance.get_unique_component(ActionEffectComponent);
			if (!effectComponent) {
				effectComponent = new ActionEffectComponent({ parent_or_id: instance });
				instance.add_component(effectComponent);
			}
			for (let i = 0; i < effects.length; i += 1) {
				effectComponent.grant_effect_by_id(effects[i]);
			}
		}
		const position = (overrides as { position?: { x: number; y: number; z?: number } })?.position;
		if (position) {
			(instance as unknown as { x?: number; y?: number; z?: number }).x = position.x;
			(instance as unknown as { y?: number }).y = position.y;
			if ('z' in position) {
				(instance as unknown as { z?: number }).z = position.z;
			}
		}
		($.world as unknown as World).spawn(instance, position as any, { reason: 'spawn' as SpawnReason });
		return instance.id;
	}

	public grant_effect(object_id: Identifier, effect_id: string): void {
		if (typeof effect_id !== 'string' || effect_id.trim().length === 0) {
			throw new Error('grant_effect requires a non-empty effect id.');
		}
		const obj = $.world.getWorldObject(object_id);
		const component = obj.get_unique_component(ActionEffectComponent);
		if (!component) {
			throw new Error(`World object '${object_id}' does not have an ActionEffectComponent.`);
		}
		const effect = actionEffectRegistry.get(effect_id);
		if (!effect) {
			throw new Error(`Action effect '${effect_id}' is not registered.`);
		}
		component.grant_effect(effect);
	}

	public trigger_effect(object_id: Identifier, effect_id: string, options?: { payload?: Record<string, unknown> }) {
		if (typeof effect_id !== 'string' || effect_id.trim().length === 0) {
			throw new Error('trigger_effect requires a non-empty effect id.');
		}
		const obj = $.world.getWorldObject(object_id);
		const component = obj.get_unique_component(ActionEffectComponent);
		if (!component) {
			throw new Error(`World object '${object_id}' does not have an ActionEffectComponent.`);
		}
		const trimmedId = effect_id.trim() as any;
		const payload = options?.payload as any;
		const result = payload !== undefined
			? component.trigger(trimmedId, { payload })
			: component.trigger(trimmedId);
		return result;
	}

	public registry(): Registry {
		return $.registry;
	}

	public registry_ids(): Identifier[] {
		return $.registry.getRegisteredEntityIds();
	}

	public rget(id: Identifier): Registerable | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('rget id must be a non-empty string.');
		}
		return $.registry.get(id);
	}

	public services(): Service[] {
		return Array.from($.registry.iterate(Service));
	}

	public service(id: Identifier): Service | null {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('service id must be a non-empty string.');
		}
		return $.registry.get<Service>(id);
	}

	public get game(): Game {
		return $;
	}

	public get rompack(): RomPack | undefined {
		return $.rompack;
	}

	public get events(): EventEmitter {
		return $.event_emitter;
	}

	private resolveEmitter(
		emitter_or_id: Identifier | Registerable | null | undefined,
		options?: { required?: boolean; context?: string }
	): Registerable | null {
		const context = options?.context ?? 'emit';
		if (emitter_or_id === undefined || emitter_or_id === null) {
			if (options?.required) {
				throw new Error(`${context} requires a non-empty emitter or emitter id.`);
			}
			return null;
		}
		if (typeof emitter_or_id === 'string') {
			const emitter = $.registry.get(emitter_or_id);
			if (!emitter) {
				throw new Error(`Emitter '${emitter_or_id}' not found.`);
			}
			return emitter;
		}
		return emitter_or_id;
	}

	public emit(event_name: string, emitter_or_id?: Identifier | Registerable | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('emit requires a non-empty event name.');
		}
		const emitter = this.resolveEmitter(emitter_or_id);
		$.emit(event_name, emitter, payload);
	}

	public emit_gameplay(event_name: string, emitter_or_id: Identifier | Registerable | null, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('emit_gameplay requires a non-empty event name.');
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

	public get runtime(): BmsxConsoleRuntime {
		return BmsxConsoleRuntime.instance!;
	}

	public register_fsm(id: string, blueprint: StateMachineBlueprint, options?: { setup?: boolean }): void {
		this.set_fsm_blueprint_factory(id, blueprint);
		if (!options || options.setup !== false) {
			setupFSMlibrary();
		}
	}

	public register_behavior_tree(_descriptor: BehaviorTreeDefinition): void {
		// TODO: Implement
	}

	private set_fsm_blueprint_factory(id: string, blueprint: StateMachineBlueprint): void {
		const snapshot = deep_clone(blueprint);
		StateDefinitionBuilders[id] = () => deep_clone(snapshot);
	}

	private pointer_viewport_position_internal(): ConsolePointerViewport {
		const screen = this.pointer_screen_position();
		if (!screen.valid) {
			return { x: 0, y: 0, valid: false, inside: false };
		}
		const view = $.view;
		if (!view) {
			throw new Error('Game view not initialised.');
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
			throw new Error('Color index must be an integer.');
		}
		if (index < 0 || index >= Msx1Colors.length) {
			throw new Error(`Color index ${index} outside palette range 0-${Msx1Colors.length - 1}.`);
		}
		return Msx1Colors[index];
	}

	private resolve_write_context(font: ConsoleFont, x: number, y: number, z: number, colorindex: number | undefined) {
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
		return { baseX, baseY, color, autoAdvance: true, font, z };
	}

	private draw_multiline_text(text: string, x: number, y: number, z: number, color: color, font: ConsoleFont): number {
		const lines = text.split('\n');
		let cursorY = y;
		for (let i = 0; i < lines.length; i += 1) {
			const expanded = this.expand_tabs(lines[i]);
			if (expanded.length > 0) {
				this.renderBackend.glyphs({ kind: 'print', text: expanded, x, y: cursorY, z, color, font });
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
