local fixture<const> = require('tests/carts/nemesis_s/fixture')
local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local sprite_component<const> = require('cartlib/component/sprite_component')
local player_state_module<const> = require('player/player_state')
local player_start<const> = require('player/player_start')
require('constants')

bss actual_commands: word[128]
bss expected_commands: word[128]

return {
	kind = 'integration',
	tests = {
		vessel_batch_and_independent_projectile_pose = function(t)
			local _director<const>, stage<const>, player<const> = fixture.start_game(t)
			for row_index = 1, stage.tile_rows do
				local row<const> = stage.solid_tape[row_index]
				for column = 1, 40 do row[column] = 0 end
			end
			local pose<const> = player.spatial
			-- A descendant makes origin writes invalidate derived world state;
			-- gameplay still consumes the root's current committed authority.
			player.scene:spawn(player_start.definition_id, {}, {
				parent = pose,
				local_transform = { 1, 0, 0, 1, 0, 0 },
			})
			pose:set_world_origin(41, 25)
			local visual<const> = player.sprite_component
			local body<const> = player.body_collider
			assert(player:get_component(sprite_component, 'base_sprite') == visual,
			'the player vessel is not its actual primary Sprite component')
			assert(player.x == nil and player.y == nil and player.z == nil and player.sprite == nil,
			'the player retained a second pose or vessel source authority')
			local state<const> = player.player_state
			for _ = 1, 2 do
				state.current_powerup_slot = player_state_module.powerup_slot.option
				assert(state:activate_selected_powerup() == player_state_module.powerup_slot.option)
			end
			player.options[1].x, player.options[1].y = 25, 50
			player.options[2].x, player.options[2].y = 33, 60

			visual:set_imgid(assets_player_u)
			visual:set_presentation_origin(-4, 2)
			pose:set_world_origin(57, 33)
			local body_pose<const> = body:resolve_pose()
			local visual_pose<const> = visual:resolve_pose()
			assert(body_pose.wox == 57 and body_pose.woy == 33
			and visual_pose.wox == 53 and visual_pose.woy == 35,
			'vessel presentation displaced the physical player or failed to follow its current root')
			assert(body.local_left == 2 and body.local_top == 2
			and body.local_right == 14 and body.local_bottom == 8,
			'vessel image selection replaced the explicit player hit area')

			-- This packet comparison is the vessel producer contract: the same
			-- option batch precedes the newly selected primary image, with option
			-- world positions independent of the player's presentation transform.
			local actual<const> = command_list.new(actual_commands)
			local expected<const> = command_list.new(expected_commands)
			command_list.begin(actual, gp0.draw_mode_blend_half, 0)
			command_list.begin(expected, gp0.draw_mode_blend_half, 0)
			visual:draw(actual)
			local option_source<const> = player.option_sources[player.option_anim_index]
			option_source:blit(expected, 25, 50)
			option_source:blit(expected, 33, 60)
			image.resolve(assets_player_u):blit(expected, 53, 35)
			assert(actual.word_count == expected.word_count,
			'changing the vessel image dropped its retained option draw batch')
			for index = 0, expected.word_count - 1 do
				assert(actual_commands[index] == expected_commands[index],
				'the vessel draw batch changed option/body order, source or coordinate ownership')
			end

			local bullet<const> = player.primary_projectiles[1]
			player:spawn_bullet(1, 57, 33, bullet)
			local collider<const> = bullet.collider
			pose:set_world_origin(1, 1)
			player:update_weapons()
			local projectile_pose<const> = collider:resolve_pose()
			assert(bullet.x == 76 and bullet.y == 39
			and projectile_pose.wox == bullet.x and projectile_pose.woy == bullet.y,
			'moving the player root moved an independently travelling projectile collider')
			pose:resolve_world()
			assert(pose.wox == 1 and pose.woy == 1 and bullet.collider == collider,
			'projectile synchronization replaced its collider or rewrote the player pose')
		end,
	},
}
