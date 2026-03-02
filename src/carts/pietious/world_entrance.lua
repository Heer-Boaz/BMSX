local constants = require('constants')

local world_entrance_sprite_ids = {
	closed = 'world_entrance',
	opening_1 = 'world_entrance',
	opening_2 = 'world_entrance_half_open',
	open = 'world_entrance_open',
}

local opening_timeline_id = 'world_entrance.opening'

local world_entrance = {}
world_entrance.__index = world_entrance

function world_entrance:set_entrance_state(entrance_state)
	self.entrance_state = entrance_state
	self:gfx(world_entrance_sprite_ids[entrance_state])
end

function world_entrance:begin_opening()
	if self.entrance_state ~= 'closed' then
		return
	end
	self:set_entrance_state('opening_1')
	self:play_timeline(opening_timeline_id, { rewind = true, snap_to_start = true })
end

function world_entrance:sync_opening_frame(frame_value)
	if frame_value ~= constants.world_entrance.open_step_frames then
		return
	end
	self:set_entrance_state('opening_2')
	self.events:emit('world_entrance.opening_2', {
		target = self.target,
	})
end

function world_entrance:bind()
	self.events:on({
		event = 'world_entrance.open.request',
		emitter = 'c',
		subscriber = self,
		handler = function(event)
			if event.target == self.target then
				self:begin_opening()
			end
		end,
	})
	self.events:on({
		event = 'timeline.frame.' .. opening_timeline_id,
		subscriber = self,
		handler = function(event)
			self:sync_opening_frame(event.frame_value)
		end,
	})
	self.events:on({
		event = 'timeline.end.' .. opening_timeline_id,
		subscriber = self,
		handler = function()
			self:set_entrance_state('open')
			self.events:emit('world_entrance.opened', {
				target = self.target,
			})
		end,
	})
end

function world_entrance:ctor()
	self.collider.enabled = false
	self:set_entrance_state('closed')
	self:define_timeline(timeline.new({
		id = opening_timeline_id,
		frames = timeline.range(constants.world_entrance.open_step_frames * 2),
		playback_mode = 'once',
	}))
end

local function register_world_entrance_definition()
	define_prefab({
		def_id = 'world_entrance',
		class = world_entrance,
		type = 'sprite',
		defaults = {
			target = nil,
			entrance_state = 'closed',
		},
	})
end

return {
	register_world_entrance_definition = register_world_entrance_definition,
}
