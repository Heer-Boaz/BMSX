local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local rect_overlaps<const> = require('cartlib/util/rect_overlaps')
require('constants')
local sprite_id_by_kind<const> = {
	[1] = {
		closed = 'draaideur_1_closed',
		open_1 = 'draaideur_1_open_1',
		open_2 = 'draaideur_1_open_2',
		open_3 = 'draaideur_1_open_3',
	},
	[2] = {
		closed = 'draaideur_2_closed',
		open_1 = 'draaideur_2_open_1',
		open_2 = 'draaideur_2_open_2',
		open_3 = 'draaideur_2_open_3',
	},
}

local pose<const> = {
	closed = { sprite = 'closed', offset_x = 0 },
	open_1 = { sprite = 'open_1', offset_x = -room_tile_half },
	open_2 = { sprite = 'open_2', offset_x = -room_tile_size },
	open_3 = { sprite = 'open_3', offset_x = -room_tile_half },
}
local opening_leftward_timeline_id<const> = 'draaideur.opening_leftward'
local opening_rightward_timeline_id<const> = 'draaideur.opening_rightward'

local draaideur<const> = {}
draaideur.__index = draaideur

function draaideur:touches_player(player, walking_left, walking_right)
	if walking_left then
		return rect_overlaps(
			player.x,
			player.y,
			player.width,
			player.height,
			self.x + room_tile_unit,
			self.y,
			room_tile_size,
			room_tile_size2
		)
	end

	if not walking_right then
		return false
	end
	return rect_overlaps(
		player.x,
		player.y,
		player.width,
		player.height,
		self.x - room_tile_unit,
		self.y,
		room_tile_size,
		room_tile_size2
	)
end

function draaideur:set_pose(next_pose)
	self:set_imgid(sprite_id_by_kind[self.kind][next_pose.sprite])
	self.sprite_component.offset_x = next_pose.offset_x
end

function draaideur:enter_active(state)
	state.data.push_steps = 0
	self.collision_enabled = true
	self:set_pose(pose.closed)
end

function draaideur:enter_opening()
	self.collision_enabled = false
end

function draaideur:update_active(state)
	local player<const> = self.player
	local walking_left<const> = player:has_tag('v.wl')
	local walking_right<const> = player:has_tag('v.wr')
	if (self.kind == 2 and walking_right)
	or (self.kind == 3 and walking_left)
	or not self:touches_player(player, walking_left, walking_right)
	then
		state.data.push_steps = 0
		return
	end

	local push_steps<const> = state.data.push_steps + 1
	state.data.push_steps = push_steps
	if push_steps < draaideur_push_steps then
		return
	end

	self.castle.events:emit('rotatedoor')
	player:start_slow_doorpass()
	if walking_left then
		return '/opening_leftward'
	end
	return '/opening_rightward'
end

local define_draaideur_fsm<const> = function()
	fsm_library.register('draaideur', {
		timelines = {
			[opening_leftward_timeline_id] = {
				def = {
					frames = timeline.range(draaideur_pose_steps * 4),
					playback_mode = 'once',
					tracks = {
						{
							kind = 'value',
							interpolation = 'step',
							apply = draaideur.set_pose,
							keys = {
								{ frame = 0, value = pose.closed },
								{ frame = draaideur_pose_steps, value = pose.open_3 },
								{ frame = draaideur_pose_steps * 2, value = pose.open_2 },
								{ frame = draaideur_pose_steps * 3, value = pose.open_1 },
							},
						},
					},
				},
				autoplay = false,
			},
			[opening_rightward_timeline_id] = {
				def = {
					frames = timeline.range(draaideur_pose_steps * 4),
					playback_mode = 'once',
					tracks = {
						{
							kind = 'value',
							interpolation = 'step',
							apply = draaideur.set_pose,
							keys = {
								{ frame = 0, value = pose.closed },
								{ frame = draaideur_pose_steps, value = pose.open_1 },
								{ frame = draaideur_pose_steps * 2, value = pose.open_2 },
								{ frame = draaideur_pose_steps * 3, value = pose.open_3 },
							},
						},
					},
				},
				autoplay = false,
			},
		},
		initial = 'active',
		states = {
			active = {
				data = { push_steps = 0 },
				entering_state = draaideur.enter_active,
				update = draaideur.update_active,
			},
			opening_leftward = {
				entering_state = draaideur.enter_opening,
				timelines = {
					[opening_leftward_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = false },
						on_finished = '/active',
					},
				},
			},
			opening_rightward = {
				entering_state = draaideur.enter_opening,
				timelines = {
					[opening_rightward_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = false },
						on_finished = '/active',
					},
				},
			},
		},
	})
end

local register_draaideur_definition<const> = function()
	prefab.define({
		def_id = 'draaideur',
		class = draaideur,
		base = sprite_object,
		components = { timeline_component.new, fsm_component.factory({ 'draaideur' }) },
		defaults = {
			kind = 1,
			collision_enabled = true,
		},
	})
end

return {
	draaideur = draaideur,
	define_draaideur_fsm = define_draaideur_fsm,
	register_draaideur_definition = register_draaideur_definition,
}
