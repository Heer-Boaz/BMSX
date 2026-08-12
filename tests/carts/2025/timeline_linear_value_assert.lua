local eventemitter<const> = require('cartlib/eventemitter')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timelinecomponent<const> = require('cartlib/timeline/timeline_component')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()

local owner<const> = { id = 'timeline_linear_value_test' }
function owner:add_tag()
end
function owner:remove_tag()
end
owner.events = eventemitter.events_of(owner)

local timelines<const> = timelinecomponent.new({ parent = owner })
timelines:on_attach()
local target<const> = { value = -1, method = -1 }
timelines:define('time_linear', {
	continuous = true,
	duration_ms = 100,
	tracks = {
		{
			kind = 'value',
			interpolation = 'linear',
			apply = function(binding, value, _params, evaluation)
				binding.value = value
				binding.method = evaluation.method
			end,
			keys = {
				{ time_ms = 100, value = 0 },
				{ time_ms = 0, value = 0 },
				{ time_ms = 50, value = 20 },
			},
		},
	},
})
timelines:play('time_linear', { target = target })
assert(target.value == 0 and target.method == timeline_module.update_method.play)
timelines:tick_active(25)
assert(target.value == 10)
timelines:tick_active(25)
assert(target.value == 20)
timelines:seek_time('time_linear', 75)
assert(target.value == 10 and target.method == timeline_module.update_method.jump)
timelines:scrub_time('time_linear', 100)
assert(target.value == 0 and target.method == timeline_module.update_method.scrub)
timelines:seek_time('time_linear', 25)
assert(target.value == 10 and target.method == timeline_module.update_method.jump)
timelines:stop('time_linear')

local frame_target<const> = { nested = { value = -1, other = -1, constant = -1 } }
timelines:define('frame_linear', {
	frames = timeline_module.range(5),
	frame_duration = 20,
	tracks = {
		{
			kind = 'value',
			interpolation = 'linear',
			path = { 'nested', 'value' },
			keys = {
				{ frame = 0, value = 0 },
				{ frame = 4, value = 40 },
			},
		},
		{
			kind = 'value',
			interpolation = 'linear',
			path = { 'nested', 'other' },
			keys = {
				{ frame = 0, value = 5 },
				{ frame = 4, value = 9 },
			},
		},
		{
			kind = 'value',
			interpolation = 'linear',
			path = { 'nested', 'constant' },
			keys = {
				{ frame = 2, value = 7 },
			},
		},
	},
})
timelines:play('frame_linear', { target = frame_target })
assert(frame_target.nested.value == 0 and frame_target.nested.other == 5)
assert(frame_target.nested.constant == 7)
timelines:tick_active(20)
assert(frame_target.nested.value == 10 and frame_target.nested.other == 6)
timelines:seek('frame_linear', 3)
assert(frame_target.nested.value == 30 and frame_target.nested.other == 8)
timelines:stop('frame_linear')

local built_target<const> = { value = -1 }
timelines:define('built_frame_linear', {
	frames = function(params)
		return timeline_module.range(params.frame_count)
	end,
	frame_duration = 20,
	tracks = {
		{
			kind = 'value',
			interpolation = 'linear',
			path = { 'value' },
			keys = {
				{ u = 0, value = 0 },
				{ u = 0.5, value = 80 },
				{ u = 1, value = 0 },
			},
		},
	},
})
timelines:play('built_frame_linear', {
	target = built_target,
	params = { frame_count = 5 },
})
timelines:tick_active(20)
assert(built_target.value == 40)
timelines:tick_active(20)
assert(built_target.value == 80)
timelines:stop('built_frame_linear')
timelines:play('built_frame_linear', {
	target = built_target,
	params = { frame_count = 9 },
})
timelines:tick_active(20)
assert(built_target.value == 20)
timelines:tick_active(20)
assert(built_target.value == 40)
timelines:stop('built_frame_linear')

local pingpong_target<const> = { value = -1 }
timelines:define('pingpong_linear', {
	continuous = true,
	duration_ms = 100,
	playback_mode = 'pingpong',
	tracks = {
		{
			kind = 'value',
			interpolation = 'linear',
			path = { 'value' },
			keys = {
				{ time_ms = 0, value = 0 },
				{ time_ms = 100, value = 100 },
			},
		},
	},
})
timelines:play('pingpong_linear', { target = pingpong_target })
timelines:tick_active(125)
assert(pingpong_target.value == 75)
timelines:tick_active(50)
assert(pingpong_target.value == 25)
timelines:stop('pingpong_linear')

local child<const> = {
	continuous = true,
	duration_ms = 100,
	bindings = { 'camera' },
	tracks = {
		{
			kind = 'value',
			interpolation = 'linear',
			binding = 'camera',
			path = { 'value' },
			keys = {
				{ time_ms = 0, value = 0 },
				{ time_ms = 100, value = 100 },
			},
		},
	},
}
local camera<const> = { value = -1 }
timelines:define('nested_linear', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			playback_mode = 'loop',
			sequence = child,
		},
	},
})
timelines:play('nested_linear', { bindings = { camera = camera } })
timelines:tick_active(225)
assert(camera.value == 25)
timelines:seek_time('nested_linear', 125)
assert(camera.value == 25)
timelines:stop('nested_linear')

	return nil
end

function __bmsx_host_test.update()
	return true
end
