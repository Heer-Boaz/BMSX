import type { EngineCore } from '../../../core/engine';
import type { Api } from './index';

export type ApiParameterMetadata = {
	readonly name: string;
	readonly optional?: boolean;
	readonly description?: string;
};

export type ApiMethodMetadata = {
	readonly description?: string;
	readonly parameters?: readonly ApiParameterMetadata[];
	readonly returnType?: string;
	readonly returnDescription?: string;
};

type ApiMemberName = keyof Api & { $: EngineCore };

export const API_METHOD_METADATA = {
	$: {
		description: 'Returns the active Game instance.',
		parameters: [],
	},
	display_width: {
		description: 'Returns the current display width in pixels.',
		parameters: [],
		returnType: 'number',
		returnDescription: 'Viewport width in pixels.',
	},
	display_height: {
		description: 'Returns the current display height in pixels.',
		parameters: [],
		returnType: 'number',
		returnDescription: 'Viewport height in pixels.',
	},
	get_cpu_freq_hz: {
		description: 'Returns the current runtime CPU frequency in hertz.',
		parameters: [],
		returnType: 'number',
		returnDescription: 'The active runtime CPU frequency in hertz.',
	},
	set_cpu_freq_hz: {
		description: 'Sets the runtime CPU frequency in hertz and immediately updates the per-frame cycle budget.',
		parameters: [
			{ name: 'cpuHz', description: 'Positive safe integer CPU frequency in hertz.' },
		],
		returnType: 'void',
	},
	mousebtn: {
		description: 'Checks whether a pointer button is currently pressed.',
		parameters: [
			{ name: 'button', description: 'Pointer button index (0=Primary, 1=Secondary, 2=Auxiliary, 3=Back, 4=Forward).' },
		],
		returnType: 'boolean',
		returnDescription: 'True while the button is held down.',
	},
	mousebtnp: {
		description: 'Checks whether a pointer button was pressed this frame.',
		parameters: [
			{ name: 'button', description: 'Pointer button index (0=Primary, 1=Secondary, 2=Auxiliary, 3=Back, 4=Forward).' },
		],
		returnType: 'boolean',
		returnDescription: 'True only on the frame the button is pressed.',
	},
	mousebtnr: {
		description: 'Checks whether a pointer button was released this frame.',
		parameters: [
			{ name: 'button', description: 'Pointer button index (0=Primary, 1=Secondary, 2=Auxiliary, 3=Back, 4=Forward).' },
		],
		returnType: 'boolean',
		returnDescription: 'True only on the frame the button is released.',
	},
	keyboard: {
		description: 'Returns the keyboard input handler for the console player.',
		parameters: [],
		returnType: 'InputHandler',
		returnDescription: 'Native input handler instance.',
	},
	mousepos: {
		description: 'Returns the pointer position mapped into the game viewport.',
		parameters: [],
		returnType: 'PointerViewport',
		returnDescription: '{ x, y, valid, inside } in viewport coordinates.',
	},
	pointer_screen_position: {
		description: 'Returns the raw pointer screen position.',
		parameters: [],
		returnType: 'PointerVector',
		returnDescription: '{ x, y, valid } in screen coordinates.',
	},
	pointer_delta: {
		description: 'Returns the pointer movement delta since last frame.',
		parameters: [],
		returnType: 'PointerVector',
		returnDescription: '{ x, y, valid } delta values.',
	},
	pointer_viewport_position: {
		description: 'Returns the pointer position mapped into the game viewport.',
		parameters: [],
		returnType: 'PointerViewport',
		returnDescription: '{ x, y, valid, inside } in viewport coordinates.',
	},
	mousewheel: {
		description: 'Returns the pointer wheel delta.',
		parameters: [],
		returnType: 'PointerWheel',
		returnDescription: '{ value, valid } wheel delta.',
	},
	stat: {
		description: 'Returns numeric stat values; indices 32-36 cover pointer position/buttons/wheel.',
		parameters: [
			{ name: 'index', description: 'Stat index to query (integer).' },
		],
		returnType: 'number',
		returnDescription: 'Stat value (0 when unavailable/unsupported).',
	},
	mesh: {
		description: 'Submits a 3D mesh render request.',
		parameters: [
			{ name: 'mesh', description: 'Mesh resource/handle.' },
			{ name: 'matrix', description: 'Transform matrix.' },
			{ name: 'options', optional: true, description: 'Optional mesh render options (joint_matrices, morph_weights, receive_shadow).' },
		],
		returnType: 'void',
	},
	particle: {
		description: 'Submits a particle render request.',
		parameters: [
			{ name: 'position', description: 'Particle position as a vec3 array.' },
			{ name: 'size', description: 'Particle size in pixels.' },
			{ name: 'colorvalue', description: 'Palette index (number) or a color object.' },
			{ name: 'options', optional: true, description: 'Optional particle options (texture, ambient_mode, ambient_factor).' },
		],
		returnType: 'void',
	},
	set_camera: {
		description: 'Sets the active 3D camera matrices for rendering.',
		parameters: [
			{ name: 'view', description: 'View matrix (16 numbers).' },
			{ name: 'proj', description: 'Projection matrix (16 numbers).' },
			{ name: 'eye', description: 'Camera position as a vec3 array.' },
		],
		returnType: 'void',
	},
	skybox: {
		description: 'Sets the skybox face image ids (posx, negx, posy, negy, posz, negz). Faces must be atlassed and mapped into the primary or secondary atlas slot.',
		parameters: [
			{ name: 'posx', description: 'Positive X face image id.' },
			{ name: 'negx', description: 'Negative X face image id.' },
			{ name: 'posy', description: 'Positive Y face image id.' },
			{ name: 'negy', description: 'Negative Y face image id.' },
			{ name: 'posz', description: 'Positive Z face image id.' },
			{ name: 'negz', description: 'Negative Z face image id.' },
		],
		returnType: 'void',
	},
	put_ambient_light: {
		description: 'Submits an ambient light contribution for the current frame.',
		parameters: [
			{ name: 'id', description: 'Stable light identifier for this frame.' },
			{ name: 'colorvalue', description: 'Palette index, color object, or vec3 RGB array.' },
			{ name: 'intensity', description: 'Ambient light intensity scalar.' },
		],
		returnType: 'void',
	},
	put_directional_light: {
		description: 'Submits a directional light for the current frame.',
		parameters: [
			{ name: 'id', description: 'Stable light identifier for this frame.' },
			{ name: 'orientation', description: 'Light direction as a vec3 array or { x, y, z } object.' },
			{ name: 'colorvalue', description: 'Palette index, color object, or vec3 RGB array.' },
			{ name: 'intensity', description: 'Directional light intensity scalar.' },
		],
		returnType: 'void',
	},
	put_point_light: {
		description: 'Submits a point light for the current frame.',
		parameters: [
			{ name: 'id', description: 'Stable light identifier for this frame.' },
			{ name: 'position', description: 'Light position as a vec3 array or { x, y, z } object.' },
			{ name: 'colorvalue', description: 'Palette index, color object, or vec3 RGB array.' },
			{ name: 'range', description: 'Point light range in world units.' },
			{ name: 'intensity', description: 'Point light intensity scalar.' },
		],
		returnType: 'void',
	},
	create_font: {
		description: 'Creates a runtime bitmap font from a Lua definition table.',
		parameters: [
			{ name: 'definition', description: 'Font definition table: { glyphs = { ["A"]="imgid", ... }, advance_padding? = number }' },
		],
		returnType: 'Font',
		returnDescription: 'Native font handle for direct glyph-submission code.',
	},
	cartdata: {
		description: 'Sets the persistent storage namespace for this cart (used by dget/dset).',
		parameters: [
			{ name: 'namespace', description: 'Storage namespace key.' },
		],
		returnType: 'void',
	},
	list_builtins: {
		description: 'Returns the list of builtin Lua identifiers used by the runtime.',
		parameters: [],
		returnType: 'table',
		returnDescription: 'Array-like table of builtin identifier names.',
	},
	get_default_font: {
		description: 'Returns the default runtime font handle.',
		parameters: [],
		returnType: 'Font',
		returnDescription: 'Native Font instance.',
	},
	dset: {
		description: 'Writes a number to persistent cart storage.',
		parameters: [
			{ name: 'index', description: 'Storage slot index (integer).' },
			{ name: 'value', description: 'Numeric value to persist.' },
		],
		returnType: 'void',
	},
	dget: {
		description: 'Reads a number from persistent cart storage.',
		parameters: [
			{ name: 'index', description: 'Storage slot index (integer).' },
		],
		returnType: 'number',
		returnDescription: 'Stored numeric value.',
	},
	set_sprite_parallax_rig: {
		description: 'Sets global sprite parallax rig values for the current frame.',
		parameters: [
			{ name: 'vy', description: 'Vertical wobble amplitude in pixels.' },
			{ name: 'scale', description: 'Base scale factor for parallax.' },
			{ name: 'impact', description: 'Impact scale amplitude (sign selects side).' },
			{ name: 'impact_t', description: 'Seconds since last impact.' },
			{ name: 'bias_px', description: 'Signed baseline vertical bias in pixels.' },
			{ name: 'parallax_strength', description: 'Global multiplier for vertical parallax offsets.' },
			{ name: 'scale_strength', description: 'Global multiplier for parallax base scale response.' },
			{ name: 'flip_strength', description: 'Bias flip amount (0..1) during the flip window.' },
			{ name: 'flip_window', description: 'Seconds for the bias flip window.' },
		],
		returnType: 'void',
	},
	world: {
		description: 'Returns the active World instance.',
		parameters: [],
		returnType: 'World',
		returnDescription: 'Native World instance.',
	},
	oget: {
		description: 'Fetches a world object by id from the current space.',
		parameters: [
			{ name: 'id', description: 'World object id.' },
		],
		returnType: 'WorldObject | nil',
		returnDescription: 'The object instance, or nil when not found.',
	},
	world_objects: {
		description: 'Returns all world objects currently registered in the world.',
		parameters: [],
		returnType: 'WorldObject[]',
		returnDescription: 'Array of world objects across spaces.',
	},
	attach_fsm: {
		description: 'Attaches a registered finite-state machine to a world object.',
		parameters: [
			{ name: 'id', description: 'World object identifier.' },
			{ name: 'machine_id', description: 'FSM id registered via define_fsm/buildFSMDefinition.' },
		],
		returnType: 'void',
	},
	attach_bt: {
		description: 'Attaches a registered behaviour tree to a world object.',
		parameters: [
			{ name: 'object_id', description: 'World object identifier.' },
			{ name: 'tree_id', description: 'Behaviour tree id.' },
		],
		returnType: 'void',
	},
	define_component: {
		description: 'Registers a Lua component definition.',
		parameters: [
			{ name: 'descriptor', description: 'Component descriptor (def_id, class/defaults, optional fsms/components/effects/bts).' },
		],
		returnType: 'void',
	},
		define_prefab: {
			description: 'Registers a prefab descriptor that can be spawned later.',
			parameters: [
				{ name: 'descriptor', description: 'Prefab descriptor (def_id, class/defaults, optional fsms/components/effects/bts).' },
			],
			returnType: 'void',
		},
		define_subsystem: {
			description: 'Registers a world-owned subsystem descriptor that can be instantiated later.',
			parameters: [
				{ name: 'descriptor', description: 'Subsystem descriptor (def_id, class/defaults, optional fsms). Subsystems do not declare components, effects, or behaviour trees.' },
			],
			returnType: 'void',
		},
		inst_subsystem: {
			description: 'Creates a subsystem instance from a previously registered subsystem descriptor.',
			parameters: [
				{ name: 'definition_id', description: 'Id of the subsystem definition registered via define_subsystem.' },
				{ name: 'overrides', optional: true, description: 'Optional overrides applied after the descriptor defaults/overrides.' },
			],
			returnType: 'Subsystem',
			returnDescription: 'The created subsystem instance.',
		},
	attach_component: {
		description: 'Attaches a component instance or component type (by id) to a world object.',
		parameters: [
			{ name: 'object_or_id', description: 'WorldObject instance or world object id.' },
			{ name: 'component_or_type', description: 'Component instance or component typename/id.' },
		],
		returnType: 'void',
	},
	define_effect: {
		description: 'Registers an action-effect definition with the ActionEffectRegistry.',
		parameters: [
			{ name: 'descriptor', description: 'Action effect definition (id, handler, optional event/cooldown_ms).' },
			{ name: 'opts', optional: true, description: 'Optional registry options such as schema/validation.' },
		],
		returnType: 'void',
	},
	inst: {
		description: 'Spawns a WorldObject instance from a previously defined descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Id of the world object definition registered via define_prefab.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied after the descriptor defaults/overrides.' },
		],
		returnType: 'WorldObject',
		returnDescription: 'The spawned WorldObject instance.',
	},
	grant_effect: {
		description: 'Grants a registered effect definition to a world object with an ActionEffectComponent.',
		parameters: [
			{ name: 'object_id', description: 'World object receiving the effect.' },
			{ name: 'effect_id', description: 'Effect id to grant.' },
		],
		returnType: 'void',
	},
	trigger_effect: {
		description: 'Triggers an effect for a world object. Payload is forwarded to the effect handler as intent.',
		parameters: [
			{ name: 'object_id', description: 'Identifier of the world object triggering the effect.' },
			{ name: 'effect_id', description: 'Effect id to trigger.' },
			{ name: 'options', optional: true, description: 'Optional trigger options, e.g. { payload = ... }.' },
		],
		returnType: 'ActionEffectTriggerResult',
		returnDescription: 'One of "ok", "on_cooldown", or "failed".',
	},
	timeline: {
		description: 'Timeline module table with constructors/helpers: timeline.new(def), timeline.range(frame_count), timeline.expand_frames(frames [, repetitions]), timeline.build_frame_sequence(sequence), timeline.build_pingpong_frames(frames [, include_endpoints]).',
		returnType: 'table',
		returnDescription: 'Timeline module table.',
	},
	rget: {
		description: 'Looks up a registered object by id in the global registry.',
		parameters: [
			{ name: 'id', description: 'Registry id to fetch.' },
		],
		returnType: 'Registerable | nil',
		returnDescription: 'Registered object, or nil when not found.',
	},
		subsystem: {
			description: 'Fetches a registered subsystem by id.',
			parameters: [
				{ name: 'id', description: 'Subsystem identifier.' },
			],
			returnType: 'Subsystem | nil',
			returnDescription: 'Subsystem instance, or nil when not found.',
		},
	emit: {
		description: 'Broadcasts an engine event via the global event bus.',
		parameters: [
			{ name: 'event_name', description: 'Name of the event to emit.' },
			{ name: 'emitter_or_id', optional: true, description: 'Optional emitter instance or id.' },
			{ name: 'payload', optional: true, description: 'Optional event payload.' },
		],
		returnType: 'void',
	},
	timelines: {
		description: 'Lists all registered EventTimeline instances.',
		parameters: [],
		returnType: 'EventTimeline[]',
		returnDescription: 'Array of EventTimeline instances.',
	},
	taskgate: {
		description: 'Fetches or creates a named gate group for task coordination.',
		parameters: [
			{ name: 'name', description: 'Gate group identifier.' },
		],
		returnType: 'GateGroup',
		returnDescription: 'Gate group instance.',
	},
	rungate: {
		description: 'Returns the global run gate group for coarse execution control.',
		parameters: [],
		returnType: 'GateGroup',
		returnDescription: 'Global run gate group.',
	},
	runtime: {
		description: 'Returns the active runtime instance.',
		parameters: [],
		returnType: 'Runtime',
		returnDescription: 'Runtime singleton.',
	},
	reboot: {
		description: 'Reboots the runtime: reloads the program and resets the world.',
		parameters: [],
		returnType: 'void',
	},
	define_fsm: {
		description: 'Registers a finite-state machine blueprint.',
		parameters: [
			{ name: 'id', description: 'FSM id.' },
			{ name: 'blueprint', description: 'FSM blueprint object.' },
		],
		returnType: 'void',
	},
	define_bt: {
		description: 'Defines a behaviour tree (currently not implemented in the runtime API).',
		parameters: [
			{ name: '_descriptor', description: 'Behaviour tree descriptor.' },
		],
		returnType: 'void',
	},
} as const satisfies Record<ApiMemberName, ApiMethodMetadata>;
