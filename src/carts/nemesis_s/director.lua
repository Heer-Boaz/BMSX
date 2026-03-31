local constants<const> = require('constants')

local director<const> = {}
director.__index = director

function director:emit_metric()
	if not constants.telemetry.enabled then
		return
	end
	print(string.format(
		'%s|kind=director|f=%d|scroll=%.3f|yellow_blink=%d|blue_blink=%d|yellow_count=%d|blue_count=%d|stage_left=%d|stage_head=%d|stage_px=%.3f|stage_scrolling=%d|stage_mode=%d|stage_rot=%d|stage_gate=%d|stage_adv=%d',
		constants.telemetry.metric_prefix,
		self.frame,
		self.stage.total_smooth_scroll_px % constants.machine.game_width,
		bool01(self.stage.yellow_blink),
		bool01(self.stage.blue_blink),
		#self.stage.yellow_stars,
		#self.stage.blue_stars,
		self.stage.left_tile,
		self.stage.tape_head,
		self.stage.total_scroll_px,
		bool01(self.stage.scrolling),
		self.stage.scroll_mode,
		self.stage.scroll_rotator,
		self.stage.scroll_gate_bit,
		bool01(self.stage.scroll_advanced)
	))
end

function director:emit_event(name, extra)
	if not constants.telemetry.enabled then
		return
	end
	if extra ~= nil then
		print(string.format('%s|kind=director|f=%d|name=%s|%s', constants.telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=director|f=%d|name=%s', constants.telemetry.event_prefix, self.frame, name))
end

function director:reset_runtime()
	self.frame = 0
	self.stage = subsystem(constants.ids.stage_instance)
end

function director:update_runtime()
	self:emit_metric()
	self.frame = self.frame + 1
end

local define_director_fsm<const> = function()
	define_fsm(constants.ids.director_fsm, {
		initial = 'boot',
		on = {
			['star_blink_toggle'] = {
				emitter = constants.ids.stage_instance,
				go = function(self, _state, event)
					self:emit_event(
						'star_blink_toggle',
						string.format(
							'turn=%s|yellow_blink=%d|blue_blink=%d',
							event.turn,
							bool01(event.yellow_blink),
							bool01(event.blue_blink)
						)
					)
				end,
			},
			['stage_scroll_stop'] = {
				emitter = constants.ids.stage_instance,
				go = function(self, _state, event)
					self:emit_event('stage_scroll_stop', string.format('left=%d|head=%d', event.left, event.head))
				end,
			},
			['stage_scroll_tile'] = {
				emitter = constants.ids.stage_instance,
				go = function(self, _state, event)
					self:emit_event('stage_scroll_tile', string.format('left=%d|head=%d', event.left, event.head))
				end,
			},
			['stage_scroll_gate'] = {
				emitter = constants.ids.stage_instance,
				go = function(self, _state, event)
					self:emit_event(
						'stage_scroll_gate',
						string.format(
							'mode=%d|rot=%d|bit=%d|adv=%d|left=%d|head=%d',
							event.mode,
							event.rot,
							event.bit,
							bool01(event.adv),
							event.left,
							event.head
						)
					)
				end,
			},
		},
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:emit_event('director_boot')
					return '/running'
				end,
				},
				running = {
					update = function(self)
						self:update_runtime()
					end,
				},
			},
		})
end

local register_director_definition<const> = function()
	define_prefab({
		def_id = constants.ids.director_def,
		class = director,
		fsms = { constants.ids.director_fsm },
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
	director_fsm_id = constants.ids.director_fsm,
}
