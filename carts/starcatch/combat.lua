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
	self.width = 28
	self.height = 30
	self.timelines:define('idle', poses.ship_idle)
	self.timelines:define('arrival', poses.arrival)
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

function caption:ctor()
	local text<const> = self:get_component(text_component)
	text.color = self.color
	text.center_block_width = 320
	text:set_text(self.text)
end

function combat.install()
	actions.register()
	prefab.define({ def_id = 'starcatch.ship', class = ship,
		components = { timeline_component.new,
			actioneffect_component.factory(actions.effect_ids),
			input_component.factory({ program = actions.input }) } })
	prefab.define({ def_id = 'starcatch.preview', class = ship, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.bolt', class = bolt })
	prefab.define({ def_id = 'starcatch.burst', class = burst, components = { timeline_component.new } })
	prefab.define({ def_id = 'starcatch.backdrop', class = backdrop,
		components = { custom_visual.factory({ draw = renderer.draw }) } })
	prefab.define({ def_id = 'starcatch.caption', class = caption, defaults = { text = '', color = 0xffffffff }, components = { text_component.new } })
end

return combat
