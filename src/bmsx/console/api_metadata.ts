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
	print: {
		optionalParameters: ['text'],
		description: 'Prints text to the console output log. If no text is provided, a blank line is printed.',
		parameters: [
			{ name: 'text', optional: true, description: 'Text string to print to the console log.' },
		],
	},
	add_component: {
		optionalParameters: ['options'],
		description: 'Adds a component instance to an existing world object.',
		parameters: [
			{ name: 'objectId', description: 'Identifier of the world object that receives the component.' },
			{ name: 'componentRef', description: 'Component class name or preset identifier to attach.' },
			{ name: 'options', optional: true, description: 'Optional component configuration such as state overrides.' },
		],
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
	cls: {
		optionalParameters: ['colorindex'],
		description: 'Clears the console render surface.',
		parameters: [
			{ name: 'colorindex', optional: true, description: 'Palette index to fill the screen with (defaults to 0).' },
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
	emit: {
		optionalParameters: ['emitterOrId', 'payload'],
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
	emit_presentation: {
		optionalParameters: ['payload'],
		description: 'Dispatches a presentation-scoped event to listeners.',
		parameters: [
			{ name: 'event_name', description: 'Name of the presentation event to emit.' },
			{ name: 'emitter_or_id', description: 'Emitter identifier associated with the event.' },
			{ name: 'payload', optional: true, description: 'Optional presentation event payload.' },
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
	register_prepared_fsm: {
		optionalParameters: ['options'],
		description: 'Registers a prepared finite-state machine blueprint with the runtime.',
		parameters: [
			{ name: 'id', description: 'Identifier for the FSM to register.' },
			{ name: 'blueprint', description: 'FSM blueprint object produced by the builder.' },
			{ name: 'options', optional: true, description: 'Optional registration settings, e.g. immediate setup.' },
		],
	},
	register_behavior_tree: {
		description: 'Registers a behaviour tree definition provided as a descriptor table.',
		parameters: [
			{ name: 'descriptor', description: 'Behaviour tree descriptor containing the root node definition.' },
		],
	},
	request_ability: {
		optionalParameters: ['options'],
		description: 'Queues an ability execution request for a world object.',
		parameters: [
			{ name: 'object_id', description: 'Identifier of the world object requesting the ability.' },
			{ name: 'ability_id', description: 'Ability identifier to trigger.' },
			{ name: 'options', optional: true, description: 'Optional request options such as payload data or source information.' },
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
} as const;
