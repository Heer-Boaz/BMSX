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

export const API_METHOD_METADATA = {
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
		description: 'Broadcasts a runtime event via the global event bus.',
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
} as const satisfies Record<string, ApiMethodMetadata>;
