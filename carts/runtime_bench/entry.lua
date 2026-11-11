module<entry>
local display<const> = require('cartlib/gx/display')
local input<const> = require('cartlib/input/input')
local input_system<const> = require('cartlib/input/input_system')
local clock<const> = require('cartlib/clock')
local world<const> = require('cartlib/world/world')
local vblank<const> = require('cartlib/gx/vblank')
local simulation<const> = require('simulation')
local presentation<const> = require('presentation')

display.reset_320x240()
input.add_player(1)
world:configure({
	framebuffer_count = 1, gameplay_interval_vblanks = 1, frame_interval_vblanks = 1,
	spaces = { 'main' }, systems = { input_system, simulation.system },
})
local controls<const> = {
	left = input.bind(1, clock.frame, 'left[jp]'),
	right = input.bind(1, clock.frame, 'right[jp]'),
	up = input.bind(1, clock.frame, 'up[jp]'),
	down = input.bind(1, clock.frame, 'down[jp]'),
	restart = input.bind(1, clock.frame, 'a[jp]'),
}
simulation.install()
presentation.install()
runtime_bench = simulation.state
simulation.reset(3, 1)
presentation.reset()
runtime_bench_ready = true

while true do
	vblank.wait()
	local state<const> = simulation.state
	local previous_step<const> = state.steps
	world:update()
	local mode, size = state.mode, state.size_index
	if controls.left() then mode = (mode + 1) % 3 + 1 end
	if controls.right() then mode = mode % 3 + 1 end
	if controls.up() then size = size % #simulation.sizes + 1 end
	if controls.down() then size = (size + #simulation.sizes - 2) % #simulation.sizes + 1 end
	if mode ~= state.mode or size ~= state.size_index or controls.restart() then
		simulation.reset(mode, size)
		presentation.reset()
	elseif state.mode == 3 and state.steps ~= previous_step then
		if state.steps % 16 == 0 or state.finished then presentation.refresh() end
		world:render()
	end
end
