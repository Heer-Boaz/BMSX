local command_list<const> = require('cartlib/gx/command_list')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local irq<const> = require('cartlib/irq')

local irq_mask<const>: *word = 0x08000008
local irq_vblank<const> = 0x0004
local render_command_capacity<const> = 4096

bss cartlib_render_commands: word[render_command_capacity]

local renderer<const> = {}
renderer.__index = renderer

local pageflippedrenderer<const> = {}
pageflippedrenderer.__index = pageflippedrenderer
setmetatable(pageflippedrenderer, { __index = renderer })

local create<const> = function(world, clear_color, class)
	local width<const>, height<const> = gx_display.size()
	local self<const> = setmetatable({
		world = world,
		draw = command_list.new(cartlib_render_commands),
		framebuffer_size = width | (height << 16),
		clear_color = clear_color,
		vblank_sequence = 0,
	}, class)
	irq.register(irq_vblank, function()
		self.vblank_sequence = self.vblank_sequence + 1
	end)
	*irq_mask = *irq_mask | irq_vblank
	return self
end

local draw_world<const> = function(self)
	local world<const> = self.world
	world:update_presentation()
	world:sort_active_visuals()
	local components<const> = world.active_space.active_visual_components
	local draw<const> = self.draw
	for i = 1, #components do
		local component<const> = components[i]
		if component.parent.visible and component.visible then
			component:draw(draw)
		end
	end
end

function renderer.new(world, framebuffer, clear_color)
	local self<const> = create(world, clear_color, renderer)
	self.framebuffer = framebuffer
	gx_gpu.draw_target(framebuffer, self.framebuffer_size)
	gx_gpu.clear_color(framebuffer, self.framebuffer_size, clear_color)
	return self
end

function renderer.new_page_flipped(world, front_framebuffer, back_framebuffer, clear_color)
	local self<const> = create(world, clear_color, pageflippedrenderer)
	self.front_framebuffer = front_framebuffer
	self.back_framebuffer = back_framebuffer
	gx_gpu.draw_target(front_framebuffer, self.framebuffer_size)
	gx_gpu.clear_color(front_framebuffer, self.framebuffer_size, clear_color)
	gx_gpu.draw_target(back_framebuffer, self.framebuffer_size)
	gx_gpu.clear_color(back_framebuffer, self.framebuffer_size, clear_color)
	return self
end

function renderer:wait_vblank()
	local sequence<const> = self.vblank_sequence
	while self.vblank_sequence == sequence do
		halt_until_irq
	end
end

function renderer:render()
	local draw<const> = self.draw
	command_list.begin(draw, gp0.draw_mode_blend_half)
	draw:clear(self.framebuffer, self.framebuffer_size, self.clear_color)
	draw_world(self)
	command_list.submit(draw)
end

function pageflippedrenderer:render()
	local draw<const> = self.draw
	command_list.begin(draw, gp0.draw_mode_blend_half)
	draw:clear(self.back_framebuffer, self.framebuffer_size, self.clear_color)
	draw_world(self)
	command_list.submit_fenced(draw)
end

function pageflippedrenderer:present()
	gx_display.origin(self.back_framebuffer)
	self:wait_vblank()
	local previous_front<const> = self.front_framebuffer
	self.front_framebuffer = self.back_framebuffer
	self.back_framebuffer = previous_front
	gx_gpu.draw_target(self.back_framebuffer, self.framebuffer_size)
end

return renderer
