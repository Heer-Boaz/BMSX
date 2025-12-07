import { $, runGate } from '../core/game';
import { Input } from '../input/input';
import type { PlayerInput } from '../input/playerinput';
import type {
	color,
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	RenderLayer
} from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { VMFont } from './font';
import { BmsxVMStorage } from './storage';
import { BmsxVMPointerButton, VMPointerVector, VMPointerViewport, VMPointerWheel } from './types';
import type { RandomModulationParams, ModulationParams, SoundMasterPlayRequest } from '../audio/soundmaster';
import type { ConcreteOrAbstractConstructor, Identifier, Native, Registerable, Polygon, vec3arr } from '../rompack/rompack';
import type { World } from '../core/world';
import type { Registry } from '../core/registry';
import { Service } from '../core/service';
import type { EventPayload } from '../core/eventemitter';
import { EventTimeline } from '../core/eventtimeline';
import { WorldObject } from '../core/object/worldobject';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import { taskGate, GateGroup } from '../core/taskgate';
import { buildFSMDefinition } from '../fsm/fsmlibrary';
import { VMRenderFacade } from './vm_render_facade';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import type { ActionEffectDefinition } from '../action_effects/effect_types';
import { BmsxVMRuntime } from './vm_runtime';
import { instantiateBehaviorTree, behaviorTreeExists, Blackboard, type BehaviorTreeID, type ConstructorWithBTProperty, BehaviorTreeDefinition } from '../ai/behaviourtree';
import { Component, ComponentTypenameToCtor, type ComponentAttachOptions } from '../component/basecomponent';
import { ActionEffectRegistry, RegisterEffectOptions } from '../action_effects/effect_registry';
import { SpriteObject } from '../core/object/sprite';
import { LuaTable } from '../lua/value';

type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest;

export type BmsxVMApiOptions = {
	playerindex: number;
	storage: BmsxVMStorage;
};

const VM_TAB_SPACES = 2;

const POINTER_ACTIONS: readonly string[] = [
	'pointer_primary',
	'pointer_secondary',
	'pointer_aux',
	'pointer_back',
	'pointer_forward',
] as const;

type LuaExtendedClass<TBase extends ConcreteOrAbstractConstructor<any>> =
	TBase & Native & {
		def_id: Identifier; // Id of the definition this class was registered with
		class?: (Partial<TBase extends new (...args: any) => infer R ? R : TBase extends abstract new (...args: any) => infer R ? R : any> & LuaTable); // Reference to Lua class that overrides this native class (if any). LuaTable entries can override properties of the base class.
		defaults?: Record<string, any>; // Default property values to apply when constructing instances of this class. Will not include Lua methods/properties and is separate from 'class' to avoid polluting the prototype with instance data. In addition, class overrides are applied after defaults so that overrides can set default values for properties defined in Lua classes.
	};

type EntityExtensions = LuaExtendedClass<typeof WorldObject | typeof SpriteObject | typeof Component | typeof Service> & {
	fsms?: Identifier[];
	components?: string[];
	effects?: string[];
	bts?: BehaviorTreeID[];
};

type AnyFunction = (...args: any[]) => any;

export class BmsxVMApi {
	private readonly playerindex: number;
	private readonly storage: BmsxVMStorage;
	private readonly font: VMFont;
	private readonly defaultPrintColorIndex = 15;
	private readonly serviceExts = new Map<string, EntityExtensions>();
	private readonly worldObjectExts = new Map<string, EntityExtensions>();
	private readonly componentExts = new Map<string, EntityExtensions>();
	private textCursorX = 0;
	private textCursorY = 0;
	private textCursorHomeX = 0;
	private textCursorColorIndex = 0;
	private renderBackend: VMRenderFacade = new VMRenderFacade();

	constructor(options: BmsxVMApiOptions) {
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
		this.font = new VMFont();
		this.reset_print_cursor();
	}

	/**
	 * Apply Lua class overrides to a constructed instance.
	 *
	 * Filters out non-instance keys (def_id, class, defaults) and bulk-assigns the
	 * remaining properties to the instance. This mimics Object.assign(instance, overrides).
	 *
	 * Caveat: when Lua overrides lifecycle methods (notably onspawn), a straight overwrite
	 * would drop the native behavior (activation/registration/FSM start). To keep the
	 * engine wiring intact, function overrides run the original first and then the Lua
	 * version. The Lua result wins if it returns something. This mirrors how Lua’s
	 * `:` syntax would still pass `self` while letting the base work run.
	 */
	private applyClassOverrides<T>(instance: T, classTable: Partial<T> & LuaTable): void {
		if (!classTable) return; // No overrides to apply
		// Filter out non-instance override keys, then bulk-assign.
		const overrides: Record<string, any> = {};
		// For function overrides, run the original first to preserve engine lifecycle (e.g. onspawn),
		// then run the Lua override and let its return value win when defined.
		for (const [key, value] of Object.entries(classTable)) {
			if (key in ['def_id', 'class', 'defaults', 'metatable', 'constructor', 'prototype', 'super']) continue;
			const existing = instance[key];
			if (typeof value === 'function' && typeof existing === 'function') {
				const baseFn: AnyFunction = existing;
				const overrideFn: AnyFunction = value;
				overrides[key] = (...args: any[]) => {
					const baseResult = baseFn.apply(instance, args);
					const overrideResult = overrideFn.apply(instance, args);
					return overrideResult === undefined ? baseResult : overrideResult;
				};
				continue;
			}
			overrides[key] = value;
		}
		Object.assign(instance, overrides);
	}

	public set_render_backend(backend: VMRenderFacade): void {
		this.renderBackend = backend;
	}

	public get display_width(): number {
		return $.view.viewportSize.x;
	}

	public get display_height(): number {
		return $.view.viewportSize.y;
	}

	public mousebtn(button: BmsxVMPointerButton): boolean {
		const state = this.get_player_input().getActionState(this.pointer_action(button));
		return state.pressed;
	}

	public mousebtnp(button: BmsxVMPointerButton): boolean {
		const state = this.get_player_input().getActionState(this.pointer_action(button));
		return state.guardedjustpressed;
	}

	public mousebtnr(button: BmsxVMPointerButton): boolean {
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

	private pointer_action(button: BmsxVMPointerButton): string {
		const action = POINTER_ACTIONS[button];
		if (!action) {
			throw new Error(`Pointer button index ${button} outside supported range 0-${POINTER_ACTIONS.length - 1}.`);
		}
		return action;
	}

	public mousepos(): VMPointerViewport {
		return this.pointer_viewport_position();
	}

	public pointer_screen_position(): VMPointerVector {
		const state = this.get_player_input().getActionState('pointer_position');
		const coords = state.value2d;
		if (!coords) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: coords[0], y: coords[1], valid: true };
	}

	public pointer_delta(): VMPointerVector {
		const state = this.get_player_input().getActionState('pointer_delta');
		const delta = state.value2d;
		if (!delta) {
			return { x: 0, y: 0, valid: false };
		}
		return { x: delta[0], y: delta[1], valid: true };
	}

	public pointer_viewport_position(): VMPointerViewport {
		return this.pointer_viewport_position_internal();
	}

	public mousewheel(): VMPointerWheel {
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
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: 0,
				top: 0,
				right: this.display_width,
				bottom: this.display_height,
			},
			color,
		};
		this.renderBackend.rect(rect);
		this.reset_print_cursor();
	}

	public rect(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		const rect: RectRenderSubmission = {
			kind: 'rect',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: this.palette_color(colorindex),
		};
		this.renderBackend.rect(rect);
	}

	public rectfill(x0: number, y0: number, x1: number, y1: number, z: number, colorindex: number): void {
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: this.palette_color(colorindex),
		};
		this.renderBackend.rect(rect);
	}

	public rectfill_color(x0: number, y0: number, x1: number, y1: number, z: number, colorvalue: number | color): void {
		const resolved = this.resolve_color(colorvalue);
		const rect: RectRenderSubmission = {
			kind: 'fill',
			area: {
				left: x0,
				top: y0,
				right: x1,
				bottom: y1,
				z: z,
			},
			color: resolved,
		};
		this.renderBackend.rect(rect);
	}

	public sprite(img_id: string, x: number, y: number, z: number, options?: { scale?: number; flip_h?: boolean; flip_v?: boolean; colorize?: color, }): void {
		const scale = options?.scale ?? 1;
		const submission: ImgRenderSubmission = {
			imgid: img_id,
			pos: { x, y, z },
			scale: { x: scale, y: scale },
			flip: options?.flip_h || options?.flip_v ? { flip_h: options?.flip_h === true, flip_v: options?.flip_v === true } : undefined,
			colorize: options?.colorize,
		};
		this.renderBackend.sprite(submission);
	}

	public poly(points: Polygon, z: number, colorindex: number, thickness?: number, layer?: RenderLayer): void {
		const submission: PolyRenderSubmission = {
			points,
			z,
			color: this.palette_color(colorindex),
			thickness,
			layer,
		};
		this.renderBackend.poly(submission);
	}

	public mesh(mesh: MeshRenderSubmission['mesh'], matrix: MeshRenderSubmission['matrix'], options?: Omit<MeshRenderSubmission, 'mesh' | 'matrix'>): void {
		const submission: MeshRenderSubmission = {
			mesh,
			matrix,
			joint_matrices: options?.joint_matrices,
			morph_weights: options?.morph_weights,
			receive_shadow: options?.receive_shadow,
		};
		this.renderBackend.mesh(submission);
	}

	public particle(position: vec3arr, size: number, colorvalue: number | color, options?: Omit<ParticleRenderSubmission, 'position' | 'size' | 'color'>): void {
		const submission: ParticleRenderSubmission = {
			position,
			size,
			color: this.resolve_color(colorvalue),
			texture: options?.texture,
			ambient_mode: options?.ambient_mode,
			ambient_factor: options?.ambient_factor,
		};
		this.renderBackend.particle(submission);
	}

	public write(text: string, x?: number, y?: number, z?: number, colorindex?: number): void {
		const { baseX, baseY, color, font, autoAdvance } = this.resolve_write_context(this.font, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, font);
		if (autoAdvance) {
			this.advance_print_cursor(font.lineHeight);
		}
	}

	public write_with_font(text: string, x?: number, y?: number, z?: number, colorindex?: number, font?: VMFont): void {
		const renderFont = font ?? this.font;
		const { baseX, baseY, color, autoAdvance } = this.resolve_write_context(renderFont, x, y, z, colorindex);
		this.draw_multiline_text(text, baseX, baseY, z, color, renderFont);
		if (autoAdvance) {
			this.advance_print_cursor(renderFont.lineHeight);
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

	public music(id: string, options?: AudioPlayOptions): void {
		if (!id) {
			$.sndmaster.stopMusic();
			return;
		}
		$.sndmaster.stopMusic();
		void $.sndmaster.play(id, options as SoundMasterPlayRequest | ModulationParams | RandomModulationParams);
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

	public get world(): World {
		return $.world;
	}

	public world_object(id: Identifier): WorldObject {
		return $.world.getFromCurrentSpace(id);
	}

	public get world_objects(): WorldObject[] {
		return $.world.allObjectsFromSpaces;
	}

	public attach_fsm(id: Identifier, machine_id: Identifier): void {
		const obj = $.world.getWorldObject(id);
		obj.sc.add_statemachine(machine_id, obj.id);
	}

	public attach_bt(object_id: Identifier, tree_id: BehaviorTreeID): void {
		if (typeof tree_id !== 'string' || tree_id.trim().length === 0) throw new Error('attach_bt requires a non-empty behavior tree id.');
		if (!behaviorTreeExists(tree_id)) throw new Error(`Behavior tree '${tree_id}' is not registered.`);
		const obj = $.world.getWorldObject(object_id);
		if (!obj) throw new Error(`World object '${object_id}' not found.`);
		const ctor = obj.constructor as ConstructorWithBTProperty;
		const linked = ctor.linkedBTs ?? new Set<BehaviorTreeID>();
		if (!linked.has(tree_id)) {
			const next = new Set(linked);
			next.add(tree_id);
			ctor.linkedBTs = next;
		}

		const contexts = obj.btreecontexts;
		if (!contexts[tree_id]) {
			contexts[tree_id] = {
				tree_id: tree_id,
				running: true,
				root: instantiateBehaviorTree(tree_id),
				blackboard: new Blackboard({ id: tree_id }),
			};
		}
	}

	public define_component(descriptor: EntityExtensions): void {
		const defId = descriptor.def_id;
		if (!ComponentTypenameToCtor.has(defId)) {
			class LuaComponent extends Component<any> {
				public static override get typename(): string { return defId; }
				constructor(opts: ComponentAttachOptions) {
					super(opts);
				}
			}
			Component.registerComponentType(defId, LuaComponent);
		}
		this.componentExts.set(descriptor.def_id, descriptor);
	}

	public define_world_object(descriptor: EntityExtensions): void {
		this.worldObjectExts.set(descriptor.def_id, descriptor);
	}

	public define_service(descriptor: EntityExtensions): void {
		this.serviceExts.set(descriptor.def_id, descriptor);
	}

	private resolveLuaClassLocalId(ext: EntityExtensions): string {
		const classTable = ext.class as LuaTable;
		if (!classTable) return ext.def_id;
		const resolved = this.runtime.interpreter.resolveValueName(classTable);
		return resolved ?? ext.def_id;
	}

	/**
	 * Create a Service instance from a previously defined service descriptor.
	 *
	 * Behavior:
	 * - Looks up the descriptor registered via define_service(definition).
	 * - Instantiates Service. If a Lua class override exists, uses its `id` as instance id.
	 * - Applies `defaults` to the instance, then applies Lua class overrides (if any).
	 * - Attaches any FSMs declared on the descriptor to the Service's state controller.
	 *
	 * @param definition_id The id of the registered service definition to instantiate.
	 * @param defer_bind Optional flag forwarded to Service constructor to defer binding.
	 * @returns The id of the created service instance.
	 */
	public create_service(definition_id: Identifier, defer_bind?: boolean): Identifier {
		const ext = this.serviceExts.get(definition_id);
		// Default the id of the instance to the Lua-class' definition id and otherwise defaults to the definition id
		const instance = new Service({ id: ext?.class?.id ?? definition_id, deferBind: defer_bind ?? false });
		// Apply definition
		this.applyObjectExtensionAndOverrides(ext, instance, undefined);
		return instance.id;
	}

	public attach_component(object_or_id: WorldObject | Identifier, component_or_type: Component | Identifier): void {
		let obj: WorldObject;
		if (typeof object_or_id === 'string') {
			obj = $.world.getWorldObject(object_or_id);
			if (!obj) {
				throw new Error(`World object '${object_or_id}' not found.`);
			}
		} else {
			obj = object_or_id;
		}

		// Early out when given an instance
		if (typeof component_or_type === 'object') {
			component_or_type.attach(obj);
			return;
		}

		// See whether this is a component type whose extension we have defined
		const ext = this.componentExts.get(component_or_type);
		const idLocal = ext ? this.resolveLuaClassLocalId(ext) : undefined;
		const instance = Component.newComponent(component_or_type, { parent_or_id: obj, id_local: idLocal } as ComponentAttachOptions);
		this.applyObjectExtensionAndOverrides(ext, instance);
		obj.add_component(instance);
	}

	public define_effect(descriptor: ActionEffectDefinition, opts?: RegisterEffectOptions<any>): void {
		if (!descriptor.id) throw new Error('Action effect definition must have a valid id.');
		ActionEffectRegistry.instance.register(descriptor, opts);
	}

	/**
	 * Apply an entity extension descriptor to a constructed instance,
	 * then apply any user-supplied overrides.
	 *
	 * Behavior:
	 * - If an extension descriptor is provided, apply its `defaults` to the instance.
	 * - Apply Lua class overrides from `ext.class` (filtered to instance fields).
	 * - Attach any declared components, FSMs and action effects to the instance.
	 * - Attach any declared behavior trees.
	 * - After processing the extension descriptor, apply the `overrides` object last so
	 *   that user-specified properties take precedence.
	 *
	 * Notes:
	 * - This function does not spawn the object into the world; it only configures
	 *   the instance. Callers are expected to call `$.world.spawn` or similar when ready.
	 *
	 * @param ext Optional extension descriptor returned from define_world_object/define_service/etc.
	 * @param instance The constructed instance to modify
	 * @param overrides Optional final overrides to apply to the instance (applied last)
	 */
	private applyObjectExtensionAndOverrides(ext: EntityExtensions, instance: any, overrides?: Partial<any>): void {
		if (ext) {
			if (ext.defaults) {
				Object.assign(instance, ext.defaults);
			}
			this.applyClassOverrides(instance, ext.class); // Apply Lua class overrides

			if (ext.components) {
				for (let i = 0; i < ext.components.length; i += 1) {
					this.attach_component(instance, ext.components[i]);
				}
			}
			if (ext.fsms) {
				for (let i = 0; i < ext.fsms.length; i += 1) {
					instance.sc.add_statemachine(ext.fsms[i], instance.id);
				}
			}
			if (ext.effects && ext.effects.length > 0) {
				let effectComponent = instance.get_unique_component(ActionEffectComponent);
				if (!effectComponent) {
					effectComponent = new ActionEffectComponent({ parent_or_id: instance });
					instance.add_component(effectComponent);
				}
				for (let i = 0; i < ext.effects.length; i += 1) {
					effectComponent.grant_effect_by_id(ext.effects[i]);
				}
			}
			if (ext.bts) {
				for (let i = 0; i < ext.bts.length; i += 1) {
					instance.add_btree(ext.bts[i]);
				}
			}
		}
		// Apply overrides (these are applied last to take precedence and are distinct from definition overrides)
		if (overrides) {
			// TODO: FILTER!!
			Object.assign(instance, overrides);
		}
	}

	/**
	 * Spawn a WorldObject instance from a previously defined descriptor.
	 *
	 * Behavior:
	 * - Looks up the world-object extensions registered via define_world_object(definition).
	 * - Creates a new WorldObject. Instance id defaults to the Lua class override id (if present)
	 *   and can be overridden via overrides.id.
	 * - Applies descriptor defaults, then Lua class overrides to the instance.
	 * - Attaches declared components, FSMs, effects, and behavior trees from the descriptor.
	 * - Finally applies user-supplied overrides so they take precedence, then spawns the object
	 *   into the world, honoring overrides.pos if provided.
	 *
	 * @param definition_id The id used when registering the world object definition.
	 * @param overrides Optional partial properties to apply last; may include id and pos.
	 * @returns The id of the spawned object.
	 */
	public spawn_object(definition_id: Identifier, overrides?: Partial<WorldObject>): Identifier {
		const ext = this.worldObjectExts.get(definition_id);
		// Default the id of the instance to the Lua-class' definition id if not overridden
		const instance = new WorldObject({ id: overrides?.id ?? ext?.class?.id, constructReason: undefined });

		// Apply definition
		this.applyObjectExtensionAndOverrides(ext, instance, overrides);

		$.world.spawn(instance, overrides?.pos, { reason: 'fresh' });
		return instance.id;
	}

	/**
	 * Spawn a SpriteObject instance from a previously defined sprite descriptor.
	 *
	 * Behavior:
	 * - Looks up the sprite-object extensions registered via define_world_object(definition).
	 * - Creates a new SpriteObject. Instance id defaults to the Lua class override id (if present)
	 *   and can be overridden via overrides.id.
	 * - Applies descriptor defaults, then Lua class overrides to the instance.
	 * - Attaches declared components, FSMs, effects, and behavior trees from the descriptor.
	 * - Finally applies user-supplied overrides so they take precedence, then spawns the sprite
	 *   into the world, honoring overrides.pos if provided.
	 *
	 * @param definition_id The id used when registering the sprite definition.
	 * @param overrides Optional partial properties to apply last; may include id and pos.
	 * @returns The id of the spawned sprite instance.
	 */
	public spawn_sprite(definition_id: Identifier, overrides?: Partial<SpriteObject>): Identifier {
		const ext = this.worldObjectExts.get(definition_id);
		// Default the id of the instance to the Lua-class' definition_id if not overridden
		const instance = new SpriteObject({ id: overrides?.id ?? ext?.class?.id, constructReason: undefined });
		// Apply definition
		this.applyObjectExtensionAndOverrides(ext, instance, overrides);

		$.world.spawn(instance, overrides?.pos, { reason: 'fresh' });
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
		const effect = ActionEffectRegistry.instance.get(effect_id);
		if (!effect) {
			throw new Error(`Action effect '${effect_id}' is not registered.`);
		}
		component.grant_effect(effect);
	}

	public trigger_effect(object_id: Identifier, effect_id: string, options?: { payload?: object }) {
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

	public get registry(): Registry {
		return $.registry;
	}

	public get registry_ids(): Identifier[] {
		return $.registry.getRegisteredEntityIds();
	}

	public rget(id: Identifier): Registerable {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('rget id must be a non-empty string.');
		}
		return $.registry.get(id);
	}

	public get services(): Service[] {
		return Array.from($.registry.iterate(Service));
	}

	public service(id: Identifier): Service {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('service id must be a non-empty string.');
		}
		return $.registry.get<Service>(id);
	}

	private resolveEmitter(
		emitter_or_id: Identifier | Registerable,
		options?: { required?: boolean; context?: string }
	): Registerable {
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

	public emit(event_name: string, emitter_or_id?: Identifier | Registerable, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('emit requires a non-empty event name.');
		}
		const emitter = this.resolveEmitter(emitter_or_id);
		$.emit(event_name, emitter, payload);
	}

	public emit_gameplay(event_name: string, emitter_or_id: Identifier | Registerable, payload?: EventPayload): void {
		if (typeof event_name !== 'string' || event_name.length === 0) {
			throw new Error('emit_gameplay requires a non-empty event name.');
		}
		const emitter = this.resolveEmitter(emitter_or_id, { required: true, context: 'emit_gameplay' });
		$.emit_gameplay(event_name, emitter as any, payload);
	}

	public get timelines(): EventTimeline[] {
		return Array.from($.registry.iterate(EventTimeline));
	}

	public taskgate(name: string): GateGroup {
		return taskGate.group(name);
	}

	public get rungate(): GateGroup {
		return runGate;
	}

	public get runtime(): BmsxVMRuntime {
		return BmsxVMRuntime.instance!;
	}

	public define_fsm(id: string, blueprint: StateMachineBlueprint): void {
		buildFSMDefinition(id, blueprint);
	}

	public define_bt(_descriptor: BehaviorTreeDefinition): void {
		// Behavior tree definitions are registered via buildBehaviorTreeDefinition
		throw new Error('BMSX VM API define_bt is not implemented; use the behavior tree library functions instead.');
	}

	private pointer_viewport_position_internal(): VMPointerViewport {
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
		if (this.mousebtn(BmsxVMPointerButton.Primary)) {
			mask |= 1;
		}
		if (this.mousebtn(BmsxVMPointerButton.Secondary)) {
			mask |= 2;
		}
		if (this.mousebtn(BmsxVMPointerButton.Auxiliary)) {
			mask |= 4;
		}
		if (this.mousebtn(BmsxVMPointerButton.Back)) {
			mask |= 8;
		}
		if (this.mousebtn(BmsxVMPointerButton.Forward)) {
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
				for (let j = 0; j < VM_TAB_SPACES; j++) {
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

	private resolve_color(value: number | color): color {
		return typeof value === 'number' ? this.palette_color(value) : value;
	}

	private resolve_write_context(font: VMFont, x: number, y: number, z: number, colorindex: number) {
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

	private draw_multiline_text(text: string, x: number, y: number, z: number, color: color, font: VMFont): number {
		const lines = text.split('\n');
		let cursorY = y;
		for (let i = 0; i < lines.length; i += 1) {
			const expanded = this.expand_tabs(lines[i]);
			if (expanded.length > 0) {
				const glyphs: GlyphRenderSubmission = {
					glyphs: expanded,
					x,
					y: cursorY,
					z,
					color,
					font,
				};
				this.renderBackend.glyphs(glyphs);
			}
			if (i < lines.length - 1) {
				cursorY += font.lineHeight;
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
