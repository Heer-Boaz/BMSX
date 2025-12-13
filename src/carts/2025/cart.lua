local director_def_id = 'p3.director'
local director_instance_id = 'p3.director.instance'
local director_fsm_id = 'p3.director.fsm'

local bg_id = 'p3.bg'
local combat_monster_id = 'p3.combat.monster'
local combat_maya_a_id = 'p3.combat.maya_a'
local combat_maya_b_id = 'p3.combat.maya_b'
local combat_all_out_id = 'p3.combat.all_out'
local text_main_id = 'p3.text.main'
local text_choice_id = 'p3.text.choice'
local text_prompt_id = 'p3.text.prompt'
local text_transition_id = 'p3.text.transition'
local text_results_id = 'p3.text.results'

local overgang_timeline_id = 'overgang'
local overgang_in_frames = 24
local overgang_hold_frames = 48
local overgang_out_frames = 24
local overgang_frame_count = overgang_in_frames + overgang_hold_frames + overgang_out_frames
local overgang_ticks_per_frame = 32
local overgang_fade_out_frames = 18
local overgang_fade_in_frames = 18
local overgang_post_fade_in_timeline_id = 'overgang_post_fade_in'

local combat_fade_timeline_id = 'combat_fade'
local combat_fade_out_frames = 10
local combat_fade_hold_frames = 4
local combat_fade_in_frames = 10
local combat_fade_frame_count = combat_fade_out_frames + combat_fade_hold_frames + combat_fade_in_frames
local combat_fade_ticks_per_frame = 32

local fade_timeline_id = 'fade'
local fade_out_frames = 18
local fade_hold_frames = 12
local fade_in_frames = 18
local fade_frame_count = fade_out_frames + fade_hold_frames + fade_in_frames
local fade_ticks_per_frame = 32

local combat_hit_timeline_id = 'combat_hit'
local combat_hit_frame_count = 16
local combat_hit_ticks_per_frame = 24

local combat_dodge_timeline_id = 'combat_dodge'
local combat_dodge_frame_count = 20
local combat_dodge_ticks_per_frame = 24

local combat_all_out_timeline_id = 'combat_all_out'
local combat_all_out_frame_count = 64
local combat_all_out_ticks_per_frame = 32

local combat_results_fade_out_timeline_id = 'combat_results_fade_out'
local combat_results_fade_out_frames = 18
local combat_results_fade_out_ticks_per_frame = 32

local combat_exit_fade_in_timeline_id = 'combat_exit_fade_in'
local combat_exit_fade_in_frames = 18
local combat_exit_fade_in_ticks_per_frame = 32

local combat_results_fade_in_timeline_id = 'combat_results_fade_in'
local combat_results_fade_in_frames = 18
local combat_results_fade_in_ticks_per_frame = 32

local combat_monster_hover_period_seconds = 1.8
local combat_monster_hover_amp = 6
local combat_monster_dodge_distance = 24

local story = {
	title = {
		kind = 'bg_only',
		bg = 'titel',
		music = 'm02',
		typed = false,
		pages = nil,
		next = 'bla',
	},
	bla = {
		kind = 'fade',
		next = 'overgang_monday',
	},
	overgang_monday = {
		kind = 'transition',
		label = 'MONDAY',
		music = 'm05',
		next = 'bed_intro',
	},
	bed_intro = {
		kind = 'dialogue',
		bg = 'slaap_n',
		music = 'm02',
		typed = true,
		pages = {
			{ 'Je ligt in bed en probeert te slapen.', 'Maar je hoort iets vreemds beneden...' },
			{ 'Je hart klopt sneller.', 'Het klinkt alsof iemand in de keuken rommelt.' },
		},
		next = 'bed_choice',
	},
	bed_choice = {
		kind = 'choice',
		bg = 'slaap_n',
		prompt = { 'Wat doe je?' },
		options = {
			{
				label = 'Ga naar beneden.',
				effects = { { stat = 'opdekin', add = 1 } },
				result_pages = {
					{ 'Je staat op. Geen weg terug.', 'Opdekin +1' },
				},
				next = 'overgang_downstairs',
			},
			{
				label = 'Blijf liggen.',
				effects = { { stat = 'planning', add = 1 } },
				result_pages = {
					{ 'Je trekt de deken over je hoofd.', 'Maar de geluiden stoppen niet.', 'Planning +1' },
				},
				next = 'overgang_downstairs',
			},
		},
	},
	overgang_downstairs = {
		kind = 'transition',
		label = 'LATER',
		next = 'downstairs_scene',
	},
	downstairs_scene = {
		kind = 'dialogue',
		bg = 'huiswerk',
		typed = true,
		pages = {
			{ 'Beneden is het stil.', 'Te stil.', 'Alsof het huis zijn adem inhoudt.' },
			{ 'Op tafel ligt je huiswerk.', 'Maar de bladzijden zijn... zwart.' },
		},
		next = 'downstairs_choice',
	},
	downstairs_choice = {
		kind = 'choice',
		bg = 'huiswerk',
		prompt = { 'Je telefoon trilt. Wat doe je?' },
		options = {
			{
				label = 'Neem op.',
				effects = { { stat = 'makeup', add = 1 } },
				result_pages = {
					{ 'Een stem fluistert: "Pas op voor de schaduw."', 'Make-up +1' },
				},
				next = 'combat_intro',
			},
			{
				label = 'Negeer het.',
				effects = { { stat = 'rust', add = 1 } },
				result_pages = {
					{ 'Je drukt weg. Je moet focussen.', 'Rust +1' },
				},
				next = 'combat_intro',
			},
		},
	},
	combat_intro = {
		kind = 'combat',
		bg = 'klas1',
		music = 'm16',
		monster_imgid = 'monster_snoozer',
		rounds = {
			{
				prompt = { 'Een schaduw blokkeert de weg.', 'Wat zeg je?' },
				options = {
					{ label = '\"Ik ben niet bang.\"', outcome = 'hit', points = 1 },
					{ label = '\"Ehm... sorry?\"', outcome = 'dodge', points = 0 },
					{ label = '\"Rustig blijven.\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'Het monster sist.', 'Hoe reageer je?' },
				options = {
					{ label = '\"Ik laat me niet afleiden.\"', outcome = 'hit', points = 1 },
					{ label = '\"Misschien gaat het weg...\"', outcome = 'dodge', points = 0 },
					{ label = '\"Ik zet door.\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'Het wankelt.', 'Wat is je laatste zet?' },
				options = {
					{ label = '\"Dit is mijn keuze.\"', outcome = 'hit', points = 1 },
					{ label = '\"Ik kijk weg.\"', outcome = 'dodge', points = 0 },
					{ label = '\"Niet vandaag.\"', outcome = 'hit', points = 1 },
				},
			},
		},
		rewards = {
			{
				min = 0,
				max = 1,
				effects = { { stat = 'rust', add = 1 } },
			},
			{
				min = 2,
				max = 2,
				effects = { { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 } },
			},
			{
				min = 3,
				max = 99,
				effects = {
					{ stat = 'planning', add = 1 },
					{ stat = 'opdekin', add = 1 },
					{ stat = 'rust', add = 1 },
					{ stat = 'makeup', add = 1 },
				},
			},
		},
		next = 'after_combat',
	},
	after_combat = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		music = 'm17',
		typed = true,
		pages = {
			{ 'De schaduw verdwijnt alsof hij nooit bestond.', 'Je knippert. Het is weer ochtend.' },
			{ 'Je voelt je veranderd.', 'Dit was nog maar het begin.' },
		},
		next = 'ending',
	},
	ending = {
		kind = 'ending',
		bg = 'ochtendpijn',
		music = 'm17',
		typed = true,
	},
	__inline_dialogue = {
		kind = 'dialogue_inline',
		typed = true,
	},
}

local current_music = nil
local function playmusic(musicid)
	if musicid == current_music then
		return
	end
	if musicid ~= nil then
		$.playaudio(musicid)
	else
		$.stopmusic()
	end
	current_music = musicid
end

local function stat_label(stat_id)
	if stat_id == 'planning' then
		return 'Planning'
	end
	if stat_id == 'opdekin' then
		return 'Opdekin'
	end
	if stat_id == 'rust' then
		return 'Rust'
	end
	if stat_id == 'makeup' then
		return 'Make-up'
	end
end

local function smoothstep(u)
	return u * u * (3 - 2 * u)
end

local function pingpong01(u)
	local f = u - math.floor(u)
	local p = f * 2
	if p <= 1 then
		return p
	end
	return 2 - p
end

local function arc01(u)
	if u <= 0.5 then
		return smoothstep(u * 2)
	end
	return smoothstep((1 - u) * 2)
end

local function set_text_lines(text_object_id, lines, typed)
	local text_obj = world_object(text_object_id)
	if type(lines) == 'table' then
		text_obj.set_text(array(lines))
	else
		text_obj.set_text(lines)
	end
	if typed then
		return
	end
	text_obj.displayed_lines = text_obj.full_text_lines
	text_obj.text = text_obj.full_text_lines
	text_obj.is_typing = false
end

local function clear_text(text_object_id)
	set_text_lines(text_object_id, {}, false)
	local text_obj = world_object(text_object_id)
	text_obj.highlighted_line_index = nil
end

local function finish_text(text_object_id)
	local text_obj = world_object(text_object_id)
	text_obj.displayed_lines = text_obj.full_text_lines
	text_obj.text = text_obj.full_text_lines
	text_obj.is_typing = false
end

local director = {}
director.__index = director

function director:apply_background(id)
	if id == nil then
		return
	end
	local bg = world_object(bg_id)
	bg.imgid = id
end

function director:set_prompt_line(text)
	set_text_lines(text_prompt_id, { text }, false)
end

function director:reset_text_colors()
	world_object(text_main_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	world_object(text_choice_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	world_object(text_prompt_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	world_object(text_transition_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
	world_object(text_results_id).text_color = { r = 1, g = 1, b = 1, a = 1 }
end

function director:apply_effects(effects)
	for i = 1, #effects do
		local effect = effects[i]
		self.stats[effect.stat] = self.stats[effect.stat] + effect.add
	end
end

function director:hide_combat_sprites()
	world_object(combat_monster_id).visible = false
	world_object(combat_maya_a_id).visible = false
	world_object(combat_maya_b_id).visible = false
	world_object(combat_all_out_id).visible = false
end

function director:apply_combat_round(node)
	local round = node.rounds[self.combat_round_index]
	set_text_lines(text_main_id, round.prompt, true)
	local choice_lines = {}
	for i = 1, #round.options do
		choice_lines[i] = round.options[i].label
	end
	set_text_lines(text_choice_id, choice_lines, false)
	self.choice_index = 1
end

function director:update_combat_hover()
	self.combat_hover_time = self.combat_hover_time + game.deltatime_seconds
	local monster = world_object(combat_monster_id)
	local u = (self.combat_hover_time / combat_monster_hover_period_seconds) + 0.25
	local wave = smoothstep(pingpong01(u))
	local offset = (wave - 0.5) * 2 * combat_monster_hover_amp
	monster.y = self.combat_monster_base_y + offset
end

function director:resolve_combat_rewards(node)
	for i = 1, #node.rewards do
		local reward = node.rewards[i]
		if self.combat_points >= reward.min and self.combat_points <= reward.max then
			return reward.effects
		end
	end
end

function director:show_dialogue_page(typed)
	local page = self.pages[self.page_index]
	set_text_lines(text_main_id, page, typed)
	clear_text(text_choice_id)
end

function director:update_dialogue_prompt()
	local main = world_object(text_main_id)
	if main.is_typing then
		-- self:set_prompt_line('[A] skip')
		return
	end
	if self.page_index < #self.pages then
		self:set_prompt_line('(A) Next')
		return
	end
	self:set_prompt_line('(A) Continue')
end

function director:setup_choice_menu(node)
	set_text_lines(text_main_id, node.prompt, true)
	local choice_lines = {}
	for i = 1, #node.options do
		choice_lines[i] = node.options[i].label
	end
	set_text_lines(text_choice_id, choice_lines, false)
	self.choice_index = 1
end

local function build_director_fsm()
	define_fsm(director_fsm_id, {
		initial = 'boot',
		states = {
				boot = {
					entering_state = function(self)
						self.node_id = 'title'
						self.stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 }
						self.inline_pages = {}
						self.inline_next = ''
						self.skip_combat_fade_in = false
						self.skip_transition_fade = false
						self.fade_hold_black = false
						clear_text(text_main_id)
						clear_text(text_choice_id)
						clear_text(text_prompt_id)
						clear_text(text_transition_id)
						clear_text(text_results_id)
						self:hide_combat_sprites()
						return '/run_node'
					end,
				},
				run_node = {
					entering_state = function(self)
						local node = story[self.node_id]
						if node.kind == 'transition' then
							return '/transition'
						end
						if node.kind == 'dialogue' or node.kind == 'dialogue_inline' then
							return '/dialogue'
						end
						if node.kind == 'ending' then
							return '/ending'
						end
						if node.kind == 'bg_only' then
							return '/bg_only'
						end
						if node.kind == 'choice' then
							return '/choice'
						end
						if node.kind == 'fade' then
							return '/fade'
						end
						if node.kind == 'combat' then
							if self.skip_combat_fade_in then
								self.skip_combat_fade_in = false
								return '/combat_init'
							end
							return '/combat_fade_in'
						end
					end,
				},
			transition = {
				timelines = {
					[overgang_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, overgang_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = overgang_timeline_id,
								frames = frames,
								ticks_per_frame = overgang_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					set_text_lines(text_transition_id, { node.label }, false)
					self:reset_text_colors()
					local transition_text = world_object(text_transition_id)
					self.transition_center_x = transition_text.centered_block_x
						self.transition_target_bg = story[node.next].bg
						transition_text.centered_block_x = display_width()
						local bg = world_object(bg_id)
						bg.visible = true
						local c = 1
						if self.skip_transition_fade then
							c = 0
						end
						bg.colorize = { r = c, g = c, b = c, a = 1 }
						if self.skip_transition_fade then
							self:apply_background(self.transition_target_bg)
						end
					end,
				on = {
					['timeline.frame.' .. overgang_timeline_id] = {
						go = function(self, _state, event)
								local frame_index = event.frame_index
								local bg = world_object(bg_id)
								if self.skip_transition_fade then
									bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
								else
									if frame_index == (overgang_fade_out_frames - 1) then
										self:apply_background(self.transition_target_bg)
									end
								local fade_in_start = overgang_frame_count - overgang_fade_in_frames
								local c = 1
								if frame_index < overgang_fade_out_frames then
									local u = frame_index / (overgang_fade_out_frames - 1)
									c = 1 - u
								elseif frame_index < fade_in_start then
									c = 0
								else
									local u = (frame_index - fade_in_start) / (overgang_fade_in_frames - 1)
									c = u
								end
								bg.colorize = { r = c, g = c, b = c, a = 1 }
							end
							local center_x = self.transition_center_x
							local start_x = display_width()
							local end_x = -display_width()
							local x = start_x
							if frame_index < overgang_in_frames then
								local u = frame_index / (overgang_in_frames - 1)
								x = start_x + (center_x - start_x) * u
							elseif frame_index < (overgang_in_frames + overgang_hold_frames) then
								x = center_x
							else
								local out_index = frame_index - (overgang_in_frames + overgang_hold_frames)
								local u = out_index / (overgang_out_frames - 1)
								x = center_x + (end_x - center_x) * u
							end
							local transition_text = world_object(text_transition_id)
							transition_text.centered_block_x = x
						end,
					},
						['timeline.end.' .. overgang_timeline_id] = {
							go = function(self)
								local node = story[self.node_id]
								local came_from_fade = self.skip_transition_fade
								self.node_id = node.next
								self.skip_transition_fade = false
								if story[self.node_id].kind == 'combat' then
									self.skip_combat_fade_in = true
								end
								clear_text(text_transition_id)
								if came_from_fade then
									return '/transition_fade_in'
								end
								return '/run_node'
							end,
						},
					},
				leaving_state = function(self)
					local bg = world_object(bg_id)
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
					clear_text(text_transition_id)
				end,
			},
				transition_fade_in = {
					timelines = {
						[overgang_post_fade_in_timeline_id] = {
							create = function()
								local frames = {}
								for i = 0, overgang_fade_in_frames - 1 do
									frames[#frames + 1] = i
								end
								return new_timeline({
									id = overgang_post_fade_in_timeline_id,
									frames = frames,
									ticks_per_frame = overgang_ticks_per_frame,
									playback_mode = 'once',
								})
							end,
							autoplay = true,
							stop_on_exit = true,
							play_options = { rewind = true, snap_to_start = true },
						},
					},
					entering_state = function(self)
						clear_text(text_transition_id)
						local bg = world_object(bg_id)
						bg.visible = true
						bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
					end,
					on = {
						['timeline.frame.' .. overgang_post_fade_in_timeline_id] = {
							go = function(self, _state, event)
								local u = event.frame_index / (overgang_fade_in_frames - 1)
								local c = smoothstep(u)
								local bg = world_object(bg_id)
								bg.colorize = { r = c, g = c, b = c, a = 1 }
							end,
						},
						['timeline.end.' .. overgang_post_fade_in_timeline_id] = {
							go = function(self)
								local bg = world_object(bg_id)
								bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
								return '/run_node'
							end,
						},
					},
					leaving_state = function(self)
						local bg = world_object(bg_id)
						bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
					end,
				},
				bg_only = {
					entering_state = function(self)
						local node = story[self.node_id]
						playmusic(node.music)
						self:apply_background(node.bg)
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					self:reset_text_colors()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							local node = story[self.node_id]
							self.node_id = node.next
							return '/run_node'
						end,
						},
					},
				},
				fade = {
					timelines = {
						[fade_timeline_id] = {
							create = function()
								local frames = {}
								for i = 0, fade_frame_count - 1 do
									frames[#frames + 1] = i
								end
								return new_timeline({
									id = fade_timeline_id,
									frames = frames,
									ticks_per_frame = fade_ticks_per_frame,
									playback_mode = 'once',
								})
							end,
							autoplay = true,
							stop_on_exit = true,
							play_options = { rewind = true, snap_to_start = true },
						},
					},
					entering_state = function(self)
						local node = story[self.node_id]
						playmusic(node.music)
						clear_text(text_main_id)
						clear_text(text_choice_id)
						clear_text(text_prompt_id)
						clear_text(text_transition_id)
						clear_text(text_results_id)
						self:reset_text_colors()
						local next_node = story[node.next]
						self.fade_hold_black = false
						if next_node.kind == 'transition' then
							self.fade_hold_black = true
							self.fade_target_bg = story[next_node.next].bg
						else
							self.fade_target_bg = next_node.bg
						end
						local bg = world_object(bg_id)
						bg.visible = true
						bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
					end,
					on = {
						['timeline.frame.' .. fade_timeline_id] = {
							go = function(self, _state, event)
								local frame_index = event.frame_index
								if frame_index == (fade_out_frames - 1) then
									self:apply_background(self.fade_target_bg)
								end
								local c = 1
								if frame_index < fade_out_frames then
									local u = frame_index / (fade_out_frames - 1)
									c = 1 - smoothstep(u)
								else
									if self.fade_hold_black then
										c = 0
									else
										local fade_in_start = fade_out_frames + fade_hold_frames
										if frame_index < fade_in_start then
											c = 0
										else
											local u = (frame_index - fade_in_start) / (fade_in_frames - 1)
											c = smoothstep(u)
										end
									end
								end
								local bg = world_object(bg_id)
								bg.colorize = { r = c, g = c, b = c, a = 1 }
							end,
						},
						['timeline.end.' .. fade_timeline_id] = {
							go = function(self)
								local node = story[self.node_id]
								self.node_id = node.next
								local next_kind = story[self.node_id].kind
								if next_kind == 'combat' then
									self.skip_combat_fade_in = true
								end
								if next_kind == 'transition' then
									self.skip_transition_fade = true
								end
								return '/run_node'
							end,
						},
					},
					leaving_state = function(self)
						local bg = world_object(bg_id)
						local c = 1
						if self.fade_hold_black then
							c = 0
						end
						bg.colorize = { r = c, g = c, b = c, a = 1 }
						self.fade_hold_black = false
					end,
				},
				combat_fade_in = {
					timelines = {
						[combat_fade_timeline_id] = {
							create = function()
							local frames = {}
							for i = 0, combat_fade_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_fade_timeline_id,
								frames = frames,
								ticks_per_frame = combat_fade_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					self.combat_fade_target_bg = node.bg
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
				end,
					on = {
						['timeline.frame.' .. combat_fade_timeline_id] = {
							go = function(self, _state, event)
								local frame_index = event.frame_index
								if frame_index == (combat_fade_out_frames - 1) then
									self:apply_background(self.combat_fade_target_bg)
								end
								local c = 1
								if frame_index < combat_fade_out_frames then
									local u = frame_index / (combat_fade_out_frames - 1)
									c = 1 - smoothstep(u)
								else
									c = 0
								end
								local bg = world_object(bg_id)
								bg.colorize = { r = c, g = c, b = c, a = 1 }
							end,
					},
					['timeline.end.' .. combat_fade_timeline_id] = {
						go = function(self)
							return '/combat_init'
						end,
					},
					},
					leaving_state = function(self)
						local bg = world_object(bg_id)
						bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
					end,
				},
			combat_fade_out = {
				timelines = {
					[combat_fade_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_fade_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_fade_timeline_id,
								frames = frames,
								ticks_per_frame = combat_fade_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					self.combat_fade_target_bg = node.bg
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
				end,
				on = {
					['timeline.frame.' .. combat_fade_timeline_id] = {
						go = function(self, _state, event)
							local frame_index = event.frame_index
							if frame_index == (combat_fade_out_frames - 1) then
								self:apply_background(self.combat_fade_target_bg)
							end
							local fade_in_start = combat_fade_out_frames + combat_fade_hold_frames
							local c = 1
							if frame_index < combat_fade_out_frames then
								local u = frame_index / (combat_fade_out_frames - 1)
								c = 1 - u
							elseif frame_index < fade_in_start then
								c = 0
							else
								local u = (frame_index - fade_in_start) / (combat_fade_in_frames - 1)
								c = u
							end
							local bg = world_object(bg_id)
							bg.colorize = { r = c, g = c, b = c, a = 1 }
						end,
					},
					['timeline.end.' .. combat_fade_timeline_id] = {
						go = function(self)
							return '/run_node'
						end,
					},
				},
				leaving_state = function(self)
					local bg = world_object(bg_id)
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
				end,
			},
				combat_init = {
					entering_state = function(self)
						local node = story[self.node_id]
						playmusic(node.music)
						self:apply_background(node.bg)
						local bg = world_object(bg_id)
						bg.visible = true
						bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
						clear_text(text_transition_id)
						clear_text(text_results_id)
						self:reset_text_colors()

						self.combat_round_index = 1
						self.combat_points = 0
						self.combat_max_points = #node.rounds
					self.combat_hover_time = 0

					local monster = world_object(combat_monster_id)
					monster.imgid = node.monster_imgid
					monster.visible = true
					monster.colorize = { r = 1, g = 1, b = 1, a = 1 }
					monster.x = (display_width() * 0.65) - (monster.sx / 2)
					monster.y = (display_height() * 0.25) - (monster.sy / 2)
					monster.z = 200

					self.combat_monster_base_x = monster.x
					self.combat_monster_base_y = monster.y

					local maya_a = world_object(combat_maya_a_id)
					maya_a.imgid = 'maya_a'
					maya_a.visible = true
					maya_a.x = 0
					maya_a.y = display_height() - maya_a.sy
					maya_a.z = 300

					local all_out = world_object(combat_all_out_id)
					all_out.imgid = 'all_out'
					all_out.visible = false
					all_out.x = 0
					all_out.y = 0
					all_out.z = 800

					local maya_b = world_object(combat_maya_b_id)
					maya_b.imgid = 'maya_b'
					maya_b.visible = false
					maya_b.x = display_width() - maya_b.sx
					maya_b.y = display_height() - maya_b.sy
					maya_b.z = 300

					return '/combat_round'
				end,
			},
				combat_round = {
					entering_state = function(self)
						local node = story[self.node_id]
						playmusic(node.music)
						self:apply_background(node.bg)
						local bg = world_object(bg_id)
						bg.visible = true
						bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
						clear_text(text_transition_id)
						clear_text(text_results_id)
						local monster = world_object(combat_monster_id)
						monster.imgid = node.monster_imgid
					monster.visible = true
					local maya_a = world_object(combat_maya_a_id)
					maya_a.imgid = 'maya_a'
					maya_a.visible = true
					world_object(combat_all_out_id).visible = false
					world_object(combat_maya_b_id).visible = false
					self:apply_combat_round(node)
				end,
				tick = function(self)
					self:update_combat_hover()
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
						return
					end
					self:set_prompt_line('[A] select')
					local choice_text = world_object(text_choice_id)
					choice_text.highlighted_line_index = self.choice_index - 1
				end,
				input_eval = 'first',
				input_event_handlers = {
					['up[jp]'] = {
						go = function(self)
							self.choice_index = math.max(1, self.choice_index - 1)
						end,
					},
					['down[jp]'] = {
						go = function(self)
							local node = story[self.node_id]
							local round = node.rounds[self.combat_round_index]
							self.choice_index = math.min(#round.options, self.choice_index + 1)
						end,
					},
					['a[jp]'] = {
						go = function(self)
							local main = world_object(text_main_id)
							if main.is_typing then
								finish_text(text_main_id)
								return
							end
							local node = story[self.node_id]
							local round = node.rounds[self.combat_round_index]
							local option = round.options[self.choice_index]
							self.combat_points = self.combat_points + option.points
							self.combat_round_index = self.combat_round_index + 1
							if option.outcome == 'hit' then
								return '/combat_hit'
							end
							return '/combat_dodge'
						end,
					},
				},
			},
			combat_hit = {
				timelines = {
					[combat_hit_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_hit_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_hit_timeline_id,
								frames = frames,
								ticks_per_frame = combat_hit_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					set_text_lines(text_main_id, { 'RAAK!' }, false)
				end,
				tick = function(self)
					self:update_combat_hover()
				end,
				on = {
					['timeline.frame.' .. combat_hit_timeline_id] = {
						go = function(self, _state, event)
							local frame_index = event.frame_index
							local monster = world_object(combat_monster_id)
							local hold_in = 3
							local hold_out = 3
							local flash_end = combat_hit_frame_count - hold_out
							if frame_index < hold_in or frame_index >= flash_end then
								monster.colorize = { r = 1, g = 1, b = 1, a = 1 }
								return
							end
							local flash_index = frame_index - hold_in
							if (flash_index % 2) == 0 then
								monster.colorize = { r = 1, g = 1, b = 1, a = 1 }
							else
								monster.colorize = { r = 1, g = 0.2, b = 0.2, a = 1 }
							end
						end,
					},
					['timeline.end.' .. combat_hit_timeline_id] = {
						go = function(self)
							local monster = world_object(combat_monster_id)
							monster.colorize = { r = 1, g = 1, b = 1, a = 1 }
							local node = story[self.node_id]
							if self.combat_round_index > #node.rounds then
								return '/combat_all_out_prompt'
							end
							return '/combat_round'
						end,
					},
				},
			},
			combat_dodge = {
				timelines = {
					[combat_dodge_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_dodge_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_dodge_timeline_id,
								frames = frames,
								ticks_per_frame = combat_dodge_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					set_text_lines(text_main_id, { 'ONTWIJKT!' }, false)
					self.combat_dodge_dir = -self.combat_dodge_dir
				end,
				tick = function(self)
					self:update_combat_hover()
				end,
				on = {
					['timeline.frame.' .. combat_dodge_timeline_id] = {
						go = function(self, _state, event)
							local monster = world_object(combat_monster_id)
							local frame_index = event.frame_index
							local hold_in = 4
							local hold_out = 4
							local move_frames = combat_dodge_frame_count - hold_in - hold_out
							local offset = 0
							if frame_index >= hold_in and frame_index < (hold_in + move_frames) then
								local u = (frame_index - hold_in) / (move_frames - 1)
								offset = arc01(u) * combat_monster_dodge_distance * self.combat_dodge_dir
							end
							monster.x = self.combat_monster_base_x + offset
						end,
					},
					['timeline.end.' .. combat_dodge_timeline_id] = {
						go = function(self)
							local monster = world_object(combat_monster_id)
							monster.x = self.combat_monster_base_x
							local node = story[self.node_id]
							if self.combat_round_index > #node.rounds then
								return '/combat_all_out_prompt'
							end
							return '/combat_round'
						end,
					},
				},
			},
			combat_all_out_prompt = {
				entering_state = function(self)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					set_text_lines(text_main_id, { 'Het monster lijkt rijp voor de sloop!' }, true)
					set_text_lines(text_choice_id, { 'ALL-OUT-ATTACK!!' }, false)
					self.choice_index = 1
				end,
				tick = function(self)
					self:update_combat_hover()
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
						return
					end
					self:set_prompt_line('[A] ATTACK')
					world_object(text_choice_id).highlighted_line_index = 0
				end,
				input_eval = 'first',
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							local main = world_object(text_main_id)
							if main.is_typing then
								finish_text(text_main_id)
								return
							end
							return '/combat_all_out'
						end,
					},
				},
			},
			combat_all_out = {
				timelines = {
					[combat_all_out_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_all_out_frame_count - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_all_out_timeline_id,
								frames = frames,
								ticks_per_frame = combat_all_out_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					self:hide_combat_sprites()
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					clear_text(text_results_id)
					local all_out = world_object(combat_all_out_id)
					all_out.visible = true
					all_out.x = 0
					all_out.y = 0
				end,
				on = {
					['timeline.end.' .. combat_all_out_timeline_id] = {
						go = function(self)
							return '/combat_results_setup'
						end,
					},
				},
				leaving_state = function(self)
					world_object(combat_all_out_id).visible = false
				end,
			},
			combat_results_setup = {
				entering_state = function(self)
					local node = story[self.node_id]
					local rewards = self:resolve_combat_rewards(node)
					playmusic('m17')
					self:apply_effects(rewards)

					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 0, g = 0, b = 0, a = 1 }

					local monster = world_object(combat_monster_id)
					monster.visible = false
					local maya_a = world_object(combat_maya_a_id)
					maya_a.visible = false
					local all_out = world_object(combat_all_out_id)
					all_out.visible = false

					local maya_b = world_object(combat_maya_b_id)
					maya_b.imgid = 'maya_b'
					maya_b.visible = true
					maya_b.x = display_width() - maya_b.sx
					maya_b.y = display_height() - maya_b.sy
					maya_b.z = 300
					maya_b.colorize = { r = 1, g = 1, b = 1, a = 0 }

					local lines = {}
					for i = 1, #rewards do
						local effect = rewards[i]
						lines[#lines + 1] = stat_label(effect.stat) .. ' +' .. effect.add
					end
					set_text_lines(text_results_id, lines, false)
					world_object(text_results_id).text_color = { r = 1, g = 1, b = 1, a = 0 }
					return '/combat_results_fade_in'
				end,
			},
			combat_results_fade_in = {
				timelines = {
					[combat_results_fade_in_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_results_fade_in_frames - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_results_fade_in_timeline_id,
								frames = frames,
								ticks_per_frame = combat_results_fade_in_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				on = {
					['timeline.frame.' .. combat_results_fade_in_timeline_id] = {
						go = function(self, _state, event)
							local u = event.frame_index / (combat_results_fade_in_frames - 1)
							local a = smoothstep(u)
							local maya_b = world_object(combat_maya_b_id)
							maya_b.colorize = { r = 1, g = 1, b = 1, a = a }
							local results = world_object(text_results_id)
							results.text_color = { r = 1, g = 1, b = 1, a = a }
						end,
					},
					['timeline.end.' .. combat_results_fade_in_timeline_id] = {
						go = function(self)
							return '/combat_results'
						end,
					},
				},
			},
			combat_results = {
				input_eval = 'first',
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							local node = story[self.node_id]
							self.node_id = node.next
							return '/combat_results_fade_out'
						end,
					},
				},
			},
			combat_results_fade_out = {
				timelines = {
					[combat_results_fade_out_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_results_fade_out_frames - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_results_fade_out_timeline_id,
								frames = frames,
								ticks_per_frame = combat_results_fade_out_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
				end,
				on = {
					['timeline.frame.' .. combat_results_fade_out_timeline_id] = {
						go = function(self, _state, event)
							local u = event.frame_index / (combat_results_fade_out_frames - 1)
							local a = 1 - smoothstep(u)
							local maya_b = world_object(combat_maya_b_id)
							maya_b.colorize = { r = 1, g = 1, b = 1, a = a }
							local results = world_object(text_results_id)
							results.text_color = { r = 1, g = 1, b = 1, a = a }
						end,
					},
					['timeline.end.' .. combat_results_fade_out_timeline_id] = {
						go = function(self)
							world_object(combat_maya_b_id).visible = false
							clear_text(text_results_id)
							self:hide_combat_sprites()
							local next_kind = story[self.node_id].kind
							if next_kind == 'transition' then
								self.skip_transition_fade = true
								return '/run_node'
							end
							if next_kind == 'fade' then
								self.combat_exit_target_bg = story[story[self.node_id].next].bg
							else
								self.combat_exit_target_bg = story[self.node_id].bg
							end
							return '/combat_exit_fade_in'
						end,
					},
				},
			},
			combat_exit_fade_in = {
				timelines = {
					[combat_exit_fade_in_timeline_id] = {
						create = function()
							local frames = {}
							for i = 0, combat_exit_fade_in_frames - 1 do
								frames[#frames + 1] = i
							end
							return new_timeline({
								id = combat_exit_fade_in_timeline_id,
								frames = frames,
								ticks_per_frame = combat_exit_fade_in_ticks_per_frame,
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					self:apply_background(self.combat_exit_target_bg)
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 0, g = 0, b = 0, a = 1 }
				end,
				on = {
					['timeline.frame.' .. combat_exit_fade_in_timeline_id] = {
						go = function(self, _state, event)
							local u = event.frame_index / (combat_exit_fade_in_frames - 1)
							local c = smoothstep(u)
							local bg = world_object(bg_id)
							bg.colorize = { r = c, g = c, b = c, a = 1 }
						end,
					},
					['timeline.end.' .. combat_exit_fade_in_timeline_id] = {
						go = function(self)
							local bg = world_object(bg_id)
							bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
							return '/run_node'
						end,
					},
				},
				leaving_state = function(self)
					local bg = world_object(bg_id)
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
				end,
			},
			dialogue = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
					world_object(bg_id).visible = true
					self:reset_text_colors()
					if node.kind == 'dialogue_inline' then
						self.pages = self.inline_pages
					else
						self.pages = node.pages
					end
					self.page_index = 1
					clear_text(text_transition_id)
					self:show_dialogue_page(node.typed)
					self:update_dialogue_prompt()
				end,
				tick = function(self)
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
					end
					self:update_dialogue_prompt()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							local main = world_object(text_main_id)
							if main.is_typing then
								finish_text(text_main_id)
								self:update_dialogue_prompt()
								return
							end
							if self.page_index < #self.pages then
								self.page_index = self.page_index + 1
								local node = story[self.node_id]
								self:show_dialogue_page(node.typed)
								self:update_dialogue_prompt()
								return
							end
							local node = story[self.node_id]
							if node.kind == 'dialogue_inline' then
								self.node_id = self.inline_next
								self.inline_pages = {}
								self.inline_next = ''
							else
								self.node_id = node.next
							end
							return '/run_node'
						end,
					},
				},
			},
			ending = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
					world_object(bg_id).visible = true
					self:reset_text_colors()
					clear_text(text_transition_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					local total = self.stats.planning + self.stats.opdekin + self.stats.rust + self.stats.makeup
					local title = ''
					local total_line = ''
					local line1 = ''
					local line2 = ''
					if total <= 1 then
						title = 'Ending C - Bijna, maar net niet'
						total_line = 'Totaal <= 1 (' .. total .. ')'
						line1 = 'Verslag wordt op het nippertje (of net te laat) ingeleverd.'
						line2 = 'Maya leert: zonder voorbereiding wint de mist.'
					elseif total <= 5 then
						title = 'Ending B - School op de rails'
						total_line = 'Totaal 2-5 (' .. total .. ')'
						line1 = 'Maya levert op tijd in en is redelijk rustig.'
						line2 = 'Make-up is \"goed genoeg\" en geen tijddief meer.'
					else
						title = 'Ending A - Klokmeester: Stijlvol en Stabiel'
						total_line = 'Totaal >= 6 (' .. total .. ')'
						line1 = 'Maya is op tijd, voorbereid, en straalt zonder stress.'
						line2 = 'School is leidend, en extras passen er naast.'
					end
					self.pages = {
						{ title, total_line },
						{ line1, line2 },
						{
							'Planning: ' .. self.stats.planning,
							'Opdekin: ' .. self.stats.opdekin,
							'Rust: ' .. self.stats.rust,
							'Make-up: ' .. self.stats.makeup,
						},
					}
					self.page_index = 1
					self:show_dialogue_page(node.typed)
				end,
				tick = function(self)
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
						return
					end
					if self.page_index < #self.pages then
						self:set_prompt_line('(A) next')
						return
					end
					self:set_prompt_line('EINDE')
				end,
				input_eval = 'first',
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							local main = world_object(text_main_id)
							if main.is_typing then
								finish_text(text_main_id)
								return
							end
							if self.page_index < #self.pages then
								self.page_index = self.page_index + 1
								local node = story[self.node_id]
								self:show_dialogue_page(node.typed)
								return
							end
						end,
					},
				},
			},
			choice = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
					world_object(bg_id).visible = true
					self:reset_text_colors()
					self:setup_choice_menu(node)
				end,
				tick = function(self)
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
					else
						self:set_prompt_line('[A] select')
					end
					local choice_text = world_object(text_choice_id)
					if main.is_typing then
						choice_text.highlighted_line_index = nil
					else
						choice_text.highlighted_line_index = self.choice_index - 1
					end
				end,
				input_eval = 'first',
				input_event_handlers = {
					['up[jp]'] = {
						go = function(self)
							self.choice_index = math.max(1, self.choice_index - 1)
						end,
					},
					['down[jp]'] = {
						go = function(self)
							local node = story[self.node_id]
							self.choice_index = math.min(#node.options, self.choice_index + 1)
						end,
					},
					['a[jp]'] = {
						go = function(self)
							local main = world_object(text_main_id)
							if main.is_typing then
								finish_text(text_main_id)
								return
							end
							local node = story[self.node_id]
							local option = node.options[self.choice_index]
							self:apply_effects(option.effects)
							self.inline_pages = option.result_pages
							self.inline_next = option.next
							self.node_id = '__inline_dialogue'
							return '/run_node'
						end,
					},
				},
			},
		},
	})
end

local function register_director()
	define_world_object({
		def_id = director_def_id,
		class = director,
		fsms = { director_fsm_id },
		defaults = {
			node_id = 'title',
			page_index = 1,
			choice_index = 1,
			stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 },
			inline_pages = {},
			inline_next = '',
			pages = {},
			transition_center_x = 0,
			transition_target_bg = story.title.bg,
			fade_target_bg = story.title.bg,
			combat_fade_target_bg = story.title.bg,
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			fade_hold_black = false,
			combat_exit_target_bg = story.title.bg,
			combat_round_index = 1,
			combat_points = 0,
			combat_max_points = 0,
			combat_hover_time = 0,
			combat_monster_base_x = 0,
			combat_monster_base_y = 0,
			combat_dodge_dir = 1,
		},
	})
end

function init()
	build_director_fsm()
	register_director()
end

function new_game()
	current_music = nil
	local w = display_width()
	local h = display_height()
	local line_height = 8

	spawn_sprite('p3.bg.def', {
		id = bg_id,
		pos = { x = 0, y = 0, z = 0 },
		imgid = 'titel',
	})

	local horizontal_margin = w / 10
	spawn_textobject('p3.text.main.def', {
		id = text_main_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = h - (h / 2), bottom = h - (h / 3) },
		pos = { z = 1000 },
	})
	spawn_textobject('p3.text.choice.def', {
		id = text_choice_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = h - (h / 3), bottom = h - (line_height * 2) },
		pos = { z = 1001 },
	})
	spawn_textobject('p3.text.prompt.def', {
		id = text_prompt_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = h - (line_height * 2), bottom = h },
		pos = { z = 1002 },
	})
	spawn_textobject('p3.text.transition.def', {
		id = text_transition_id,
		dimensions = { left = 0, right = w, top = (h / 2) - (line_height * 2), bottom = (h / 2) + (line_height * 2) },
		pos = { z = 900 },
	})
	spawn_textobject('p3.text.results.def', {
		id = text_results_id,
		dimensions = { left = horizontal_margin, right = w - (w / 3), top = line_height * 2, bottom = h - (h / 3) },
		pos = { z = 1003 },
	})

	clear_text(text_main_id)
	clear_text(text_choice_id)
	clear_text(text_prompt_id)
	clear_text(text_transition_id)
	clear_text(text_results_id)

	spawn_sprite('p3.combat.monster.def', {
		id = combat_monster_id,
		pos = { x = 0, y = 0, z = 200 },
		imgid = 'monster_snoozer',
		visible = false,
	})
	spawn_sprite('p3.combat.maya_a.def', {
		id = combat_maya_a_id,
		pos = { x = 0, y = 0, z = 300 },
		imgid = 'maya_a',
		visible = false,
	})
	spawn_sprite('p3.combat.maya_b.def', {
		id = combat_maya_b_id,
		pos = { x = 0, y = 0, z = 300 },
		imgid = 'maya_b',
		visible = false,
	})
	spawn_sprite('p3.combat.all_out.def', {
		id = combat_all_out_id,
		pos = { x = 0, y = 0, z = 800 },
		imgid = 'all_out',
		visible = false,
	})

	spawn_object(director_def_id, { id = director_instance_id })
end

function update(_dt)
end

function draw()
end
