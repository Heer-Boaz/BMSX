local command_list<const> = require('cartlib/gx/command_list')
local gx_display<const> = require('cartlib/gx/display')
local gx_gpu<const> = require('cartlib/gx/gpu')
local gp0<const> = require('cartlib/gx/gp0')
local renderer_config<const> = require('bmsx/renderer_config')
local world<const> = require('cartlib/world/world')

local clear_color<const> = 0xff000000
local render_command_capacity<const> = 4096

bss cartlib_render_commands: word[render_command_capacity]

local renderer<const> = {
	_draw_commands = command_list.new(cartlib_render_commands),
	_visuals = {},
	_visual_count = 0,
	_visual_revision = -1,
	_page_size = renderer_config.page_size,
}

local visual_depth_less<const> = function(a, b)
	local a_depth<const> = a.parent.z + a.offset_z + a.draw_offset_z
	local b_depth<const> = b.parent.z + b.offset_z + b.draw_offset_z
	if a_depth ~= b_depth then
		return a_depth < b_depth
	end
	return a._visual_sequence < b._visual_sequence
end

function renderer:_rebuild_visuals()
	local active_visuals<const>, revision<const> = world:active_visuals()
	if revision == self._visual_revision then
		return
	end

	local visuals<const> = self._visuals
	local visual_count<const> = #active_visuals
	for i = 1, visual_count do
		visuals[i] = active_visuals[i]
	end
	for i = visual_count + 1, self._visual_count do
		visuals[i] = nil
	end
	table.sort(visuals, visual_depth_less)
	self._visual_count = visual_count
	self._visual_revision = revision
end

function renderer:_build_commands(draw_page)
	local draw_commands<const> = self._draw_commands
	command_list.begin(draw_commands, gp0.draw_mode_blend_half)
	draw_commands:clear(draw_page, self._page_size, clear_color)
	self:_rebuild_visuals()
	local visuals<const> = self._visuals
	for i = 1, self._visual_count do
		local visual<const> = visuals[i]
		if visual.parent.visible and visual.visible then
			visual:draw(draw_commands)
		end
	end
end

function renderer:_draw_single_page()
	self:_build_commands(self._draw_page)
	command_list.submit(self._draw_commands)
end

function renderer:_draw_double_page()
	local draw_page<const> = self._draw_page
	self:_build_commands(draw_page)
	command_list.submit_fenced(self._draw_commands)
	gx_display.origin(draw_page)
	self._draw_page = self._display_page
	self._display_page = draw_page
	gx_gpu.draw_target(self._draw_page, self._page_size)
end

local display_page<const> = renderer_config.display_page
local draw_page<const> = renderer_config.draw_page
renderer._draw_page = draw_page
if display_page == draw_page then
	renderer.draw = renderer._draw_single_page
	gx_display.origin(draw_page)
	gx_gpu.draw_target(draw_page, renderer._page_size)
	gx_gpu.clear_color(draw_page, renderer._page_size, clear_color)
else
	renderer._display_page = display_page
	renderer.draw = renderer._draw_double_page
	gx_display.origin(display_page)
	gx_gpu.draw_target(display_page, renderer._page_size)
	gx_gpu.clear_color(display_page, renderer._page_size, clear_color)
	gx_gpu.draw_target(draw_page, renderer._page_size)
	gx_gpu.clear_color(draw_page, renderer._page_size, clear_color)
end

return renderer
