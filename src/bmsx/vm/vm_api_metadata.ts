import type { EngineCore } from '../core/engine_core';
import type { BmsxVMApi } from './vm_api';

export type VMApiParameterMetadata = {
	readonly name: string;
	readonly optional?: boolean;
	readonly description?: string;
};

export type VMApiMethodMetadata = {
	readonly description?: string;
	readonly parameters?: readonly VMApiParameterMetadata[];
	readonly returnType?: string;
	readonly returnDescription?: string;
};

type VMApiMemberName = keyof BmsxVMApi & { $: EngineCore };

export const VM_API_METHOD_METADATA = {
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
		returnType: 'VMPointerViewport',
		returnDescription: '{ x, y, valid, inside } in viewport coordinates.',
	},
	pointer_screen_position: {
		description: 'Returns the raw pointer screen position.',
		parameters: [],
		returnType: 'VMPointerVector',
		returnDescription: '{ x, y, valid } in screen coordinates.',
	},
	pointer_delta: {
		description: 'Returns the pointer movement delta since last frame.',
		parameters: [],
		returnType: 'VMPointerVector',
		returnDescription: '{ x, y, valid } delta values.',
	},
	pointer_viewport_position: {
		description: 'Returns the pointer position mapped into the game viewport.',
		parameters: [],
		returnType: 'VMPointerViewport',
		returnDescription: '{ x, y, valid, inside } in viewport coordinates.',
	},
	mousewheel: {
		description: 'Returns the pointer wheel delta.',
		parameters: [],
		returnType: 'VMPointerWheel',
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
	cls: {
		description: 'Clears the screen and resets the text cursor.',
		parameters: [
			{ name: 'colorindex', optional: true, description: 'Palette index to fill the screen with (defaults to 0).' },
		],
		returnType: 'void',
	},
	rect: {
		description: 'Draws a rectangle outline.',
		parameters: [
			{ name: 'x0', description: 'Left coordinate in pixels.' },
			{ name: 'y0', description: 'Top coordinate in pixels.' },
			{ name: 'x1', description: 'Right coordinate in pixels.' },
			{ name: 'y1', description: 'Bottom coordinate in pixels.' },
			{ name: 'z', description: 'Z coordinate for ordering.' },
			{ name: 'colorindex', description: 'Palette index for the outline color.' },
		],
		returnType: 'void',
	},
	rectfill: {
		description: 'Draws a filled rectangle.',
		parameters: [
			{ name: 'x0', description: 'Left coordinate in pixels.' },
			{ name: 'y0', description: 'Top coordinate in pixels.' },
			{ name: 'x1', description: 'Right coordinate in pixels.' },
			{ name: 'y1', description: 'Bottom coordinate in pixels.' },
			{ name: 'z', description: 'Z coordinate for ordering.' },
			{ name: 'colorindex', description: 'Palette index for the fill color.' },
		],
		returnType: 'void',
	},
	rectfill_color: {
		description: 'Draws a filled rectangle using a raw color value.',
		parameters: [
			{ name: 'x0', description: 'Left coordinate in pixels.' },
			{ name: 'y0', description: 'Top coordinate in pixels.' },
			{ name: 'x1', description: 'Right coordinate in pixels.' },
			{ name: 'y1', description: 'Bottom coordinate in pixels.' },
			{ name: 'z', description: 'Z coordinate for ordering.' },
			{ name: 'colorvalue', description: 'Palette index (number) or a color object.' },
		],
		returnType: 'void',
	},
	sprite: {
		description: 'Draws an image resource at the given position.',
		parameters: [
			{ name: 'img_id', description: 'Image asset id (imgid).' },
			{ name: 'x', description: 'X coordinate in pixels.' },
			{ name: 'y', description: 'Y coordinate in pixels.' },
			{ name: 'z', description: 'Z coordinate for ordering.' },
			{ name: 'options', optional: true, description: 'Optional sprite options (scale: number or {x,y}, flip_h, flip_v, colorize, parallax_weight).' },
		],
		returnType: 'void',
	},
	poly: {
		description: 'Draws a polygon/line strip.',
		parameters: [
			{ name: 'points', description: 'Polygon points array.' },
			{ name: 'z', description: 'Z coordinate for ordering.' },
			{ name: 'colorvalue', description: 'Palette index (number) or a color object.' },
			{ name: 'thickness', optional: true, description: 'Optional line thickness.' },
			{ name: 'layer', optional: true, description: 'Optional render layer.' },
		],
		returnType: 'void',
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
	write: {
		description: 'Writes text to the screen. If x/y are omitted, uses the current text cursor and auto-advances.',
		parameters: [
			{ name: 'text', description: 'Text to write.' },
			{ name: 'x', optional: true, description: 'Optional X coordinate in pixels.' },
			{ name: 'y', optional: true, description: 'Optional Y coordinate in pixels.' },
			{ name: 'z', optional: true, description: 'Optional Z coordinate for ordering.' },
			{ name: 'colorindex', optional: true, description: 'Optional palette index for the text color.' },
			{ name: 'options', optional: true, description: 'Optional text options (color, background_color, wrap_chars, center_block_width, glyph_start, glyph_end, align, baseline, layer, font, auto_advance).' },
		],
		returnType: 'void',
	},
	write_color: {
		description: 'Writes text to the screen using a raw color value. If x/y are omitted, uses the current text cursor and auto-advances.',
		parameters: [
			{ name: 'text', description: 'Text to write.' },
			{ name: 'x', optional: true, description: 'Optional X coordinate in pixels.' },
			{ name: 'y', optional: true, description: 'Optional Y coordinate in pixels.' },
			{ name: 'z', optional: true, description: 'Optional Z coordinate for ordering.' },
			{ name: 'colorvalue', optional: true, description: 'Palette index (number) or a color object.' },
		],
		returnType: 'void',
	},
	write_with_font: {
		description: 'Writes text to the screen using a specific VMFont instance.',
		parameters: [
			{ name: 'text', description: 'Text to write.' },
			{ name: 'x', optional: true, description: 'Optional X coordinate in pixels.' },
			{ name: 'y', optional: true, description: 'Optional Y coordinate in pixels.' },
			{ name: 'z', optional: true, description: 'Optional Z coordinate for ordering.' },
			{ name: 'colorindex', optional: true, description: 'Optional palette index for the text color.' },
			{ name: 'font', optional: true, description: 'Optional VMFont to use (defaults to the VM font).' },
		],
		returnType: 'void',
	},
	action_triggered: {
		description: 'Checks whether an input action definition is triggered for a given player.',
		parameters: [
			{ name: 'actiondefinition', description: 'Action definition string (e.g. "jump[p]" or "pointer_primary[jr]").' },
			{ name: 'playerindex', optional: true, description: 'Player index (1-based).' },
		],
		returnType: 'boolean',
		returnDescription: 'True when the action definition evaluates to triggered.',
	},
	cartdata: {
		description: 'Sets the persistent storage namespace for this cart (used by dget/dset).',
		parameters: [
			{ name: 'namespace', description: 'Storage namespace key.' },
		],
		returnType: 'void',
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
	sfx: {
		description: 'Plays a sound effect by identifier.',
		parameters: [
			{ name: 'id', description: 'Sound effect id.' },
			{ name: 'options', optional: true, description: 'Optional playback options.' },
		],
		returnType: 'void',
	},
	stop_sfx: {
		description: 'Stops the currently playing sound effect.',
		parameters: [],
		returnType: 'void',
	},
	music: {
		description: 'Starts or stops background music playback.',
		parameters: [
			{ name: 'id', optional: true, description: 'Music track id (omit/nil to stop playback).' },
			{ name: 'options', optional: true, description: 'Optional playback options.' },
		],
		returnType: 'void',
	},
	stop_music: {
		description: 'Stops background music playback.',
		parameters: [],
		returnType: 'void',
	},
	set_master_volume: {
		description: 'Sets master audio volume.',
		parameters: [
			{ name: 'volume', description: 'Volume scalar between 0 and 1.' },
		],
		returnType: 'void',
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
	pause_audio: {
		description: 'Pauses console audio playback.',
		parameters: [],
		returnType: 'void',
	},
	resume_audio: {
		description: 'Resumes audio after a pause_audio call.',
		parameters: [],
		returnType: 'void',
	},
	world: {
		description: 'Returns the active World instance.',
		parameters: [],
		returnType: 'World',
		returnDescription: 'Native World instance.',
	},
	world_object: {
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
	define_world_object: {
		description: 'Registers a world object descriptor that can be spawned later.',
		parameters: [
			{ name: 'descriptor', description: 'World object descriptor (def_id, class/defaults, optional fsms/components/effects/bts).' },
		],
		returnType: 'void',
	},
	define_service: {
		description: 'Registers a service descriptor that can be instantiated later.',
		parameters: [
			{ name: 'descriptor', description: 'Service descriptor (def_id, class/defaults, optional fsms/components/effects/bts).' },
		],
		returnType: 'void',
	},
	create_service: {
		description: 'Creates a Service instance from a previously registered service descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Id of the service definition registered via define_service.' },
			{ name: 'defer_bind', optional: true, description: 'Optional flag to defer service binding.' },
		],
		returnType: 'Service',
		returnDescription: 'The created Service instance.',
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
	spawn_object: {
		description: 'Spawns a WorldObject instance from a previously defined descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Id of the world object definition registered via define_world_object.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied after the descriptor defaults/overrides.' },
		],
		returnType: 'WorldObject',
		returnDescription: 'The spawned WorldObject instance.',
	},
	spawn_sprite: {
		description: 'Spawns a SpriteObject instance from a previously defined descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Id of the sprite definition registered via define_world_object.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied after the descriptor defaults/overrides.' },
		],
		returnType: 'SpriteObject',
		returnDescription: 'The spawned SpriteObject instance.',
	},
	spawn_textobject: {
		description: 'Spawns a TextObject instance from a previously defined descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Id of the text object definition registered via define_world_object.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied after the descriptor defaults/overrides.' },
		],
		returnType: 'TextObject',
		returnDescription: 'The spawned TextObject instance.',
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
	new_timeline: {
		description: 'Creates a standalone Timeline instance from a definition.',
		parameters: [
			{ name: 'def', description: 'Timeline definition.' },
		],
		returnType: 'Timeline',
		returnDescription: 'New Timeline instance.',
	},
	timeline_range: {
		description: 'Builds a frame index array from 0 to frame_count - 1.',
		parameters: [
			{ name: 'frame_count', description: 'Number of frames to include in the range.' },
		],
		returnType: 'number[]',
		returnDescription: 'Array of frame indices.',
	},
	new_timeline_range: {
		description: 'Creates a Timeline instance with a 0..frame_count-1 frame range.',
		parameters: [
			{ name: 'def', description: 'Timeline definition including frame_count.' },
		],
		returnType: 'Timeline',
		returnDescription: 'New Timeline instance.',
	},
	rget: {
		description: 'Looks up a registered object by id in the global registry.',
		parameters: [
			{ name: 'id', description: 'Registry id to fetch.' },
		],
		returnType: 'Registerable | nil',
		returnDescription: 'Registered object, or nil when not found.',
	},
	service: {
		description: 'Fetches a registered service by id.',
		parameters: [
			{ name: 'id', description: 'Service identifier.' },
		],
		returnType: 'Service | nil',
		returnDescription: 'Service instance, or nil when not found.',
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
		description: 'Returns the active VM runtime instance.',
		parameters: [],
		returnType: 'BmsxVMRuntime',
		returnDescription: 'VM runtime singleton.',
	},
	reboot: {
		description: 'Reboots the VM: reloads the program and resets the world.',
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
		description: 'Defines a behaviour tree (currently not implemented in the VM API).',
		parameters: [
			{ name: '_descriptor', description: 'Behaviour tree descriptor.' },
		],
		returnType: 'void',
	},
	get_player_input: {
		description: 'Returns the InputHandler for a given player index.',
		parameters: [
			{ name: 'playerindex', optional: true, description: 'Player index (1-based).' },
		],
		returnType: 'InputHandler',
		returnDescription: 'Native input handler instance for the player.',
	},
} as const satisfies Record<VMApiMemberName, VMApiMethodMetadata>;
