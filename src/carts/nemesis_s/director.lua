local constants = require('constants.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm

local function bool01(value)
	if value then
		return 1
	end
	return 0
end

function director:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|kind=director|f=%d|scroll=%.3f|yellow_blink=%d|blue_blink=%d|yellow_count=%d|blue_count=%d',
		telemetry.metric_prefix,
		self.frame,
		self.scroll_x,
		bool01(self.yellow_blink),
		bool01(self.blue_blink),
		#self.yellow_stars,
		#self.blue_stars
	))
end

function director:emit_event(name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|kind=director|f=%d|name=%s|%s', telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=director|f=%d|name=%s', telemetry.event_prefix, self.frame, name))
end

function director:copy_star_positions(source)
	local out = {}
	for i = 1, #source do
		local src = source[i]
		out[i] = { x = src.x, y = src.y }
	end
	return out
end

function director:reset_runtime()
	self.frame = 0
	self.scroll_x = 0
	self.blink_elapsed_ms = 0
	self.blink_turn = 'yellow'
	self.yellow_blink = false
	self.blue_blink = false
	self.yellow_stars = self:copy_star_positions(constants.stars.yellow)
	self.blue_stars = self:copy_star_positions(constants.stars.blue)
end

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_frame()
	end
end

function director:draw_background()
	local width = constants.machine.game_width
	local scroll = self.scroll_x
	put_sprite(constants.assets.background, -scroll, 0, 5)
	put_sprite(constants.assets.background, width - scroll, 0, 5)
end

function director:draw_star_set(stars, imgid, hidden)
	if hidden then
		return
	end
	for i = 1, #stars do
		local star = stars[i]
		put_sprite(imgid, star.x, star.y, 8)
	end
end

function director:render_frame()
	self:draw_background()
	self:draw_star_set(self.yellow_stars, constants.assets.star_yellow, self.yellow_blink)
	self:draw_star_set(self.blue_stars, constants.assets.star_blue, self.blue_blink)
end

function director:apply_star_scroll(stars, step)
	local width = constants.machine.game_width
	for i = 1, #stars do
		local star = stars[i]
		star.x = star.x - step
		if star.x < 0 then
			star.x = width
		end
	end
end

function director:tick_blink(dt_ms)
	local duration = constants.stage.star_blink_interval_ms
	if self.blink_elapsed_ms < duration then
		self.blink_elapsed_ms = self.blink_elapsed_ms + dt_ms
		return
	end

	self.blink_elapsed_ms = duration - self.blink_elapsed_ms
	if self.blink_turn == 'blue' then
		self.blue_blink = not self.blue_blink
		if not self.blue_blink then
			self.blink_turn = 'yellow'
		end
	else
		self.yellow_blink = not self.yellow_blink
		if not self.yellow_blink then
			self.blink_turn = 'blue'
		end
	end

	self:emit_event(
		'star_blink_toggle',
		string.format(
			'turn=%s|yellow_blink=%d|blue_blink=%d',
			self.blink_turn,
			bool01(self.yellow_blink),
			bool01(self.blue_blink)
		)
	)
end

function director:tick(dt_ms)
	local factor = dt_ms / constants.machine.frame_interval_ms
	local scroll_step = constants.stage.scroll_step_px * factor
	local width = constants.machine.game_width

	self.scroll_x = self.scroll_x + scroll_step
	while self.scroll_x >= width do
		self.scroll_x = self.scroll_x - width
	end

	self:apply_star_scroll(self.yellow_stars, scroll_step)
	self:apply_star_scroll(self.blue_stars, scroll_step)
	self:tick_blink(dt_ms)
	self:emit_metric()
	self.frame = self.frame + 1
end

local function define_director_fsm()
	define_fsm(director_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:bind_visual()
					self:emit_event('director_boot')
					return '/running'
				end,
			},
			running = {},
		},
	})
end

local function register_director_definition()
	define_world_object({
		def_id = constants.ids.director_def,
		class = director,
		fsms = { director_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			frame = 0,
			scroll_x = 0,
			blink_elapsed_ms = 0,
			blink_turn = 'yellow',
			yellow_blink = false,
			blue_blink = false,
			yellow_stars = {},
			blue_stars = {},
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
	director_def_id = constants.ids.director_def,
	director_instance_id = constants.ids.director_instance,
	director_fsm_id = director_fsm_id,
}
