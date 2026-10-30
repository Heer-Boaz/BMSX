local fixture<const> = require('tests/carts/pietious/fixture')
local sprite_shape<const> = require('cartlib/collision/sprite_shape')
require('constants')

return {
	kind = 'integration',
	tests = {
		sword_geometry_and_modal_presentation = function(t)
			local _director<const>, _castle<const>, player<const> = fixture.start_game(t)
			player.state_machines:transition_to('/quiet')
			player:clear_input_state()
			player:zero_motion()
			player:cancel_sword()
			player.facing = 1
			player:apply_presentation_state()
			local pose<const> = player.spatial:resolve_world()
			local x<const>, y<const> = pose.wox, pose.woy
			assert(player.x == nil and player.y == nil and player.z == nil,
			'player retained a second actor-position authority')
			assert(player.collider.id_local == 'body' and player.sword_collider.id_local == 'sword'
			and player.sword_sprite.id_local == 'sword_visual',
			'sword visual construction input replaced a gameplay collider identity')
			local stand<const> = sprite_shape.image('pietolon_stand_r')
			assert(player.collider:resolve_shape() == stand.original,
			'player body did not retain its actual sprite geometry')

			assert(player:activate_sword(), 'quiet player could not activate its sword')
			player:apply_presentation_state()
			player:update_collision_state()
			local sword<const> = sprite_shape.image('sword_r')
			assert(player.sword_collider.enabled and player.sword_sprite.enabled,
			'sword activation did not publish both the physical and visual components')
			assert(player.sword_collider:resolve_shape() == sword.original,
			'right sword replaced its concave image geometry with bounds')
			local sword_pose<const> = player.sword_collider:resolve_pose()
			local sword_visual<const> = player.sword_sprite:resolve_pose()
			assert(sword_pose.wox == x + sword_ground_offset_right
			and sword_pose.woy == y + sword_ground_offset_y
			and sword_visual.wox == sword_pose.wox and sword_visual.woy == sword_pose.woy,
			'right sword stance separated its visual attachment from the physical blade')

			player.facing = -1
			player:apply_presentation_state()
			assert(player.sword_collider:resolve_shape() == sword.fliph,
			'left sword did not select the actual mirrored concave geometry')
			player.sword_sprite:resolve_pose()
			assert(sword_pose.wox == x + sword_ground_offset_left
			and sword_visual.wox == sword_pose.wox and sword_visual.woy == sword_pose.woy,
			'left sword stance did not move the visual and physical blade together')
			local slash<const> = sprite_shape.image('pietolon_slash_r')
			assert(player.collider:resolve_shape() == slash.fliph,
			'sword body animation did not update its exact mirrored collision source')

			player:cancel_sword()
			player:apply_presentation_state()
			player:begin_pause_presentation()
			player.spatial:resolve_world()
			local body<const> = player.collider:resolve_pose()
			local visual<const> = player.sprite_component:resolve_pose()
			assert(pose.wox == x and pose.woy == y and body.wox == x and body.woy == y,
			'pause presentation moved the physical player or body collider')
			assert(visual.wox == x - 2 and visual.woy == y - 8,
			'pause sprite did not apply its presentation-only displacement')
			assert(not player.sword_sprite.enabled, 'pause retained a visible sword')
			player:finish_pause_presentation()
			player.sprite_component:resolve_pose()
			assert(visual.wox == x and visual.woy == y,
			'resuming gameplay retained the pause presentation displacement')

			-- Cropping a shrine passage is visual placement, never physical travel.
			player.sprite_component:set_region(0, 0, player_width, player_height)
			player.timelines:seek('p.tl.se', 1)
			player.sprite_component:resolve_pose()
			player.collider:resolve_pose()
			player.spatial:resolve_world()
			assert(visual.wox == x and visual.woy == y + 1
			and visual.region_y == 0 and visual.region_height == player_height - 1,
			'shrine passage did not crop and displace its actual sprite component')
			assert(pose.wox == x and pose.woy == y and body.wox == x and body.woy == y,
			'shrine crop leaked presentation placement into physical collision')
			player.timelines:seek_to_end('p.tl.se')
			assert(not visual.visible, 'terminal shrine crop left its empty sprite visible')
			player:reset_enter_leave_animation()
		end,
	},
}
