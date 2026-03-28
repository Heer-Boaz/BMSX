local constants = require('constants')

local arena = {}
arena.__index = arena

function arena:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function()
		self:draw()
	end
end

function arena:draw_hp_bar(base_x, base_y, max_width, value, max_value, color)
	local filled = (value * max_width) / max_value
	fill_rect_color(base_x, base_y, base_x + max_width, base_y + 4, constants.z.hud, constants.palette.metal)
	fill_rect_color(base_x, base_y, base_x + filled, base_y + 4, constants.z.hud + 1, color)
end

function arena:draw()
	fill_rect_color(0, 0, constants.machine.width, constants.machine.height, constants.z.background, constants.palette.bg)
	fill_rect_color(0, constants.physics.floor_y, constants.machine.width, constants.physics.floor_y + 6, constants.z.background + 1, constants.palette.floor)

	local player = object(constants.ids.player_instance)
	local enemy = object(constants.ids.enemy_instance)
	self:draw_hp_bar(8, 8, 84, player.health, constants.player.max_health, constants.palette.player)
	self:draw_hp_bar(164, 8, 84, enemy.health, constants.enemy.max_health, constants.palette.enemy)

	fill_rect_color(6, 6, 10, 14, constants.z.hud, constants.palette.player)
	fill_rect_color(162, 6, 166, 14, constants.z.hud, constants.palette.enemy)
end

function arena:ctor()
	self:bind_visual()
end

local function register_arena_definition()
	define_prefab({
		def_id = constants.ids.arena_def,
		class = arena,
		components = { 'customvisualcomponent' },
		defaults = {
			arena_width = constants.machine.width,
			arena_height = constants.machine.height,
		},
	})
end

return {
	arena = arena,
	register_arena_definition = register_arena_definition,
	arena_def_id = constants.ids.arena_def,
	arena_instance_id = constants.ids.arena_instance,
}
