local object_3d<const> = require('cartlib/world/object_3d')
local object_2d<const> = require('cartlib/world/object_2d')
local world_object<const> = require('cartlib/world/world_object')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local input_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local custom_visual<const> = require('cartlib/component/custom_visual_component')
local text_component<const> = require('cartlib/text/text_component')
local renderer<const> = require('scene_renderer')
local actions<const> = require('actions')
local poses<const> = require('poses')

local combat<const> = {}
local ship<const> = {}
setmetatable(ship, { __index = object_3d })
local bolt<const> = {}
setmetatable(bolt, { __index = object_2d })
local backdrop<const> = {}
setmetatable(backdrop, { __index = world_object })
local caption<const> = {}
setmetatable(caption, { __index = object_2d })
local burst<const> = {}
setmetatable(burst, { __index = object_2d })

function ship:ctor(options)
	self.game = options.game
	self.bank = 0
	self.spin = 0
	self.recoil = 0
	self.bob = 0
	self.dash_speed = 1
	self.dash_shield = 0
	self.hit_flash = 0
	self.timelines:define('idle', poses.ship_idle)
	self.timelines:define('arrival', poses.arrival, { pose = self })
	self.timelines:define('fire', poses.fire)
	self.timelines:define('hurt', poses.hurt)
	self.timelines:define('dash', poses.dash)
	self.timelines:play('idle')
end

function bolt:ctor()
	self.visible = false
	self.vx = 0
	self.vy = 0
end

function backdrop:ctor(options)
	self.game = options.game
end

function burst:ctor()
	self.pulse = 0
	self.timelines:define('burst', poses.burst)
end

function combat.install()
	actions.register()
	prefab.define({ def_id = 'starcatch.ship', class = ship, position = { x = 0, y = 0, z = 512 },
		components = { timeline_component.new,
			actioneffect_component.factory(actions.effect_ids),
			input_component.factory({ program = actions.input }) } })
	prefab.define({ def_id = 'starcatch.preview', class = ship, position = { x = 0, y = 0, z = 512 }, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.bolt', class = bolt })
	prefab.define({ def_id = 'starcatch.burst', class = burst, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.backdrop', class = backdrop,
		components = { custom_visual.factory({ draw = renderer.draw, order = -1000 }) } })
	prefab.define({ def_id = 'starcatch.caption', class = caption,
		defaults = {
			text = '',
			color = 0xffffffff,
			center_block_width = 320,
			order = 1000,
		},
		components = { function(owner) return text_component.new(owner, owner) end } })
end

return combat
