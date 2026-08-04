-- Retained visual-component submission and display-surface ownership.
-- The ROM producer defines one or two framebuffer pages. The system selects
-- that policy once when the world graph is composed; the frame hot path has no
-- framebuffer-mode branch and never allocates command records.

local command_list<const> = require('cartlib/gx/command_list')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local ecs<const> = require('cartlib/ecs')
local vram_layout<const> = require('bmsx/gx_vram_layout')
local world<const> = require('cartlib/world/world')

local framebuffer<const> = vram_layout.framebuffer
local framebuffer_front<const> = vram_layout.framebuffer_front
local framebuffer_back<const> = vram_layout.framebuffer_back
local framebuffer_size<const> = vram_layout.framebuffer_size
local framebuffer_count<const> = vram_layout.framebuffer_count
local clear_color<const> = 0xff000000
local render_command_capacity<const> = 4096

bss cartlib_render_commands: word[render_command_capacity]

local draw_commands<const> = command_list.new(cartlib_render_commands)

local render_system<const> = {}
render_system.__index = render_system
setmetatable(render_system, { __index = ecs.system })

local single_buffer_system<const> = {}
single_buffer_system.__index = single_buffer_system
setmetatable(single_buffer_system, { __index = render_system })

local double_buffer_system<const> = {}
double_buffer_system.__index = double_buffer_system
setmetatable(double_buffer_system, { __index = render_system })

local build_visual_commands<const> = function(target_framebuffer)
	command_list.begin(draw_commands, gp0.draw_mode_blend_half)
	draw_commands:clear(target_framebuffer, framebuffer_size, clear_color)
	world:sort_active_visuals()
	local components<const> = world.active_space.active_visual_components
	for i = 1, #components do
		local component<const> = components[i]
		if component.parent.visible and component.visible then
			component:draw(draw_commands)
		end
	end
end

function single_buffer_system.new(priority)
	gx_display.origin(framebuffer)
	gx_gpu.draw_target(framebuffer, framebuffer_size)
	gx_gpu.clear_color(framebuffer, framebuffer_size, clear_color)
	return setmetatable(ecs.system.new(ecs.tick_group.presentation, priority), single_buffer_system)
end

function single_buffer_system:update()
	build_visual_commands(framebuffer)
	command_list.submit(draw_commands)
end

function double_buffer_system.new(priority)
	gx_display.origin(framebuffer_front)
	gx_gpu.draw_target(framebuffer_front, framebuffer_size)
	gx_gpu.clear_color(framebuffer_front, framebuffer_size, clear_color)
	gx_gpu.draw_target(framebuffer_back, framebuffer_size)
	gx_gpu.clear_color(framebuffer_back, framebuffer_size, clear_color)
	local self<const> = setmetatable(ecs.system.new(ecs.tick_group.presentation, priority), double_buffer_system)
	self.front_framebuffer = framebuffer_front
	self.back_framebuffer = framebuffer_back
	return self
end

function double_buffer_system:update()
	local back_framebuffer<const> = self.back_framebuffer
	build_visual_commands(back_framebuffer)
	command_list.submit_fenced(draw_commands)
	gx_display.origin(back_framebuffer)
	self.back_framebuffer = self.front_framebuffer
	self.front_framebuffer = back_framebuffer
	gx_gpu.draw_target(self.back_framebuffer, framebuffer_size)
end

local create_render_system<const> = function(priority)
	if framebuffer_count == 1 then
		return single_buffer_system.new(priority)
	end
	return double_buffer_system.new(priority)
end

return create_render_system
