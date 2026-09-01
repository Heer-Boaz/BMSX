local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local gx_gpu<const> = require('cartlib/gx/gpu')

local overlay<const> = {}
overlay.__index = overlay

local overlay_command_capacity<const> = 256
local transparent<const> = 0x00000000
local hover_color<const> = 0xffffc857
local selection_color<const> = 0xff45d9ff
local axis_x_color<const> = 0xffff5d73
local axis_y_color<const> = 0xff6ee7b7
local pointer_color<const> = 0xffffffff
local force_mask_bit<const> = 0x00000001

bss studio_overlay_commands: word[overlay_command_capacity]

function overlay.new(origin, page_size)
	return setmetatable({
		origin = origin,
		page_size = page_size,
		draw = command_list.new(studio_overlay_commands),
	}, overlay)
end

local outline<const> = function(draw, left, top, right, bottom, color)
	draw:line(left, top, right, top, color)
	draw:line(right, top, right, bottom, color)
	draw:line(right, bottom, left, bottom, color)
	draw:line(left, bottom, left, top, color)
end

local object_outline<const> = function(draw, obj, color)
	local left<const>, top<const>, right<const>, bottom<const> = obj:edit_bounds()
	if left ~= nil then
		outline(draw, left, top, right, bottom, color)
	end
end

local component_outline<const> = function(draw, comp, color)
	local left<const>, top<const>, right<const>, bottom<const> = comp:edit_bounds()
	if left ~= nil then
		local obj<const> = comp.parent
		outline(draw, obj.x + left, obj.y + top, obj.x + right, obj.y + bottom, color)
	end
end

function overlay:render(editor)
	gx_gpu.draw_target(self.origin, self.page_size)
	local draw<const> = self.draw
	command_list.begin(draw, gp0.draw_mode_blend_half, self.origin)
	draw:mask(0)
	draw:clear(self.origin, self.page_size, transparent)
	draw:mask(force_mask_bit)
	local pointer_x<const> = editor.pointer_x
	local pointer_y<const> = editor.pointer_y
	draw:line(pointer_x - 5, pointer_y, pointer_x + 6, pointer_y, pointer_color)
	draw:line(pointer_x, pointer_y - 5, pointer_x, pointer_y + 6, pointer_color)
	local hover_object<const> = editor.hover_object
	if hover_object ~= nil and hover_object ~= editor.selected_object then
		object_outline(draw, hover_object, hover_color)
	end
	local selected_object<const> = editor.selected_object
	if selected_object ~= nil then
		object_outline(draw, selected_object, selection_color)
		local selected_component<const> = editor.selected_component
		if selected_component ~= nil then
			component_outline(draw, selected_component, hover_color)
		end
		local x<const> = selected_object.x
		local y<const> = selected_object.y
		draw:line(x - 12, y, x + 13, y, axis_x_color)
		draw:line(x, y - 12, x, y + 13, axis_y_color)
		draw:rect(x - 3, y - 3, x + 4, y + 4, selection_color)
	end
	draw:mask(0)
	command_list.submit(draw)
end

return overlay
