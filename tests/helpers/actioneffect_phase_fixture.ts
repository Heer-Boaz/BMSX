/** Executed against the real registry and ActionEffect component; no editor-owned phase emulator. */
export const ACTIONEFFECT_PHASE_ENTRY = `
local effects<const> = require('cartlib/actioneffects')
local component_type<const> = require('cartlib/actioneffects/actioneffect_component')
local registry<const> = require('cartlib/registry')
local blueprint<const> = require('fixture/effects')
local owner<const> = {
	world = { gameplay_time_ms = 100 },
	tags = { ready = true }, states = { ['/ready'] = true },
	tag_checks = 0, state_checks = 0, bindings = 0,
	calculations = 0, gate_calls = 0, runs = 0,
	calculated_cooldown = 7, accept = false, result_event = false,
	events = { count = 0 }, state_machines = {},
}
function owner:has_tag(tag)
	self.tag_checks = self.tag_checks + 1
	return self.tags[tag] == true
end
function owner.state_machines:bind_state_path(path)
	owner.bindings = owner.bindings + 1
	return path
end
function owner.state_machines:matches_state(path)
	owner.state_checks = owner.state_checks + 1
	return owner.states[path] == true
end
function owner.events:emit(event, payload)
	self.count = self.count + 1
	self.last_event = event
	self.last_payload = payload
end
local component<const> = component_type.new({ parent = owner })
component.id = registry:next_id()
registry:register(component)
registry:index(component, component_type)
owner.actioneffects = component
component:grant_effect('fixture.first')
component:on_activate()
local effect<const> = component.effects['fixture.first']
assert(effect.definition == blueprint and owner.bindings == 2, 'grant binds the authored state paths')
assert(component:cooldown_remaining('fixture.first') == 10, 'initial cooldown starts at grant time')
component:activate('fixture.first')
component:activate('fixture.first')
assert(effect.active_count == 2 and component.periodic_effect_count == 1 and effect.next_execution_ms == 120, 'activation is refcounted')
assert(not component:trigger('fixture.first'), 'initial cooldown rejects a trigger')
assert(owner.tag_checks == 0 and owner.state_checks == 0 and owner.gate_calls == 0 and owner.calculations == 0, 'cooldown precedes all gates')

owner.world.gameplay_time_ms = 110
assert(not component:trigger('fixture.first'), 'custom gate rejects after tag and state requirements')
assert(owner.tag_checks == 2 and owner.state_checks == 2 and owner.gate_calls == 1 and owner.calculations == 0, 'rejection does not calculate a cooldown')
owner.accept = true
assert(component:trigger('fixture.first', 'first'), 'trigger accepted')
assert(owner.runs == 1 and owner.last_payload == 'first' and owner.events.count == 0, 'false handler event suppresses configured emit')
assert(owner.calculations == 1 and effect.cooldown_pending and effect.pending_cooldown_ms == 7 and effect.cooldown_until_ms == 110, 'deferred duration overrides static cooldown without committing')
owner.calculated_cooldown = 19
owner.world.gameplay_time_ms = 113
component:commit_cooldown('fixture.first')
assert(effect.cooldown_until_ms == 120 and owner.calculations == 1 and effect.cooldown_pending == nil, 'deferred duration is consumed at commit time')
owner.world.gameplay_time_ms = 114
component:commit_cooldown('fixture.first')
assert(effect.cooldown_until_ms == 133 and owner.calculations == 2, 'explicit commit without pending duration calculates again')

owner.accept = false
owner.tags.ready = false
owner.tags.blocked = true
owner.states['/ready'] = false
owner.states['/blocked'] = true
owner.world.gameplay_time_ms = 120
component:tick_periodic()
assert(owner.runs == 2 and owner.last_payload == nil and effect.next_execution_ms == 140, 'periodic execution calls the handler directly')
assert(owner.tag_checks == 4 and owner.state_checks == 4 and owner.gate_calls == 2 and owner.calculations == 2, 'periodic execution bypasses gates and cooldown calculation')
assert(effect.cooldown_until_ms == 133 and effect.cooldown_pending == nil, 'periodic execution does not commit cooldown')
component:deactivate('fixture.first')
component:tick_periodic()
assert(component.periodic_effect_count == 1, 'one remaining activation retains periodic presence')
component:deactivate('fixture.first')
component:tick_periodic()
assert(component.periodic_effect_count == 0 and effect.periodic_index == nil, 'last release removes periodic presence at its tick')

owner.world.gameplay_time_ms = 200
owner.accept = true
owner.tags.ready = true
owner.tags.blocked = false
owner.states['/ready'] = true
owner.states['/blocked'] = false
owner.result_event = nil
owner.result_payload = nil
owner.calculated_cooldown = nil
assert(component:trigger('fixture.first', 'input'), 'nil calculated duration does not fall back to the static cooldown')
assert(owner.events.last_event == 'default.event' and owner.events.last_payload == 'input', 'nil handler results retain configured event and input payload')
component:commit_cooldown('fixture.first')
assert(effect.cooldown_until_ms == nil, 'nil pending duration clears cooldown instead of using static 50')
owner.result_event = 'changed.event'
owner.result_payload = false
assert(component:trigger('fixture.first', 'discarded'), 'custom handler result accepted')
assert(owner.events.count == 2 and owner.events.last_event == 'changed.event' and owner.events.last_payload == false, 'non-nil results replace event and payload independently')
component:commit_cooldown('fixture.first')

owner.calculated_cooldown = 11
component:commit_cooldown('fixture.first')
owner.world.gameplay_time_ms = 212
component:trigger('fixture.first')
component:activate('fixture.first')
local rebound<const> = {
	period_ms = 9, initial_cooldown_ms = 999, cooldown_ms = 99,
	required_state_paths = { '/new' }, event = 'rebound.event',
}
effects.register_effect('fixture.first', rebound)
assert(component.effects['fixture.first'] == effect and effect.definition == rebound, 'public registration rebinds the existing indexed component record')
assert(effect.active_count == 1 and component.periodic_effect_count == 1 and effect.next_execution_ms == 221, 'rebind replans an active period from current gameplay time')
assert(effect.cooldown_until_ms == 211 and effect.cooldown_pending and effect.pending_cooldown_ms == 11, 'rebind retains cooldown and pending duration and does not reapply initial cooldown')
assert(owner.bindings == 3 and effect.required_states[1] == '/new' and effect.blocked_states == nil, 'rebind replaces bound requirements')
owner.world.gameplay_time_ms = 215
component:commit_cooldown('fixture.first')
assert(effect.cooldown_until_ms == 226, 'old pending duration survives rebind and commits from the new time')
owner.world.gameplay_time_ms = 221
component:tick_periodic()
assert(owner.events.last_event == 'rebound.event' and effect.next_execution_ms == 230, 'rebound periodic definition executes without its unmet state requirement')
owner.world.gameplay_time_ms = 226
owner.states['/new'] = true
assert(component:trigger('fixture.first'), 'rebound trigger passes its new requirements at the cooldown deadline')
assert(effect.cooldown_until_ms == 325 and effect.cooldown_pending == nil, 'non-deferred trigger commits its authored static cooldown immediately')
registry:deregister(component)
return true
`;
