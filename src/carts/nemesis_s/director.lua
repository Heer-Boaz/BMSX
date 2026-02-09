local constants = require('constants.lua')
local stage = require('stage.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm

function director:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	local stage_state = stage.get_state()
	local width = constants.machine.game_width
	local scroll_x = stage_state.total_smooth_scroll_px % width
	print(string.format(
		'%s|kind=director|f=%d|scroll=%.3f|yellow_blink=%d|blue_blink=%d|yellow_count=%d|blue_count=%d|stage_left=%d|stage_head=%d|stage_px=%.3f|stage_scrolling=%d|stage_mode=%d|stage_rot=%d|stage_gate=%d|stage_adv=%d',
		telemetry.metric_prefix,
		self.frame,
		scroll_x,
		bool01(stage_state.yellow_blink),
		bool01(stage_state.blue_blink),
		#stage_state.yellow_stars,
		#stage_state.blue_stars,
		stage_state.left_tile,
		stage_state.tape_head,
		stage_state.total_scroll_px,
		bool01(stage_state.scrolling),
		stage_state.scroll_mode,
		stage_state.scroll_rotator,
		stage_state.scroll_gate_bit,
		bool01(stage_state.scroll_advanced)
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

function director:reset_runtime()
	self.frame = 0
	stage.set_event_sink(function(name, extra)
		self:emit_event(name, extra)
	end)
end

function director:tick()
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
		components = {},
		defaults = {
			frame = 0,
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
