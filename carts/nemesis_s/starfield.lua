local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local velocity<const> = require('cartlib/velocity')
require('constants')

local starfield<const> = {
	definition_id = 'nemesis_s.starfield',
	instance_id = 'nemesis_s.starfield',
}
local blink_timeline_id<const> = 'nemesis_s.starfield.blink'
local yellow_source<const> = image.resolve(assets_star_yellow)
local blue_source<const> = image.resolve(assets_star_blue)
local yellow_points<const> = {
	{ x = 4, y = 10 },
	{ x = 92, y = 10 },
	{ x = 184, y = 10 },
	{ x = 196, y = 10 },
	{ x = 60, y = 43 },
	{ x = 236, y = 43 },
	{ x = 76, y = 58 },
	{ x = 220, y = 74 },
	{ x = 36, y = 75 },
	{ x = 140, y = 91 },
	{ x = 4, y = 10 },
	{ x = 172, y = 107 },
	{ x = 4, y = 10 },
	{ x = 99, y = 122 },
	{ x = 131, y = 138 },
	{ x = 155, y = 138 },
	{ x = 179, y = 154 },
}

local blue_points<const> = {
	{ x = 44, y = 3 },
	{ x = 20, y = 35 },
	{ x = 124, y = 35 },
	{ x = 204, y = 35 },
	{ x = 108, y = 51 },
	{ x = 134, y = 67 },
	{ x = 252, y = 67 },
	{ x = 52, y = 99 },
	{ x = 116, y = 99 },
	{ x = 212, y = 99 },
	{ x = 243, y = 115 },
	{ x = 67, y = 132 },
	{ x = 187, y = 132 },
	{ x = 99, y = 122 },
	{ x = 27, y = 127 },
	{ x = 227, y = 127 },
}

local blink_sequence<const> = {
	frames = {
		{ blink_turn = 'yellow', yellow_blink = false, blue_blink = false },
		{ blink_turn = 'yellow', yellow_blink = true, blue_blink = false },
		{ blink_turn = 'blue', yellow_blink = false, blue_blink = false },
		{ blink_turn = 'blue', yellow_blink = false, blue_blink = true },
	},
	frame_duration = stage_star_blink_frame_ms,
	playback_mode = 'loop',
	apply = true,
	tracks = telemetry_enabled and {
		{
			kind = 'event',
			keys = {
				{ frame = 0, event = 'star_blink_toggle', direction = 'forward' },
				{ frame = 1, event = 'star_blink_toggle', direction = 'forward' },
				{ frame = 2, event = 'star_blink_toggle', direction = 'forward' },
				{ frame = 3, event = 'star_blink_toggle', direction = 'forward' },
			},
		},
	},
}

local create_particles<const> = function(points)
	local particles<const> = {}
	for i = 1, #points do
		local point<const> = points[i]
		particles[i] = { x = point.x, y = point.y }
	end
	return particles
end

function starfield:ctor()
	self.yellow_stars = create_particles(self.yellow_points)
	self.blue_stars = create_particles(self.blue_points)
	self.scroll_step = velocity.pixels_per_second_to_pixels_per_tick(stage_star_scroll_speed_px_per_second)
end

function starfield:onspawn()
	self.timelines:define(blink_timeline_id, blink_sequence)
	self.timelines:play(blink_timeline_id)
end

local scroll_particles<const> = function(particles, step, width)
	for i = 1, #particles do
		local particle<const> = particles[i]
		particle.x = particle.x - step
		if particle.x < 0 then
			particle.x = width
		end
	end
end

function starfield:scroll()
	scroll_particles(self.yellow_stars, self.scroll_step, self.sx)
	scroll_particles(self.blue_stars, self.scroll_step, self.sx)
end

local draw_particles<const> = function(owner, draw, stars, source, hidden)
	if hidden then return end
	for i = 1, #stars do
		local star<const> = stars[i]
		source:blit(draw, owner.x + star.x, owner.y + star.y)
	end
end

local draw_stars<const> = function(component, draw)
	local owner<const> = component.parent
	draw_particles(owner, draw, owner.yellow_stars, yellow_source, owner.yellow_blink)
	draw_particles(owner, draw, owner.blue_stars, blue_source, owner.blue_blink)
end

function starfield.register()
	prefab.define({
		def_id = starfield.definition_id,
		class = starfield,
		components = {
			custom_visual_component.factory({ draw = draw_stars }),
			timeline_component.new,
		},
		defaults = { sx = 256, yellow_points = yellow_points, blue_points = blue_points },
	})
end

return starfield
