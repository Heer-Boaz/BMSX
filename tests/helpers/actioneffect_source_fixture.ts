/** Canonical Lua consumed by the source recognizer and the real compiled cartlib phase oracle. */
export const ACTIONEFFECT_SOURCE = `local effects<const> = require('cartlib/actioneffects')
local required<const> = { 'ready' }
local blueprint<const> = {
	required_tags = required,
	blocked_tags = { 'blocked' },
	required_state_paths = { '/ready' },
	blocked_state_paths = { '/blocked' },
	initial_cooldown_ms = 10,
	cooldown_ms = 50,
	calculate_cooldown_ms = function(owner)
		owner.calculations = owner.calculations + 1
		return owner.calculated_cooldown
	end,
	defer_cooldown_commit = true,
	period_ms = 20,
	can_trigger = function(owner)
		owner.gate_calls = owner.gate_calls + 1
		return owner.accept
	end,
	handler = function(owner, payload)
		owner.runs = owner.runs + 1
		owner.last_payload = payload
		return owner.result_event, owner.result_payload
	end,
	event = 'default.event',
}
effects.register_effect('fixture.first', blueprint)
effects.register_effect('fixture.second', blueprint)
return blueprint
`;

/** This table is deliberately not a statically known complete effect definition. */
export const ACTIONEFFECT_PARTIAL_SOURCE = `local effects<const> = require('cartlib/actioneffects')
local requirements<const> = { 'first', [4] = 'fourth', [keys.tag] = 'computed' }
local blueprint<const> = {
	period_ms = 20,
	[fields.override] = 40,
	required_tags = requirements,
	blocked_tags = builders.tags(),
}
effects.register_effect('fixture.partial', blueprint)
`;
