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
local bolt<const> = {}
local backdrop<const> = {}
local caption<const> = {}
local burst<const> = {}

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
	self.timelines:define('arrival', poses.arrival, { pose = self.spatial })
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
	local spatial3<const> = { family = '3d', authority = 'affine',
		local_transform = { 1,0,0,0,1,0,0,0,1,0,0,512 } }
	local spatial2<const> = { family = '2d', authority = 'affine',
		local_transform = { 1,0,0,1,0,0 } }
	prefab.define({ def_id = 'starcatch.ship', class = ship, spatial = spatial3,
		components = { timeline_component.new,
			actioneffect_component.factory(actions.effect_ids),
			input_component.factory({ program = actions.input }) } })
	prefab.define({ def_id = 'starcatch.preview', class = ship, spatial = spatial3, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.bolt', class = bolt, spatial = spatial2 })
	prefab.define({ def_id = 'starcatch.burst', class = burst, spatial = spatial2, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.backdrop', class = backdrop,
		components = { custom_visual.factory({ draw = renderer.draw, order = -1000 }) } })
	prefab.define({ def_id = 'starcatch.caption', class = caption, spatial = spatial2,
		initial = { text = { text = '', color = 0xffffffff, center_block_width = 320, order = 1000 } },
		components = { text_component.new } })
end

return combat
