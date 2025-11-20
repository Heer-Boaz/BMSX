export type ConsoleApiParameterMetadata = {
	readonly name: string;
	readonly optional?: boolean;
	readonly description?: string;
};

export type ConsoleApiMethodMetadata = {
	readonly optionalParameters?: readonly string[];
	readonly description?: string;
	readonly parameters?: readonly ConsoleApiParameterMetadata[];
};

export const CONSOLE_API_METHOD_METADATA: Record<string, ConsoleApiMethodMetadata> = {
	add_component: {
		optionalParameters: ['options'],
		description: 'Adds an engine component instance to an existing world object.',
		parameters: [
			{ name: 'object_id', description: 'Identifier of the world object that receives the component.' },
			{ name: 'component_ref', description: 'Component class name to attach.' },
			{ name: 'options', optional: true, description: 'Optional component configuration such as state overrides.' },
		],
	},
	attach_bt: {
		description: 'Attaches a registered behaviour tree to a world object.',
		parameters: [
			{ name: 'object_id', description: 'World object identifier.' },
			{ name: 'tree_id', description: 'Behaviour tree id registered via register_behavior_tree.' },
		],
	},
	attach_component: {
		description: 'Attaches a Lua component definition (by id) to a world object.',
		parameters: [
			{ name: 'object_id', description: 'World object identifier.' },
			{ name: 'component', description: 'Component id string or descriptor with id/id_local/state.' },
		],
	},
	attach_fsm: {
		description: 'Attaches a registered finite-state machine to a world object.',
		parameters: [
			{ name: 'object_id', description: 'World object identifier.' },
			{ name: 'machine_id', description: 'FSM id registered via register_prepared_fsm.' },
		],
	},
	cartdata: {
		description: 'Sets the persistent storage namespace for this cart (used by dget/dset).',
		parameters: [
			{ name: 'namespace', description: 'Unique storage namespace key.' },
		],
	},
	cls: {
		optionalParameters: ['colorindex'],
		description: 'Clears the console render surface.',
		parameters: [
			{ name: 'colorindex', optional: true, description: 'Palette index to fill the screen with (defaults to 0).' },
		],
	},
	define_effect: {
		description: 'Registers a Lua input-action effect with a coded on_trigger handler and optional event/cooldown metadata.',
		parameters: [
			{ name: 'descriptor', description: 'Effect descriptor with id, on_trigger(ctx,payload) handler, optional event override, and optional cooldown_ms.' },
		],
	},
	define_component: {
		description: 'Registers a Lua component (alias of register_component).',
		parameters: [
			{ name: 'descriptor', description: 'Component descriptor table defining handlers and defaults.' },
		],
	},
	define_component_preset: {
		description: 'Registers a reusable component preset (alias of register_component_preset).',
		parameters: [
			{ name: 'descriptor', description: 'Preset descriptor table with id and build function/options.' },
		],
	},
	define_service: {
		description: 'Registers a Lua service (alias of register_service).',
		parameters: [
			{ name: 'descriptor', description: 'Service descriptor with id, hooks (on_boot, on_activate, on_tick, etc.), and optional systems/effects/tags.' },
		],
	},
	despawn: {
		optionalParameters: ['options'],
		description: 'Removes a world object from the world.',
		parameters: [
			{ name: 'id', description: 'Identifier of the world object to despawn.' },
			{ name: 'options', optional: true, description: 'Optional flags such as disposing the object immediately.' },
		],
	},
	dget: {
		description: 'Reads a number from persistent cart storage.',
		parameters: [
			{ name: 'index', description: 'Storage slot index (integer).' },
		],
	},
	dset: {
		description: 'Writes a number to persistent cart storage.',
		parameters: [
			{ name: 'index', description: 'Storage slot index (integer).' },
			{ name: 'value', description: 'Numeric value to persist.' },
		],
	},
	emit: {
		optionalParameters: ['emitter_or_id', 'payload'],
		description: 'Broadcasts an engine event via the global event bus.',
		parameters: [
			{ name: 'event_name', description: 'Name of the event to emit.' },
			{ name: 'emitter_or_id', optional: true, description: 'Emitter instance or identifier that produced the event.' },
			{ name: 'payload', optional: true, description: 'Optional payload delivered to event listeners.' },
		],
	},
	emit_gameplay: {
		optionalParameters: ['payload'],
		description: 'Dispatches a gameplay-scoped event to listeners.',
		parameters: [
			{ name: 'event_name', description: 'Name of the gameplay event to emit.' },
			{ name: 'emitter_or_id', description: 'Emitter identifier associated with the event.' },
			{ name: 'payload', optional: true, description: 'Optional gameplay event payload.' },
		],
	},
	grant_effect: {
		description: 'Grants a registered effect definition to a world object with an ActionEffectComponent.',
		parameters: [
			{ name: 'object_id', description: 'World object receiving the effect.' },
			{ name: 'effect_id', description: 'Identifier of the effect to grant.' },
		],
	},
	music: {
		optionalParameters: ['options'],
		description: 'Starts or stops background music playback.',
		parameters: [
			{ name: 'id', description: 'Identifier of the music track to play, or null to stop playback.' },
			{ name: 'options', optional: true, description: 'Optional playback options such as modulation settings.' },
		],
	},
	pause_audio: {
		description: 'Pauses all console audio playback.',
		parameters: [],
	},
	print: {
		optionalParameters: ['text'],
		description: 'Prints text to the console output log. If no text is provided, a blank line is printed.',
		parameters: [
			{ name: 'text', optional: true, description: 'Text string to print to the console log.' },
		],
	},
	register_effect: {
		description: 'Registers a Lua effect descriptor (same shape as define_effect).',
		parameters: [
			{ name: 'descriptor', description: 'Effect descriptor with id, on_trigger(ctx,payload), optional event override, and optional cooldown_ms.' },
		],
	},
	register_behavior_tree: {
		description: 'Registers a behaviour tree definition provided as a descriptor table.',
		parameters: [
			{ name: 'descriptor', description: 'Behaviour tree descriptor containing the root node definition.' },
		],
	},
	register_component: {
		description: 'Registers a Lua component definition.',
		parameters: [
			{ name: 'descriptor', description: 'Component descriptor table defining handlers and defaults.' },
		],
	},
	register_component_preset: {
		description: 'Registers a reusable component preset.',
		parameters: [
			{ name: 'descriptor', description: 'Preset descriptor table with id and build function/options.' },
		],
	},
	register_prepared_fsm: {
		optionalParameters: ['options'],
		description: 'Registers a prepared finite-state machine blueprint with the runtime.',
		parameters: [
			{ name: 'id', description: 'Identifier for the FSM to register.' },
			{ name: 'blueprint', description: 'FSM blueprint object produced by the builder.' },
			{ name: 'options', optional: true, description: 'Optional registration settings, e.g. immediate setup.' },
		],
	},
	register_service: {
		description: 'Registers a Lua service descriptor.',
		parameters: [
			{ name: 'descriptor', description: 'Service descriptor with id, lifecycle hooks, optional systems/effects/tags, and auto_activate flag.' },
		],
	},
	register_world_object: {
		description: 'Registers a world object descriptor that can be spawned later.',
		parameters: [
			{ name: 'descriptor', description: 'Descriptor with id, class/class_ref, components, fsms, behavior_trees, effects, tags, and defaults.' },
		],
	},
	remove_component: {
		description: 'Removes and disposes a component by id from a world object.',
		parameters: [
			{ name: 'object_id', description: 'World object identifier.' },
			{ name: 'component_id', description: 'Component id or local id to remove.' },
		],
	},
	trigger_effect: {
		optionalParameters: ['options'],
		description: 'Triggers an effect for a world object. Payload is forwarded to the effect handler as intent.',
		parameters: [
			{ name: 'object_id', description: 'Identifier of the world object triggering the effect.' },
			{ name: 'effect_id', description: 'Effect identifier to trigger.' },
			{ name: 'options', optional: true, description: 'Optional request options such as payload data.' },
		],
	},
	resume_audio: {
		description: 'Resumes audio after a pause_audio call.',
		parameters: [],
	},
	rget: {
		description: 'Looks up a registered object by id in the global registry.',
		parameters: [
			{ name: 'id', description: 'Registry id to fetch.' },
		],
	},
	registry: {
		description: 'Returns the global registry instance.',
		parameters: [],
	},
	registry_ids: {
		description: 'Lists all registry ids currently registered.',
		parameters: [],
	},
	rungate: {
		description: 'Returns the global run gate group for coarse execution control.',
		parameters: [],
	},
	service: {
		description: 'Fetches a registered service by id.',
		parameters: [
			{ name: 'id', description: 'Service identifier.' },
		],
	},
	services: {
		description: 'Returns all registered services.',
		parameters: [],
	},
	set_master_volume: {
		description: 'Sets master audio volume (0-1).',
		parameters: [
			{ name: 'volume', description: 'Volume scalar between 0 and 1.' },
		],
	},
	sfx: {
		optionalParameters: ['options'],
		description: 'Plays a sound effect by identifier.',
		parameters: [
			{ name: 'id', description: 'Identifier of the sound effect to play.' },
			{ name: 'options', optional: true, description: 'Optional playback options such as pitch or volume modulation.' },
		],
	},
	spawn_object: {
		optionalParameters: ['overrides'],
		description: 'Instantiates a world object from a registered descriptor.',
		parameters: [
			{ name: 'definition_id', description: 'Identifier of the registered world object definition.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied to the spawned instance.' },
		],
	},
	spawn_world_object: {
		optionalParameters: ['options'],
		description: 'Creates a world object from the given class reference.',
		parameters: [
			{ name: 'class_ref', description: 'World object class reference or identifier.' },
			{ name: 'options', optional: true, description: 'Optional spawn options such as position, orientation, or components.' },
		],
	},
	stat: {
		description: 'Returns numeric stat values; indices 32-36 cover pointer position/buttons/wheel.',
		parameters: [
			{ name: 'index', description: 'Stat index to query.' },
		],
	},
	stop_music: {
		description: 'Stops music playback.',
		parameters: [],
	},
	stop_sfx: {
		description: 'Stops all sound effects.',
		parameters: [],
	},
	taskgate: {
		description: 'Fetches or creates a named gate group for task coordination.',
		parameters: [
			{ name: 'name', description: 'Gate group identifier.' },
		],
	},
	timelines: {
		description: 'Lists all registered EventTimeline instances.',
		parameters: [],
	},
	world: {
		description: 'Returns the active World instance.',
		parameters: [],
	},
	world_object: {
		description: 'Fetches a world object by id or null if not found.',
		parameters: [
			{ name: 'id', description: 'World object identifier.' },
		],
	},
	world_objects: {
		description: 'Returns all world objects currently registered in the World.',
		parameters: [],
	},
	write: {
		optionalParameters: ['x', 'y', 'colorindex'],
		description: 'Writes text to screen. Coordinates are in pixels. If x and y are not provided, text will be written at the current cursor position.',
		parameters: [
			{ name: 'text', optional: false, description: 'Text string to write to the screen.' },
			{ name: 'x', optional: true, description: 'X coordinate to start writing the text at.' },
			{ name: 'y', optional: true, description: 'Y coordinate to start writing the text at.' },
			{ name: 'colorindex', optional: true, description: 'Palette index to use for the text color.' },
		],
	},
	write_with_font: {
		optionalParameters: ['x', 'y', 'colorindex', 'font'],
		description: 'Writes text to screen using a specific font. Coordinates are in pixels. If x and y are not provided, text will be written at the current cursor position. If font is not provided, the default font will be used.',
		parameters: [
			{ name: 'text', optional: false, description: 'Text string to write to the screen.' },
			{ name: 'x', optional: true, description: 'X coordinate to start writing the text at.' },
			{ name: 'y', optional: true, description: 'Y coordinate to start writing the text at.' },
			{ name: 'colorindex', optional: true, description: 'Palette index to use for the text color.' },
			{ name: 'fontid', optional: true, description: 'Identifier of the font to use for rendering the text.' },
		],
	},
} as const;
