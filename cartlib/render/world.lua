local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')

local render_command_capacity<const> = 4096

bss cartlib_render_commands: word[render_command_capacity]

local draw_commands<const> = command_list.new(cartlib_render_commands)
local world_render<const> = {}

local build_world_commands<const> = function(world, framebuffer, framebuffer_size, clear_color)
	command_list.begin(draw_commands, gp0.draw_mode_blend_half)
	draw_commands:clear(framebuffer, framebuffer_size, clear_color)
	world:sort_active_visuals()
	local components<const> = world.active_space.active_visual_components
	for i = 1, #components do
		local component<const> = components[i]
		if component.parent.visible and component.visible then
			component:draw(draw_commands)
		end
	end
end

function world_render.draw(world, framebuffer, framebuffer_size, clear_color)
	build_world_commands(world, framebuffer, framebuffer_size, clear_color)
	command_list.submit(draw_commands)
end

function world_render.draw_fenced(world, framebuffer, framebuffer_size, clear_color)
	build_world_commands(world, framebuffer, framebuffer_size, clear_color)
	command_list.submit_fenced(draw_commands)
end

return world_render
