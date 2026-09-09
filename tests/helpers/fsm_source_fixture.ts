/** Canonical authored Lua shared by the source projection and real cartlib path-plan oracle. */
export const FSM_SCOPE_SOURCE = String.raw`local machines<const> = require('cartlib/fsm/library')
local shared<const> = { initial = 'idle', states = { idle = {}, active = {} } }
local blueprint<const> = {
	initial = 'room',
	states = {
		room = { initial = 'idle', states = {
			idle = {}, active = {},
			lane = { is_concurrent = true, initial = 'idle', states = { idle = {}, active = {} } },
		} },
		left = shared, right = shared,
		idle = {}, _idle = {}, ['#idle'] = {}, _alias = {}, ['#hash'] = {},
		['a/b'] = { states = { c = {} } }, ["quote'\\"] = {},
		truthy = { is_concurrent = 0 },
	},
}
`;

export type FsmPathCase = {
	readonly origin: readonly string[];
	readonly path: string;
	readonly absolute: boolean;
	readonly up: number;
	readonly steps: readonly (readonly [string, boolean])[];
	readonly target: readonly string[];
};

// Expected plans are explicit; tests do not generate expectations with either implementation.
export const FSM_PATH_CASES: readonly FsmPathCase[] = [
	{ origin: [], path: 'room/idle', absolute: false, up: 0, steps: [['room', false], ['idle', false]], target: ['room', 'idle'] },
	{ origin: ['room'], path: './idle', absolute: false, up: 0, steps: [['idle', false]], target: ['room', 'idle'] },
	{ origin: ['room', 'idle'], path: '../active', absolute: false, up: 1, steps: [['active', false]], target: ['room', 'active'] },
	{ origin: ['room', 'idle'], path: '../../idle', absolute: false, up: 2, steps: [['idle', false]], target: ['idle'] },
	{ origin: ['room'], path: 'idle/../active', absolute: false, up: 0, steps: [['active', false]], target: ['room', 'active'] },
	{ origin: ['room'], path: 'idle/../../left', absolute: false, up: 1, steps: [['left', false]], target: ['left'] },
	{ origin: ['room', 'idle'], path: '/right/active', absolute: true, up: 0, steps: [['right', false], ['active', false]], target: ['right', 'active'] },
	{ origin: ['room'], path: '../', absolute: false, up: 1, steps: [], target: [] },
	{ origin: ['room'], path: '/', absolute: true, up: 0, steps: [], target: [] },
	{ origin: [], path: '/room/..', absolute: true, up: 0, steps: [], target: [] },
	{ origin: [], path: '//./room//lane/active', absolute: true, up: 0, steps: [['room', false], ['lane', true], ['active', false]], target: ['room', 'lane', 'active'] },
	{ origin: ['room', 'lane'], path: '../idle', absolute: false, up: 1, steps: [['idle', false]], target: ['room', 'idle'] },
	{ origin: [], path: 'idle', absolute: false, up: 0, steps: [['idle', false]], target: ['idle'] },
	{ origin: [], path: 'alias', absolute: false, up: 0, steps: [['_alias', false]], target: ['_alias'] },
	{ origin: [], path: 'hash', absolute: false, up: 0, steps: [['#hash', false]], target: ['#hash'] },
	{ origin: [], path: "['a/b']/c", absolute: false, up: 0, steps: [['a/b', false], ['c', false]], target: ['a/b', 'c'] },
	{ origin: [], path: "['a/b']c", absolute: false, up: 0, steps: [['a/b', false], ['c', false]], target: ['a/b', 'c'] },
	{ origin: [], path: String.raw`['quote\'\\']`, absolute: false, up: 0, steps: [["quote'\\", false]], target: ["quote'\\"] },
	{ origin: [], path: "['']/['.']/room", absolute: false, up: 0, steps: [['room', false]], target: ['room'] },
	{ origin: ['room'], path: "['..']/truthy", absolute: false, up: 1, steps: [['truthy', true]], target: ['truthy'] },
];

/** Source-only callbacks need not be executed to identify their proven consumers. */
export const FSM_BEHAVIOR_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local next_path<const> = '../active'
local step<const> = function(owner)
	local nested<const> = function() return '/not-a-transition' end
	if owner.finished then return next_path, '/ignored-second-result' end
	return nil
end
local shared<const> = {
	initial = 'idle',
	on = { reset = 'idle' },
	states = {
		idle = {
			update = step,
			entering_state = function(owner) if owner.skip then return '../active' end end,
			exiting_state = function() return '/ignored-exit' end,
			transition_guards = { can_enter = checks.enter, can_exit = checks.exit },
			on = { start = { emitter = false, go = next_path }, [events.timeout] = '../active' },
			input_event_handlers = { { pattern = 'a[jp]', go = next_path } },
			timelines = { [clips.intro] = { on_finished = { go = step } } },
		},
		active = {},
	},
}
machines.register('fixture.first', {
	initial = 'left',
	entering_state = function() return '/ignored-root' end,
	states = { left = shared, right = shared },
})
machines.register('fixture.second', { states = { idle = {}, active = {} } })
`;

/** Identical returns and reused callbacks deliberately have different source-use owners. */
export const FSM_PROOF_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local next_path<const> = '../active'
local step<const> = function(owner)
	if owner.first then return next_path end
	if owner.again then return next_path end
	return nil
end
local shared<const> = {
	initial = 'idle',
	states = {
		idle = {
			update = step,
			on = { direct = next_path, wrapped = { go = step } },
		},
		active = {},
		lane = { is_concurrent = true, initial = 'idle', states = { idle = {} } },
	},
}
machines.register('fixture.proofs', { initial = 'left', states = { left = shared, right = shared } })
machines.register('fixture.proofs', shared)
`;
