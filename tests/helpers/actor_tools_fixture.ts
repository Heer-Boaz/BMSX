/** Runs through the product compiler/BIOS and real World/prefab/component owners. No host-authored instance tables. */
export const ACTOR_TOOLS_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local prefab<const> = require('cartlib/world/prefab')
local fsm<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local effects<const> = require('cartlib/actioneffects')
local effect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local trees<const> = require('cartlib/behaviour_tree/library')
local tree_component<const> = require('cartlib/behaviour_tree/bt_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
display.reset_256x192()
world:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
	spaces = { 'main' }, systems = {} })
actor_tool_callbacks = 0
local function callback() actor_tool_callbacks = actor_tool_callbacks + 1 end
effects.register_effect('pulse', { period_ms = 20, initial_cooldown_ms = 7, handler = callback })
fsm.register('walker', { initial = 'nest', states = {
	nest = { initial = 'wait', data = { revision = 10 }, update = callback, states = {
		wait = {}, listener = { is_concurrent = true },
	} }, parked = {},
} })
local count<const> = blackboard.key('count', 10)
trees.register('rover', { blackboard = { count, blackboard.key('vacant'), blackboard.key('ready', false) },
	root = { type = 'sequence', children = {} } })
prefab.define({ def_id = 'tool_actor', class = {}, components = {
	timelines.new, effect_component.factory({ 'pulse' }), fsm_component.factory({ 'walker' }), tree_component.factory('rover'),
} })
actor_tool_first = world:spawn('tool_actor', { id = 'first', pos = { x = 4, y = 8 } })
actor_tool_second = world:spawn('tool_actor', { id = 'second', pos = { x = 40, y = 80 } })
actor_tool_first.state_machines:get_machine('walker'):transition_to('/parked')
actor_tool_first.state_machines:get_machine('walker').states.nest.data.revision = 111
actor_tool_second.state_machines:get_machine('walker').states.nest.data.revision = 222
actor_tool_first.actioneffects:activate('pulse')
actor_tool_first:get_component(tree_component).blackboard:set(count, 111)
actor_tool_second:get_component(tree_component).blackboard:set(count, 222)
actor_tool_first.timelines:define('motion', { frames = { 0, 1, 2 }, frame_duration = 1,
	apply = function(target, value) target.timeline_value = value end })
actor_tool_first.timelines:play('motion')
actor_tool_first.timelines:scrub_time('motion', 1)
actor_tool_ready = true
while true do
	world:update()
	vblank.wait()
	world:render()
end
`;
