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
		description: 'Adds a component instance to an existing world object.',
		parameters: [
			{ name: 'objectId', description: 'Identifier of the world object that receives the component.' },
			{ name: 'componentRef', description: 'Component class name or preset identifier to attach.' },
			{ name: 'options', optional: true, description: 'Optional component configuration such as state overrides.' },
		],
	},
	cls: {
		optionalParameters: ['colorIndex'],
		description: 'Clears the console render surface.',
		parameters: [
			{ name: 'colorIndex', optional: true, description: 'Palette index to fill the screen with (defaults to 0).' },
		],
	},
	define_sprite: {
		optionalParameters: ['opts'],
		description: 'Creates or updates a sprite definition in the console registry.',
		parameters: [
			{ name: 'index', description: 'Sprite slot index to define.' },
			{ name: 'bitmapId', description: 'Bitmap asset identifier used for the sprite.' },
			{ name: 'opts', optional: true, description: 'Additional sprite properties such as size, origin, colliders, or physics.' },
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
			{ name: 'eventName', description: 'Name of the event to emit.' },
			{ name: 'emitterOrId', optional: true, description: 'Emitter instance or identifier that produced the event.' },
			{ name: 'payload', optional: true, description: 'Optional payload delivered to event listeners.' },
		],
	},
	emit_gameplay: {
		optionalParameters: ['payload'],
		description: 'Dispatches a gameplay-scoped event to listeners.',
		parameters: [
			{ name: 'eventName', description: 'Name of the gameplay event to emit.' },
			{ name: 'emitterOrId', description: 'Emitter identifier associated with the event.' },
			{ name: 'payload', optional: true, description: 'Optional gameplay event payload.' },
		],
	},
	emit_presentation: {
		optionalParameters: ['payload'],
		description: 'Dispatches a presentation-scoped event to listeners.',
		parameters: [
			{ name: 'eventName', description: 'Name of the presentation event to emit.' },
			{ name: 'emitterOrId', description: 'Emitter identifier associated with the event.' },
			{ name: 'payload', optional: true, description: 'Optional presentation event payload.' },
		],
	},
	fget: {
		optionalParameters: ['flag'],
		description: 'Reads sprite flag bits from the sprite registry.',
		parameters: [
			{ name: 'index', description: 'Sprite index to query.' },
			{ name: 'flag', optional: true, description: 'Optional flag bit index (0-7); returns entire mask when omitted.' },
		],
	},
	load_map: {
		optionalParameters: ['tileSize'],
		description: 'Loads map tile data into the console tilemap buffer.',
		parameters: [
			{ name: 'data', description: 'Array of tile indices to copy into the map.' },
			{ name: 'width', description: 'Width of the provided tile data in tiles.' },
			{ name: 'height', description: 'Height of the provided tile data in tiles.' },
			{ name: 'tileSize', optional: true, description: 'Optional tile dimensions override for the loaded data.' },
		],
	},
	map: {
		optionalParameters: ['layer'],
		description: 'Draws a region of the tilemap to the screen.',
		parameters: [
			{ name: 'mapX', description: 'Tilemap X coordinate of the source region.' },
			{ name: 'mapY', description: 'Tilemap Y coordinate of the source region.' },
			{ name: 'screenX', description: 'Destination screen X coordinate in pixels.' },
			{ name: 'screenY', description: 'Destination screen Y coordinate in pixels.' },
			{ name: 'width', description: 'Width of the region to draw in tiles.' },
			{ name: 'height', description: 'Height of the region to draw in tiles.' },
			{ name: 'layer', optional: true, description: 'Optional render layer for the draw call.' },
		],
	},
	map_collides_rect: {
		optionalParameters: ['flagBit'],
		description: 'Checks if any tile within a rectangular region has a collision flag.',
		parameters: [
			{ name: 'mapX', description: 'Tilemap X coordinate of the region.' },
			{ name: 'mapY', description: 'Tilemap Y coordinate of the region.' },
			{ name: 'width', description: 'Width of the region to test in tiles.' },
			{ name: 'height', description: 'Height of the region to test in tiles.' },
			{ name: 'flagBit', optional: true, description: 'Optional collision flag bit to check (defaults to any flag).' },
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
			{ name: 'objectId', description: 'Identifier of the world object requesting the ability.' },
			{ name: 'abilityId', description: 'Ability identifier to trigger.' },
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
			{ name: 'definitionId', description: 'Identifier of the registered world object definition.' },
			{ name: 'overrides', optional: true, description: 'Optional overrides applied to the spawned instance.' },
		],
	},
	spawn_world_object: {
		optionalParameters: ['options'],
		description: 'Creates a world object from the given class reference.',
		parameters: [
			{ name: 'classRef', description: 'World object class reference or identifier.' },
			{ name: 'options', optional: true, description: 'Optional spawn options such as position, orientation, or components.' },
		],
	},
	spr: {
		optionalParameters: ['options'],
		description: 'Draws a sprite or sprite instance at the given coordinates.',
		parameters: [
			{ name: 'sprite', description: 'Sprite index or identifier to draw.' },
			{ name: 'x', description: 'Screen X coordinate in pixels.' },
			{ name: 'y', description: 'Screen Y coordinate in pixels.' },
			{ name: 'options', optional: true, description: 'Optional draw options such as ID, scale, layer, or flipping.' },
		],
	},
} as const;
