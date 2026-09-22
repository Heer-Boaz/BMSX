local registry<const> = require('cartlib/registry')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
require('constants')
local fixture<const> = require('tests/carts/nemesis_s/fixture')

return {
	kind = 'integration',
	tests = {
		mijter_foe = function(t)
			local _director<const>, stage<const> = fixture.start_game(t)
			local mijter_foes<const> = world:active_definition_view(ids_mijter_foe_def).objects
			t:wait_until('authored MijterFoe spawn', function() return stage.tape_head - 1 >= 56 and #mijter_foes > 0 end, 700)
			assert(#mijter_foes == 1, 'MijterFoe marker did not spawn exactly one actor')
			local authored_spawn
			for index = 1, stage.actor_spawn_count do
				local spawn<const> = stage.actor_spawns[index]
				if spawn.definition_id == ids_mijter_foe_def
				and spawn.options.mijter_type == mijter_foe_type_red then
					authored_spawn = spawn
					break
				end
			end
			assert(authored_spawn.column == 56, 'MijterFoe missed its authored XNA stage column')
			assert(authored_spawn.options.pos.x == playfield_width,
			'MijterFoe no longer enters at the playfield edge')
			assert(authored_spawn.options.pos.y == 40, 'MijterFoe no longer uses the XNA row offset')
			local foe<const> = mijter_foes[1]
			assert(foe.mijter_type == mijter_foe_type_red, 'uppercase M did not produce the red MijterFoe')
			assert(prefab.definition(ids_mijter_foe_def).defaults.imgid == assets_mijter_foe_blue_neutral,
			'MijterFoe prefab started with the wrong image')
			assert(foe.drop_definition_id == ids_roodje_def, 'red MijterFoe no longer drops a capsule')
			assert(foe.motion.velocity_x == mijter_foe_velocity_x_q8,
			'MijterFoe did not acquire the Nemesis 2 Sodom horizontal word')
			assert(foe.motion.velocity_y == 0, 'MijterFoe did not start with zero vertical velocity')
			stage.scrolling = false

			local previous_x = foe.x
			local previous_velocity_y = foe.motion.velocity_y
			for tracking_update = 1, 8 do
				t:wait_until('MijterFoe steering down', function()
					return foe.x ~= previous_x and foe.motion.velocity_y ~= previous_velocity_y
					and foe.sprite_component.imgid == assets_mijter_foe_red_down
				end, 120)
				local dx<const> = foe.x - previous_x
				local velocity_delta<const> = foe.motion.velocity_y - previous_velocity_y
				assert(velocity_delta > 0 and velocity_delta % mijter_foe_tracking_acceleration_y_q8 == 0,
				'MijterFoe no longer accelerates toward a lower player')
				assert(dx == -3 * (velocity_delta // mijter_foe_tracking_acceleration_y_q8),
				'MijterFoe lost the Sodom three-pixel horizontal step')
				previous_x = foe.x
				previous_velocity_y = foe.motion.velocity_y
			end
			foe.target.y = foe.y - 32
			t:wait_until('MijterFoe steering up', function()
				return foe.x ~= previous_x and foe.motion.velocity_y ~= previous_velocity_y
				and foe.motion.velocity_y < 0 and foe.sprite_component.imgid == assets_mijter_foe_red_up
			end, 120)
			local velocity_delta<const> = previous_velocity_y - foe.motion.velocity_y
			assert(velocity_delta % mijter_foe_tracking_acceleration_y_q8 == 0,
			'MijterFoe no longer accelerates toward a higher player')
			assert(foe.x - previous_x == -3 * (velocity_delta // mijter_foe_tracking_acceleration_y_q8),
			'MijterFoe horizontal step changed while steering')
			foe.x = -mijter_foe_width - 1
			t:wait_until('MijterFoe leaves playfield', function() return #mijter_foes == 0 end, 120)

		end,
	},
}
