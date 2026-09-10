/** Independent authoring document; no shipped game definition or source-line oracle. */
export const NAVIGATION_SOURCE = `local machines<const> = require('cartlib/fsm/library')
local trees<const> = require('cartlib/behaviour_tree/library')
local effects<const> = require('cartlib/actioneffects')
local scenes<const> = require('cartlib/world/scene_library')
local next_path<const> = '../active'
local step<const> = function(actor)
	if actor.first then return next_path end
	return next_path
end
local states<const> = { initial = 'idle', states = { idle = { update = step }, active = {} } }
machines.register('navigation.fsm.one', states)
machines.register('navigation.fsm.two', states)
local leaf<const> = { type = 'wait', duration_ticks = 2 }
trees.register('navigation.tree.one', { root = { type = 'sequence', children = { leaf, leaf } } })
trees.register('navigation.tree.two', { root = { type = 'sequence', children = { leaf } } })
effects.register_effect('navigation.effect', { cooldown_ms = 10, period_ms = 40, handler = step })
scenes.register('navigation.scene', { objects = {
	{ member_id = 'one', definition_id = 'navigation.actor', options = { pos = { x = 11, y = 22, z = 33 } } },
	{ member_id = 'two', definition_id = 'navigation.actor', options = { pos = { x = 44, y = 55, z = 66 } } },
} })
`;
