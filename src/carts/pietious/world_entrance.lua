local constants<const> = require('constants')

local world_entrance_sprite_ids<const> = {
	closed = 'world_entrance',
	opening_1 = 'world_entrance',
	opening_2 = 'world_entrance_half_open',
	open = 'world_entrance_open',
}

local opening_timeline_id<const> = 'world_entrance.opening'
local opening_half_event<const> = 'world_entrance.opening.half'

local world_entrance<const> = {}
world_entrance.__index = world_entrance

function world_entrance:set_entrance_state(entrance_state)
	self.entrance_state = entrance_state
	self:gfx(world_entrance_sprite_ids[entrance_state])
end

function world_entrance:mark_half_open()
	self:set_entrance_state('opening_2')
	oget('c').events:emit('world_entrance.opening_2', {
		target = self.target,
	})
end

function world_entrance:finish_opening()
	self:set_entrance_state('open')
	oget('c').events:emit('world_entrance.opened', {
		target = self.target,
	})
end

function world_entrance:ctor()
	self.collider:set_enabled(false)
	self:set_entrance_state('closed')
end

local define_world_entrance_fsm<const> = function()
	define_fsm('world_entrance', {
		initial = 'closed',
		states = {
			closed = {
				on = {
					['world_entrance.open.request'] = {
						emitter = 'c',
						go = function(self, _state, event)
							if event.target == self.target then
								return '/opening'
							end
						end,
					},
				},
			},
			opening = {
				entering_state = function(self)
					self:set_entrance_state('opening_1')
				end,
				timelines = {
					[opening_timeline_id] = {
						def = {
							frames = timeline.range(constants.world_entrance.open_step_frames * 2),
							playback_mode = 'once',
							markers = {
								{ frame = constants.world_entrance.open_step_frames, event = opening_half_event },
							},
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = function(self)
							self:finish_opening()
							return '/open'
						end,
					},
				},
				on = {
					[opening_half_event] = function(self)
						self:mark_half_open()
					end,
				},
			},
			open = {},
		},
	})
end

local register_world_entrance_definition<const> = function()
	define_prefab({
		def_id = 'world_entrance',
		class = world_entrance,
		type = 'sprite',
		fsms = { 'world_entrance' },
		defaults = {
			target = nil,
			entrance_state = 'closed',
		},
	})
end

return {
	define_world_entrance_fsm = define_world_entrance_fsm,
	register_world_entrance_definition = register_world_entrance_definition,
}
