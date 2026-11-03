local scenes<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local rectangle<const> = require('cartlib/component/rectangle_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local fsm<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local trees<const> = require('cartlib/behaviour_tree/library')
local tree_component<const> = require('cartlib/behaviour_tree/bt_component')
local result<const> = require('cartlib/behaviour_tree/result')

local live<const> = { id = 'studio_test.live' }
local actor<const> = {}
setmetatable(actor, { __index = object_2d })

function actor.initialize(owner)
	owner.updates = 0
	owner.entries = 0
	owner.visual = rectangle.new(owner, { width = 12, height = 12, color = owner.color })
	owner:add_component(owner.visual)
	local transport<const> = timelines.new(owner)
	owner:add_component(transport)
	transport:define('pulse', {
		phase = 'presentation', duration_ms = 1000, loop = true, bindings = { 'visual' },
		tracks = { { kind = 'spatial', binding = 'visual', operation = 'presentation_origin2',
			channels = { ox = 0, oy = { interpolation = 'linear', keys = {
				{ time_ms = 0, value = 0 }, { time_ms = 500, value = 12 }, { time_ms = 1000, value = 0 },
			} } } } },
	}, { visual = owner.visual })
end

local move<const> = function(owner)
	owner.updates = owner.updates + 1
	owner:set_position((owner.ox + 1) % 240, owner.oy)
end

function live.register()
	fsm.register('studio_test.motion', { initial = 'idle', states = {
		idle = {},
		moving = {
			entering_state = function(owner)
				owner.entries = owner.entries + 1
				owner.timelines:play('pulse')
			end,
			update = move,
			exiting_state = function(owner) owner.timelines:stop('pulse') end,
		},
		blocked = { transition_guards = { can_enter = function() return false end } },
	} })
	trees.register('studio_test.roam', { root = { type = 'task', task = {
		tick = function(owner) move(owner); return result.running end,
	} } })
	prefab.define({ def_id = 'studio_test.runner', class = actor,
		defaults = { color = 0xffe0c04b }, components = { fsm_component.factory({ 'studio_test.motion' }) } })
	prefab.define({ def_id = 'studio_test.bystander', class = actor,
		defaults = { color = 0xffa66dcf }, components = { tree_component.factory('studio_test.roam') } })
	scenes.register(live.id, { objects = {
		{ member_id = 'runner', definition_id = 'studio_test.runner', options = { id = 'runner' }, position = { x = 200, y = 24 } },
		{ member_id = 'bystander', definition_id = 'studio_test.bystander', options = { id = 'bystander' }, position = { x = 200, y = 168 } },
	} })
end

return live
