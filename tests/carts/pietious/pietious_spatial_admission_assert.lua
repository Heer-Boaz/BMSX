local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local affine2<const> = require('cartlib/math/affine2')
local collider_2d<const> = require('cartlib/collision/collider_2d_component')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local pools<const> = require('collision_storage')
local event_emitter<const> = require('cartlib/event_emitter')
local fixture<const> = require('tests/carts/pietious/fixture')
require('constants')

local record_damage_source<const> = function(record, _event_type, _emitter, event)
	record.source_x = event.source_x
end

return {
	kind = 'integration',
	tests = {
		intrinsic_pose_admission = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			local room<const> = castle.room
			assert(player._family == affine2 and player.owner == nil and player.spatial == nil
			and player.x == nil and player.y == nil and player.z == nil,
			'player must own its intrinsic Object2D pose without a forwarding component')
			assert(room.room_tile_layer.attachment_ox == room_tile_origin_x
			and room.room_tile_layer.attachment_oy == room_tile_origin_y,
			'room tile geometry must keep its local attachment independently of physical pose')
			local item<const> = room.scene:spawn('world_item', {
				room = room, player = player, item_id = 'probe.gameplay-item', item_type = 'ammo',
				position = { x = 80, y = 88 },
				imgid = world_item_sprite.ammo,
			})
			local paper<const> = room.scene:spawn('enemy.paperfoe', {
				castle = castle, room = room, player = player,
				position = { x = 96, y = 88 },
				speed_x_num = 3,
				speed_y_num = -4,
				speed_den = 2,
			})
			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(item.scene_member_id == nil and room.scene.members['probe.gameplay-item'] == nil,
			'procedural gameplay identity must not enter the authored member namespace')
			assert(item.scene == room.scene and registry:get(item.id) == item,
			'procedural pickup must still be owned and published by its live Scene')
			assert(item:get_component(collider_2d).geometry_pool == pools.sprite,
			'pickup collision must consume the cart-owned sprite geometry pool')
			local collider<const> = paper:get_component(collider_2d)
			assert(collider.sprite == paper.sprite_component and collider.geometry_pool == pools.sprite,
			'actor source must be admitted on the actual primary sprite before collider construction')
			local motion<const> = paper:get_component(velocity_component)
			assert(motion.owner == paper and motion.speed_x_num == 3
			and motion.speed_y_num == -4 and motion.speed_den == 2
			and paper.speed_x_num == 3 and paper.speed_y_num == -4,
			'gameplay velocity inputs did not initialize the attached motion component')
			item:mark_for_disposal()
			paper:mark_for_disposal()
			t:at_boundary(world:request_mutation_boundary(), 30)
			assert(item.world == nil and paper.world == nil,
			'procedural actors must retire through the same World barrier')
		end,
		image_center_selects_knockback_side = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			world:set_gameplay_clock_running(false)
			player.state_machines:transition_to('/quiet')
			player:zero_motion()
			local cloud<const> = castle.room.scene:spawn('enemy.cloud', {
				castle = castle, room = castle.room, player = player,
				position = { x = 100, y = 88 },
			})
			t:at_boundary(world:request_mutation_boundary(), 30)
			local record<const> = {}
			player.events:on({ event = 'enemy.contact_damage', subscriber = record, handler = record_damage_source })
			local cloud_x<const> = cloud:get_global_position()
			-- A source selected by the animation factory historically left owner
			-- sx/sy stale at zero. The damaging image center is explicit gameplay
			-- geometry; side classification must consume its current source metadata.
			local center<const> = cloud_x + (cloud.sprite_component.source_width // 2)
			player:set_global_position(center - (player.width // 2) - 1, 88)
			cloud.events:emit('overlap.begin', {
				other_id = player.id, other_layer = collision_player_layer,
				other_collider_local_id = 'body', phase = 'begin',
			})
			assert(player:get_hit_direction_from_source(record.source_x) == -1,
			'contact from the damaging image center on the right must knock the player left')
			player:set_global_position(center - (player.width // 2) + 1, 88)
			cloud.events:emit('overlap.begin', {
				other_id = player.id, other_layer = collision_player_layer,
				other_collider_local_id = 'body', phase = 'begin',
			})
			assert(player:get_hit_direction_from_source(record.source_x) == 1,
			'contact from the damaging image center on the left must knock the player right')
			event_emitter:remove_subscriber(record)
			cloud:mark_for_disposal()
		end,
	},
}
