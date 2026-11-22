local object_2d<const> = require('cartlib/world/object_2d')
local clamp<const> = require('cartlib/util/clamp')
local rol8<const> = require('cartlib/util/rol8')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local stage_tiles_component<const> = require('stage_tiles_component')
local tile_art<const> = require('tile_art')
local world<const> = require('cartlib/world/world')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
local stage_tape<const> = require('stage_tape')
local stage_actor_cues<const> = require('stage_actor_cues')
local grachtwater<const> = require('grachtwater')
local havenanimatie<const> = require('havenanimatie')

local stage<const> = {}
stage.__index = stage
setmetatable(stage, { __index = object_2d })

local resume_scrolling_event<const> = 'stage.resume_scrolling'

local stage_scroll_follower_view

function stage:apply_stage_config(stage_data)
	self.tile_size = stage_data.tile_size
	self.tile_columns = stage_data.tile_columns
	self.music_cues = stage_data.music_cues
	self.restart_points = stage_data.restart_points
	self.scroll_stop_columns = stage_data.scroll_stop_columns
	self.scroll_stop_count = #stage_data.scroll_stop_columns
end

function stage:advance_music_cues(column)
	local music_cues<const> = self.music_cues
	local cue_index = self.music_cue_index
	local cue = music_cues[cue_index]
	while cue ~= nil and cue.column <= column do
		print('nemesis_s.music.cue', os.clock(), cue.event, cue.column)
		self.events:emit(cue.event)
		cue_index = cue_index + 1
		cue = music_cues[cue_index]
	end
	self.music_cue_index = cue_index
end

function stage:build_background(background, tape)
	local tiles<const> = self.background_tiles
	tiles:configure(tape.width,tape.background_rows,self.tile_size,self.tile_art)
	stage_tape.bind_rows(tape,tape.background,tape.background_rows,tiles)
	self.star_spans = background.star_spans
	self.night_sky_height = background.night_sky_height
end

function stage:build_tape()
	print('nemesis_s.stage.build.begin', os.clock())
	local stage_data<const> = bin.decode(assets.data_nemesis_s_stage_runtime_addr, stage_asset_id)
	print('nemesis_s.stage.data.decoded', os.clock())
	local tape<const> = stage_tape.open(assets.bin_nemesis_s_stage_tape_addr)
	self:apply_stage_config(stage_data)
	self.tile_art = tile_art.new(stage_data.tile_banks)
	self.tile_rows = tape.height
	self.tape_length_tiles = tape.width
	self:build_background(stage_data.background,tape)
	local stage_tiles<const> = self.stage_tiles
	stage_tiles:configure(tape.width,tape.height,self.tile_size,self.tile_art)
	stage_tape.bind_rows(tape,tape.foreground,tape.height,stage_tiles)
	self.solid_tape = stage_tape.collision_rows(tape)
	self.harbor=havenanimatie.new(tape,stage_tiles,self.solid_tape)
	self.water=grachtwater.new(stage_data.water_animation,tape,stage_tiles)

	self.actor_cues = tape.actors
	self.actor_cue_count = tape.actor_count
	print('nemesis_s.stage.build.end', os.clock(), self.actor_cue_count)
end

function stage:reset_runtime()
	if self.starfield then self.starfield.mill_arena=false end
	if self.stage_tiles.tile_count == 0 then
		self:build_tape()
	end
	local start_column<const> = self.start_column
	self.left_tile = start_column + 1
	self.stage_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	self.background_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	if self.water then self.water:reset(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:reset(self.left_tile-1) end
	self.tape_head = self.left_tile + self.tile_columns - 1
	local current_column<const> = self.tape_head - 1
	local music_cues<const> = self.music_cues
	local current_music_cue_index = 1
	for cue_index = 2, #music_cues do
		if music_cues[cue_index].column > current_column then
			break
		end
		current_music_cue_index = cue_index
	end
	self.start_music_cue = music_cues[current_music_cue_index]
	self.music_cue_index = current_music_cue_index + 1
	local scroll_stop_index = 1
	local scroll_stop_columns<const> = self.scroll_stop_columns
	while scroll_stop_index <= self.scroll_stop_count
	and scroll_stop_columns[scroll_stop_index] <= current_column do
		scroll_stop_index = scroll_stop_index + 1
	end
	self.scroll_stop_index = scroll_stop_index
	stage_actor_cues.seek(self, current_column)
	self.tile_steps = start_column
	self.total_scroll_px = start_column * self.tile_size
	self.scroll_gate = 0x01
	self.scrolling = true

end

function stage:begin_play()
	local cue<const> = self.start_music_cue
	local event
	if self.restarting then
		event = cue.restart_event
	else
		event = cue.event
	end
	print('nemesis_s.music.cue', os.clock(), event, cue.column)
	self.events:emit(event)
	self:update_runtime()
	return '/running/scrolling'
end

function stage:restart_column()
	local tape_head<const> = self.tape_head - 1
	local restart_points<const> = self.restart_points
	local start_column = restart_points[1].start_column
	for point_index = 2, #restart_points do
		local point<const> = restart_points[point_index]
		if tape_head < point.trigger_column then
			break
		end
		start_column = point.start_column
	end
	return start_column
end

function stage:advance_tape()
	local max_left_tile<const> = self.tape_length_tiles - self.tile_columns + 1
	if self.left_tile >= max_left_tile then
		self.scrolling = false
		return
	end

	self.left_tile = self.left_tile + 1
	self.stage_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	self.background_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	if self.water then self.water:show(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:show(self.left_tile-1) end
	self.tape_head = self.left_tile + self.tile_columns - 1
	local column<const> = self.tape_head - 1
	self:advance_music_cues(column)
	local followers<const> = stage_scroll_follower_view.components
	for follower_index = 1, #followers do
		local follower<const> = followers[follower_index]
		local owner<const> = follower.owner
		local x<const>, y<const> = owner:get_global_position()
		owner:set_global_position(x - self.tile_size, y)
	end
	stage_actor_cues.advance(self, column)
	self.tile_steps = self.tile_steps + 1
	self.total_scroll_px = self.tile_steps * self.tile_size

	if telemetry_enabled then
		self.events:emit('stage_scroll_tile', {
			left = self.left_tile,
			head = self.tape_head,
		})
	end

	local scroll_stop_index<const> = self.scroll_stop_index
	if scroll_stop_index <= self.scroll_stop_count
	and column >= self.scroll_stop_columns[scroll_stop_index] then
		self.scroll_stop_index = scroll_stop_index + 1
		self.scrolling = false
	elseif self.left_tile >= max_left_tile then
		self.scrolling = false
	end
	if not self.scrolling and telemetry_enabled then
		self.events:emit('stage_scroll_stop', {
			left = self.left_tile,
			head = self.tape_head,
		})
	end
end

function stage:update_scenery()
    if self.water then self.water:tick(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:tick() end
end

function stage:update_runtime()
    self:update_scenery()
	if not self.scrolling then
		return '/running/stopped'
	end

	local scroll_gate<const> = rol8(self.scroll_gate)
	self.scroll_gate = scroll_gate
	if (scroll_gate & 1) ~= 0 then
		self:advance_tape()
	end

	if not self.scrolling then
		return '/running/stopped'
	end

	self.starfield:scroll()
end

-- A destructible target can be cleared before its camera stop enters the screen.
function stage:release_scroll_stop(column)
	local index<const> = self.scroll_stop_index
	if self.scroll_stop_columns[index] == column then
		self.scroll_stop_index = index+1
	elseif not self.scrolling and self.scroll_stop_columns[index-1] == column then
		self:resume_scrolling()
	end
end

function stage:resume_scrolling()
	self.scrolling = true
	self.events:emit(resume_scrolling_event)
end

function stage:is_solid_pixel(screen_x, screen_y)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y = ((screen_y - pose_y) // self.tile_size) + 1

	map_x = clamp(map_x, 1, self.tape_length_tiles)
	map_y = clamp(map_y, 1, self.tile_rows)

	local bit<const> = map_x - 1
	return (self.solid_tape[map_y][(bit // 32) + 1] & (1 << (bit & 31))) ~= 0
end

-- Returns the zero-based offset of the first solid tile in a horizontal run,
-- or tile_count when the complete run is clear. Beam and sprite-width collision
-- paths consume the retained stage row directly instead of sampling pixels.
function stage:first_solid_tile_offset(screen_x, screen_y, tile_count)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x<const> = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y<const> = ((screen_y - pose_y) // self.tile_size) + 1
	if map_y < 1 or map_y > self.tile_rows then return tile_count end
	local row<const> = self.solid_tape[map_y]
	local last_offset = tile_count - 1
	local screen_last_offset<const> = self.tile_columns - (screen_x // self.tile_size) - 1
	if last_offset > screen_last_offset then
		last_offset = screen_last_offset
	end
	last_offset = math.min(last_offset, self.tape_length_tiles - map_x)
	for tile_offset = math.max(0, 1 - map_x), last_offset do
		local bit<const> = map_x + tile_offset - 1
		if (row[(bit // 32) + 1] & (1 << (bit & 31))) ~= 0 then
			return tile_offset
		end
	end
	return tile_count
end

-- Projectile probes retain their normal terrain stopping rule. A hit also
-- reaches the animated load that owns that cell, so its art and solid bits
-- are removed together instead of leaving an invisible obstruction.
local cargo_hit_feedback<const> = function(self,health,screen_x,screen_y)
    self.scene:spawn(health>0 and ids_small_explosion_def or ids_large_explosion_def,{
        position={x=screen_x-self.tile_size,y=screen_y-self.tile_size},stage=self,
    })
    self.events:emit(health>0 and 'enemy.structure.hit' or 'enemy.structure.destroyed')
end

function stage:receive_projectile_impact(projectile, screen_x, screen_y, tile_offset)
    if not self.harbor then return end
    local pose_x<const>,pose_y<const> = self:get_global_position()
    local hit_x<const> = screen_x+tile_offset*self.tile_size
    local map_x<const> = ((hit_x-pose_x+self.total_scroll_px)//self.tile_size)+1
    local map_y<const> = ((screen_y-pose_y)//self.tile_size)+1
    local health<const> = self.harbor:hit_tile(map_x,map_y,projectile)
    if health == nil then return end
    cargo_hit_feedback(self,health,hit_x,screen_y)
    return true
end

function stage:receive_projectile_blast(projectile,width,height)
    if not self.harbor then return end
    local pose_x<const>,pose_y<const> = self:get_global_position()
    local left<const> = projectile.x-pose_x+self.total_scroll_px
    local top<const> = projectile.y-pose_y
    for y=(top//self.tile_size)+1,((top+height-1)//self.tile_size)+1 do
        for x=(left//self.tile_size)+1,((left+width-1)//self.tile_size)+1 do
            local health<const> = self.harbor:hit_tile(x,y,projectile)
            if health ~= nil then
                cargo_hit_feedback(self,health,(x-1)*self.tile_size-self.total_scroll_px+pose_x,
                    (y-1)*self.tile_size+pose_y)
            end
        end
    end
end

-- Returns the zero-based offset of the first solid tile in a vertical run,
-- or the number of in-bounds tiles when the run reaches the playfield edge.
-- Stage-relative beams retain this result once because their map column stays
-- fixed while both the stage and beam consume the same tile scroll.
function stage:first_solid_vertical_tile_offset(screen_x, screen_y, tile_count, direction)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x<const> = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y<const> = ((screen_y - pose_y) // self.tile_size) + 1
	if map_x < 1 or map_x > self.tape_length_tiles then return tile_count end
	local last_offset = tile_count - 1
	local first_offset
	if direction < 0 then
		first_offset = math.max(0, map_y - self.tile_rows)
		if last_offset >= map_y then
			last_offset = map_y - 1
		end
	else
		first_offset = math.max(0, 1 - map_y)
		local bottom_offset<const> = self.tile_rows - map_y
		if last_offset > bottom_offset then
			last_offset = bottom_offset
		end
	end
	local solid_tape<const> = self.solid_tape
	local word<const> = ((map_x - 1) // 32) + 1
	local mask<const> = 1 << ((map_x - 1) & 31)
	for tile_offset = first_offset, last_offset do
		if (solid_tape[map_y + tile_offset * direction][word] & mask) ~= 0 then
			return tile_offset
		end
	end
	return math.max(0, last_offset + 1)
end

function stage:ctor()
	self.solid_tape = {}
	self.stage_tiles = self:get_component(stage_tiles_component, 'tile_layer')
	self.background_tiles = self:get_component(stage_tiles_component, 'background')
end

local define_stage_fsm<const> = function()
	fsm_library.register(ids_stage_fsm, {
		initial = 'boot',
		on = {
			[resume_scrolling_event] = '/running/scrolling',
		},
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/running'
				end,
			},
			running = {
				initial = 'begin_play',
				states = {
					begin_play = {
						update = stage.begin_play,
					},
					scrolling = {
						update = stage.update_runtime,
					},
					stopped = {update=stage.update_scenery},
				},
			},
		},
	})
end

local register_stage_definition<const> = function()
	stage_scroll_follower_view = world:active_component_view(stage_scroll_follower_component)
	prefab.define({
		def_id = ids_stage_def,
		class = stage,
		components = {
			function(owner)
				return stage_tiles_component.new(owner, { order = 14 }, 'background')
			end,
			stage_tiles_component.new,
			fsm_component.factory({ ids_stage_fsm }),
		},
		defaults = {
			order = 16,
			restarting = false,
		},
	})
end

return {
	define_stage_fsm = define_stage_fsm,
	register_stage_definition = register_stage_definition,
	stage_def_id = ids_stage_def,
	stage_instance_id = ids_stage_instance,
	stage_fsm_id = ids_stage_fsm,
}
