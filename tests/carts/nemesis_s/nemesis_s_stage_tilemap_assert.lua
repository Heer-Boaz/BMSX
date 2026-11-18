local fixture<const> = require('tests/carts/nemesis_s/fixture')
local stage_collision<const> = require('stage_collision')

return {
	kind = 'integration',
	tests = {
		collision_roles = function()
			local solid<const> = "!#%()+-=@RS^_dsw"
			local row<const> = { 1, 2, 3 }
			local roles<const> = { 32, 32, 32 }
			for role = 0, 127 do
				roles[1] = role
				assert(stage_collision.is_solid(role, row, roles, 1, 1)
					== (string.find(solid, string.char(role), 1, true) ~= nil),
					'isolated stage roles changed their collision meaning')
			end
			local neighbors<const> = { 32, 35, 49, 50, 51, 52, 53, 54, 55, 116 }
			for _, left in ipairs(neighbors) do
				roles[1] = left
				for _, right in ipairs(neighbors) do
					roles[2] = 116
					roles[3] = right
					local expected = false
					if right >= 49 and right <= 55 then expected = right ~= 49
					elseif left >= 49 and left <= 55 then expected = left ~= 49 end
					assert(stage_collision.is_solid(116, row, roles, 2, 3) == expected,
						'tree-center collision must prefer the right-hand marker, even when it is open')
					for center = 49, 55 do
						roles[2] = center
						assert(stage_collision.is_solid(center, row, roles, 2, 3)
							== (left == 116 and center ~= 55),
							'tree-middle collision belongs only to rows 1..6 following a tree')
					end
				end
			end
			roles[2] = 116
			row[1] = 0
			row[3] = 0
			assert(not stage_collision.is_solid(116, row, roles, 2, 3),
				'absent neighboring tiles do not provide a tree marker')
		end,
		stage_admission_is_retained = function(t)
			local director<const>, stage<const> = fixture.start_game(t)
			local solids<const>, actors<const>, tiles<const> = stage.solid_tape, stage.actor_spawns, stage.stage_tiles
			stage:reset_runtime()
			assert(stage.solid_tape == solids and stage.actor_spawns == actors and stage.stage_tiles == tiles,
				'checkpoint reset must reuse the admitted terrain, collision and actor tape')
		end,
	},
}
