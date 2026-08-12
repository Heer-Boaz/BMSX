local event_emitter<const> = require('cartlib/event_emitter')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

local abs<const> = math.abs

local assert_close<const> = function(actual, expected)
	assert(abs(actual - expected) < 0.000001)
end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()

local owner<const> = { id = 'timeline_cubic_value_test' }
function owner:add_tag()
end
function owner:remove_tag()
end
owner.events = event_emitter.events_of(owner)

local timelines<const> = timeline_component.new({ parent = owner })
timelines:on_attach()
local target<const> = { value = -1, method = -1 }
timelines:define('time_cubic', {
	continuous = true,
	duration_ms = 100,
	tracks = {
		{
			kind = 'value',
			interpolation = 'cubic',
			apply = function(binding, value, _params, evaluation)
				binding.value = value
				binding.method = evaluation.method
			end,
			keys = {
				{ time_ms = 100, value = 10, arrive_tangent = 0 },
				{ time_ms = 0, value = 0, leave_tangent = 0.2 },
			},
		},
	},
})
timelines:play('time_cubic', { target = target })
assert_close(target.value, 0)
timelines:tick_active(25)
assert_close(target.value, 4.375)
timelines:tick_active(25)
assert_close(target.value, 7.5)
timelines:seek_time('time_cubic', 75)
assert_close(target.value, 9.375)
assert(target.method == timeline_module.update_method.jump)
timelines:scrub_time('time_cubic', 100)
assert_close(target.value, 10)
assert(target.method == timeline_module.update_method.scrub)
timelines:stop('time_cubic')

local frame_target<const> = { nested = { value = -1 } }
timelines:define('frame_cubic', {
	frames = timeline_module.range(5),
	frame_duration = 20,
	tracks = {
		{
			kind = 'value',
			interpolation = 'cubic',
			path = { 'nested', 'value' },
			keys = {
				{ frame = 0, value = 0, leave_tangent = 0 },
				{ frame = 2, value = 20, arrive_tangent = 0, leave_tangent = 0 },
				{ frame = 4, value = 40, arrive_tangent = 0 },
			},
		},
	},
})
timelines:play('frame_cubic', { target = frame_target })
assert_close(frame_target.nested.value, 0)
timelines:tick_active(20)
assert_close(frame_target.nested.value, 10)
timelines:seek('frame_cubic', 3)
assert_close(frame_target.nested.value, 30)
timelines:seek('frame_cubic', 1)
assert_close(frame_target.nested.value, 10)
timelines:stop('frame_cubic')

local pingpong_target<const> = { value = -1 }
timelines:define('pingpong_cubic', {
	continuous = true,
	duration_ms = 100,
	playback_mode = 'pingpong',
	tracks = {
		{
			kind = 'value',
			interpolation = 'cubic',
			path = { 'value' },
			keys = {
				{ time_ms = 0, value = 0, leave_tangent = 0 },
				{ time_ms = 100, value = 100, arrive_tangent = 0 },
			},
		},
	},
})
timelines:play('pingpong_cubic', { target = pingpong_target })
timelines:tick_active(125)
assert_close(pingpong_target.value, 84.375)
timelines:tick_active(50)
assert_close(pingpong_target.value, 15.625)
timelines:stop('pingpong_cubic')

local child<const> = {
	continuous = true,
	duration_ms = 100,
	bindings = { 'camera' },
	tracks = {
		{
			kind = 'value',
			interpolation = 'cubic',
			binding = 'camera',
			path = { 'value' },
			keys = {
				{ time_ms = 0, value = 0, leave_tangent = 0 },
				{ time_ms = 100, value = 100, arrive_tangent = 0 },
			},
		},
	},
}
local camera<const> = { value = -1 }
timelines:define('nested_cubic', {
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
timelines:play('nested_cubic', { bindings = { camera = camera } })
timelines:tick_active(225)
assert_close(camera.value, 15.625)
timelines:seek_time('nested_cubic', 175)
assert_close(camera.value, 84.375)
timelines:stop('nested_cubic')

	return nil
end

function __bmsx_host_test.update()
	return true
end
