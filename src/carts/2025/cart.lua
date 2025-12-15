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
local combat_all_out_frame_count = 150
local combat_all_out_ticks_per_frame = 1

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

local combat_results_bg_r = 0.07
local combat_results_bg_g = 0.28
local combat_results_bg_b = 0.8
local combat_results_bg_a = 0.85

local function round(x)
	if x >= 0 then
		return math.floor(x + 0.5)
	end
	return -math.floor((-x) + 0.5)
end

local function shake_hash(seed)
	seed = seed ~ (seed << 13)
	seed = seed ~ (seed >> 17)
	seed = seed ~ (seed << 5)
	return seed
end

local function shake_signed(seed)
	local h = shake_hash(seed)
	local u = (h & 0xffff) / 0xffff
	return (u * 2) - 1
end

local function all_out_shake(frame_index)
	local total_frames = combat_all_out_frame_count
	local impact_frames = 8
	local finisher_frames = 10
	local finisher_start = total_frames - finisher_frames

	if frame_index < impact_frames then
		local amp_x = 12 - (frame_index * 2)
		local amp_y = 5 - frame_index
		return round(shake_signed(frame_index * 31 + 7) * amp_x), round(shake_signed(frame_index * 47 + 13) * amp_y)
	end

	if frame_index < finisher_start then
		local step = math.floor(frame_index / 2)
		local loop = step % 16
		local base_x = 3
		local base_y = 1
		local dx = round(shake_signed(loop * 29 + 3) * base_x)
		local dy = round(shake_signed(loop * 31 + 9) * base_y)

		local segment_len = 20
		local segment_index = math.floor((frame_index - impact_frames) / segment_len)
		local segment_start = impact_frames + (segment_index * segment_len)
		local accent_at = segment_start + 5 + (shake_hash(segment_index * 73 + 11) & 7)
		local accent_len = 3
		if frame_index >= accent_at and frame_index < (accent_at + accent_len) then
			local k = frame_index - accent_at
			local intensity = (accent_len - k) / accent_len
			dx = dx + round(shake_signed(segment_index * 199 + k * 17 + 5) * 8 * intensity)
			dy = dy + round(shake_signed(segment_index * 211 + k * 19 + 9) * 3 * intensity)
		end

		return dx, dy
	end

	if frame_index >= (total_frames - 1) then
		return 0, 0
	end

	local k = frame_index - finisher_start
	local fin_len = total_frames - finisher_start
	local intensity = (fin_len - k) / fin_len
	return round(shake_signed(5000 + k * 37 + 1) * 14 * intensity), round(shake_signed(6000 + k * 41 + 3) * 5 * intensity)
end

-- { planning = 0, opdekin = 0, rust = 0, makeup = 0 }
local story = {
	title = {
		kind = 'bg_only',
		bg = 'titel',
		music = 'm02',
		typed = false,
		pages = nil,
		next = 'intro',
	},
	intro = {
		kind = 'fade',
		music = 'm05',
		next = 'overgang_monday',
	},
	overgang_monday = {
		kind = 'transition',
		music = 'm05',
		label = 'MONDAY',
		next = 'klas',
	},
	klas = {
		kind = 'dialogue',
		music = 'm05',
		bg = 'klas1',
		typed = true,
		pages = {
			{ 'Het is een dag zoals andere dagen.', 'Gehaast en gestrest naar school.' },
			{ 'En na verveelt te zijn op school,', 'Ook nog een bak huiswerk mee naar huis.' },
		},
		next = 'overgang_monday_middag',
	},
	overgang_monday_middag = {
		kind = 'transition',
		label = 'MONDAY AFTERNOON',
		music = 'm05',
		next = 'schoolplein',
	},
	schoolplein = {
		kind = 'dialogue',
		bg = 'vriendin',
		music = 'm05',
		typed = true,
		pages = {
			{ 'Op het schoolplein spreek je met je vriendin.', 'Ze lijkt bezorgd.' },
			{ 'Morgen is er een belangrijkte toets.', 'Je moet goed voorbereid zijn.' },
		},
		next = 'vriendin_choice',
	},
	vriendin_choice = {
		kind = 'choice',
		bg = 'vriendin',
		music = 'm05',
		prompt = { 'Wat zeg je?' },
		options = {
			{
				label = '\"Ik ga vanavond eerst Persona 4 spelen.\"',
				effects = { { stat = 'rust', add = 1 }, { stat = 'planning', add = -1 } },
				result_pages = {
					{ 'Je "vriendin" zucht.', 'Gelukkig bestaat ze niet echt.', 'Planning -1', 'Rust +1' },
				},
				next = 'overgang_monday_evening',
			},
			{
				label = '\"Ik ben echt gestrest.\"',
				effects = { { stat = 'rust', add = 1 } },
				result_pages = {
					{ 'Je vriendin stelt je gerust.', 'Rust +1' },
				},
				next = 'overgang_monday_evening',
			},
		},
	},
	overgang_monday_evening = {
		kind = 'transition',
		label = 'MONDAY EVENING',
		music = 'm04',
		next = 'monday_evening',
	},
	monday_evening = {
		kind = 'dialogue',
		music = 'm04',
		bg = 'gamen',
		typed = true,
		pages = {
			{ 'Maya besluit thuis lekker Persona 4 te spelen.' },
			{ 'Het is toch ook een vorm van sociale vorming!' },
			{ 'En huiswerk is toch stom.' },
			{ 'Awel, het wordt toch tijd om te gaan slapen.' },
		},
		next = 'overgang_monday_night',
	},
	overgang_monday_night = {
		kind = 'transition',
		label = 'MONDAY NIGHT',
		next = 'monday_night',
		music = 'm04',
	},
	monday_night = {
		kind = 'dialogue',
		bg = 'slaap_n',
		music = 'm04',
		typed = true,
		pages = {
			{ 'Maya ligt s\'avonds lekker te ronken.', },
			{ 'De problemen van morgen zijn', 'voor de Maya van morgen.' },
			{ 'Die laten we voor morgen.' },
			{ 'Maar...', 'Dan wordt ze "wakker" in een droom...' },
		},
		next = 'igor',
	},
	igor = {
		kind = 'dialogue',
		bg = 'igor',
		typed = true,
		music = 'm02',
		pages = {
			{ 'Een mysterieuze figuur verschijnt.', 'Hij noemt zichzelf Sintigor.' },
			{ 'Sintigor: "Welkom Maya.', 'Ik zie dat je houdt van goede spellen."' },
			{ 'Sintigor: "Maar je zal moeten beseffen dat"', 'je keuzes gevolgen hebben."' },
			{ 'Maya: "Wat bedoel je?"' },
		},
		next = 'igor_choice',
	},
	igor_choice = {
		kind = 'choice',
		bg = 'igor',
		music = 'm02',
		prompt = { 'Sintigor: "Je zult het snel genoeg ontdekken."',},
		options = {
			{
				label = 'Uh ja, whatever.',
				effects = { { stat = 'opdekin', add = 1 } },
				result_pages = {
					{ 'Sintigor lacht. Hij wat jou te wachten staat.', 'Opdekin +1' },
				},
				next = 'overgang_tuesday_morning',
			},
			{
				label = 'Nogal verontrustend dat Sinterklaas in de dromen van kinderen verschijnt.',
				effects = { { stat = 'makeup', add = 1 } },
				result_pages = {
					{ 'Sintigor: "Ik ben Sintigor, niet Sinterklaas. Jouw opmerking is wel scherp en laat je er beter uit zien."', 'Make-up +1' },
				},
				next = 'overgang_tuesday_morning',
			},
		},
	},
	overgang_tuesday_morning = {
		kind = 'transition',
		label = 'TUESDAY MORNING',
		music = 'm06',
		next = 'ochtendpijn',
	},
	ochtendpijn = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		typed = true,
		pages = {
			music = 'm06',
			{ 'De wekker gaat af.', 'Maya wordt semi-wakker.' },
			{ '"Die rotwekker ook!" denkt ze bij zichzelf.' },
			{ '"Gelukkig hebben ze daarom snooze uitgevonden."', 'Maar is dat wel verstandig met een toets vandaag?' },
			{ '"Kan Maya weerstand bieden aan de verleiding?"' },
		},
		next = 'combat_wekker',
	},
	combat_wekker = {
		kind = 'combat',
		music = 'm16',
		monster_imgid = 'monster_snoozer',
		rounds = {
			{
				prompt = { 'De wekker gaat af.', 'Tijd voor een snooze?' },
				options = {
					{ label = '\"Nog eventjes dan.\"', outcome = 'dodge', points = 0 },
					{ label = '\"Neen! Ik ga opstaan!\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'De oogjes worden zwaar.', 'Meer snoozen?' },
				options = {
					{ label = '\"Snoozen is goed voor de huid!\"', outcome = 'dodge', points = 0 },
					{ label = '\"NEIN!\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'Het wordt lichter en de ogen frisser.', },
				options = {
					{ label = '\"Ik wordt wekker van de wakker!\"', outcome = 'hit', points = 1 },
					{ label = '\"School is stom.\"', outcome = 'dodge', points = 0 },
				},
			},
		},
		rewards = {
			{ { stat = 'makeup', add = 2 } },
			{ { stat = 'rust', add = 1 }, { stat = 'planning', add = 1 }, { stat = 'makeup', add = 1 } },
			{ { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 }, { stat = 'opdekin', add = 1 } },
			{ { stat = 'planning', add = 2 }, { stat = 'rust', add = 2 }, { stat = 'opdekin', add = 2 } },
		},
		next = 'after_combat_wekker',
	},
	after_combat_wekker = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		music = 'm07',
		typed = true,
		pages = {
			{ 'De wekker is verslagen... Tijd voor de volgende uitdaging.', },
		},
		next = 'spiegel',
	},
	spiegel = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		typed = true,
		pages = {
			{ 'De dodelijkste strijd gaat beginnen!' },
			{ 'Het allerbelangrijkste wat er moet gebeuren...' },
			{ 'Het opmaken voor de toets!' },
		},
		next = 'combat_spiegel',
	},
	combat_spiegel = {
		kind = 'combat',
		music = 'm35',
		monster_imgid = 'monster_spiegel',
		rounds = {
			{
				prompt = { 'Wat wordt het vandaag?', 'Extra eyeliner of lipstick?' },
				options = {
					{ label = '\"Extra eyeliner.\"', outcome = 'dodge', points = 0 },
					{ label = '\"Extra lipstick.\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'Oei, een puistje!', 'Meer make-up?' },
				options = {
					{ label = '\"Boeuh!\"', outcome = 'hit', points = 1 },
					{ label = '\"Ubermakeup!\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'Je mag jezelf nu wel vertonen op school.', 'Maar het is nog niet genoeg!' },
				options = {
					{ label = '\"MEER MAKEUP!\"', outcome = 'dodge', points = 0 },
					{ label = '\"Ik luister naar mijn moeder.\"', outcome = 'hit', points = 1 },
				},
			},S
		},
		rewards = {
			{ { stat = 'makeup', add = 3 } },
			{ { stat = 'makeup', add = 3 } },
			{ { stat = 'makeup', add = 3 }, { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 } },
		},
		next = 'after_combat_spiegel',
	},
	after_combat_spiegel = {
		kind = 'dialogue',
		bg = 'maya_b',
		music = 'm05',
		typed = true,
		pages = {
			{ 'YES, JE ZIET ER WEER GOED UIT!', },
			{ 'Nu voorbereiden op de toets!', },
		},
		next = 'overgang_huiswerk',
	},
	overgang_huiswerk = {
		kind = 'fade',
		music = 'm05',
		next = 'huiswerk',
	},
	huiswerk = {
		kind = 'dialogue',
		music = 'm05',
		bg = 'huiswerk',
		typed = true,
		pages = {
			{ 'Nadat Maya dapper heeft gestreden tegen haar wekker en spiegel...' },
			{ 'Besluit Maya verstandig haar voorbereiding te doen voor de toets!' },
			{ 'Nu tijd voor school.' },
		},
		next = 'overgang_tuesday_afternoon',
	},
	overgang_tuesday_afternoon = {
		kind = 'transition',
		label = 'TUESDAY AFTERNOON',
		music = 'm05',
		next = 'toets',
	},
	toets = {
		kind = 'dialogue',
		bg = 'klas1',
		music = 'm05',
		typed = true,
		pages = {
			{ 'Maya zit in de klas, klaar voor de toets.', },
			{ 'Ze voelt zich goed voorbereid.', },
			{ 'De toets begint...' },
			{ 'Nu tijd voor combat...' },
			{ 'Maar de Sint faalt met goede voorbereiding en skipt dit gedeelte van het spel...' },
		},
		next = 'overgang_tuesday_afternoon',
	},
	overgang_tuesday_afternoon = {
		kind = 'transition',
		label = 'ORDEEL DES SINTS',
		music = 'm02',
		next = 'ending',
	},
	ending = {
		kind = 'dialogue',
		bg = 'sint_blij',
		music = 'm02',
		typed = true,
		pages = {
			{ 'Maya, dat heb je toch weer redelijk gedaan!' },
			{ 'Je hebt dapper gestreden tegen twee verschrikkelijke verleidingen:' },
			{ 'De gruwelijke snooze', 'En de afgrijselijke make-up spiegel!' },
			{ 'Ik ben trots op je!', 'Dit zal jouw toekomst zeker ten goede komen.' },
		},
	},
	__inline_dialogue = {
		kind = 'dialogue_inline',
		typed = true,
	},
}

current_music = nil

local function playmusic(musicid)
	if musicid == current_music or musicid == Nil then
		return
	end
	$.playaudio(musicid)
	current_music = musicid
end

local function stopmusic()
	$.stopmusic()
	current_music = nil
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
	return node.rewards[self.combat_points + 1]
end

function director:show_dialogue_page(typed)
	local page = self.pages[self.page_index]
	set_text_lines(text_main_id, page, typed)
	clear_text(text_choice_id)
end

function director:update_dialogue_prompt()
	local main = world_object(text_main_id)
	if main.is_typing then
		self:set_prompt_line('(B) skip')
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
								local node = story[self.node_id]
								if story[node.next].kind == 'combat' then
									fade_in_start = overgang_frame_count
								end
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
							local next_kind = story[self.node_id].kind
							self.skip_transition_fade = false
							if next_kind == 'combat' then
								self.skip_combat_fade_in = true
							end
							if came_from_fade and next_kind ~= 'combat' then
								return '/transition_fade_in'
							end
							return '/run_node'
						end,
					},
				},
				leaving_state = function(self)
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
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
					self:hide_combat_sprites()
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
					clear_text(text_results_id)
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
					local next_kind = next_node.kind
					self.fade_hold_black = next_kind == 'transition' or next_kind == 'combat'
					if next_kind == 'transition' then
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
					clear_text(text_results_id)
					self:hide_combat_sprites()
					local bg = world_object(bg_id)
					bg.visible = true
					bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
				end,
				on = {
					['timeline.frame.' .. combat_fade_timeline_id] = {
						go = function(self, _state, event)
							local frame_index = event.frame_index
							local c = 0
							if frame_index < combat_fade_out_frames then
								local u = frame_index / (combat_fade_out_frames - 1)
								c = 1 - smoothstep(u)
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
				end,
				on = {
					['timeline.end.' .. combat_fade_timeline_id] = {
						go = function(self)
							return '/run_node'
						end,
					},
				},
			},
			combat_init = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					clear_text(text_transition_id)
					clear_text(text_results_id)
					self:reset_text_colors()

					local bg = world_object(bg_id)
					bg.visible = false

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
					clear_text(text_transition_id)
					clear_text(text_results_id)
					local bg = world_object(bg_id)
					bg.visible = false
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
					self.all_out_origin_x = all_out.x
					self.all_out_origin_y = all_out.y
				end,
				on = {
					['timeline.frame.' .. combat_all_out_timeline_id] = {
						go = function(self, _state, event)
							local dx, dy = all_out_shake(event.frame_index)
							local all_out = world_object(combat_all_out_id)
							all_out.x = self.all_out_origin_x + dx
							all_out.y = self.all_out_origin_y + dy
						end,
					},
					['timeline.end.' .. combat_all_out_timeline_id] = {
						go = function(self)
							return '/combat_results_setup'
						end,
					},
				},
				leaving_state = function(self)
					local all_out = world_object(combat_all_out_id)
					all_out.visible = false
					all_out.x = self.all_out_origin_x
					all_out.y = self.all_out_origin_y
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

					local monster = world_object(combat_monster_id)
					monster.visible = false
					local maya_a = world_object(combat_maya_a_id)
					maya_a.visible = false
					local all_out = world_object(combat_all_out_id)
					all_out.visible = false

					local bg = world_object(bg_id)
					local bg_sprite = bg.get_component_by_id('base_sprite')
					self.combat_results_prev_bg_imgid = bg.imgid
					self.combat_results_prev_bg_scale_x = bg_sprite.scale.x
					self.combat_results_prev_bg_scale_y = bg_sprite.scale.y
					bg.visible = true
					bg.imgid = 'whitepixel'
					bg.x = 0
					bg.y = 0
					bg_sprite.scale = { x = display_width(), y = display_height() }
					bg.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = 0 }

					local maya_b = world_object(combat_maya_b_id)
					maya_b.imgid = 'maya_b'
					maya_b.visible = true
					self.combat_results_maya_target_x = display_width() - maya_b.sx
					self.combat_results_maya_start_x = display_width()
					maya_b.x = self.combat_results_maya_start_x
					maya_b.y = display_height() - maya_b.sy
					maya_b.colorize = { r = 1, g = 1, b = 1, a = 0 }
					maya_b.z = 300

					local lines = { 'Combat Results:' }
					for i = 1, #rewards do
						local effect = rewards[i]
						lines[#lines + 1] = stat_label(effect.stat) .. ' +' .. effect.add
					end
					set_text_lines(text_results_id, lines, false)
					local results = world_object(text_results_id)
					results.text_color = { r = 1, g = 1, b = 1, a = 0 }
					self.combat_results_text_target_x = results.centered_block_x / 2
					self.combat_results_text_start_x = -display_width()
					results.centered_block_x = self.combat_results_text_start_x
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
							local bg = world_object(bg_id)
							bg.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = combat_results_bg_a * a }
							local maya_b = world_object(combat_maya_b_id)
							maya_b.colorize = { r = 1, g = 1, b = 1, a = a }
							maya_b.x = self.combat_results_maya_start_x + (self.combat_results_maya_target_x - self.combat_results_maya_start_x) * a
							local results = world_object(text_results_id)
							results.text_color = { r = 1, g = 1, b = 1, a = a }
							results.centered_block_x = self.combat_results_text_start_x + (self.combat_results_text_target_x - self.combat_results_text_start_x) * a
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
							local bg = world_object(bg_id)
							bg.colorize = { r = combat_results_bg_r, g = combat_results_bg_g, b = combat_results_bg_b, a = combat_results_bg_a * a }
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
							local bg = world_object(bg_id)
							local bg_sprite = bg.get_component_by_id('base_sprite')
							bg.visible = false
							bg.imgid = self.combat_results_prev_bg_imgid
							bg_sprite.scale = { x = self.combat_results_prev_bg_scale_x, y = self.combat_results_prev_bg_scale_y }
							bg.colorize = { r = 1, g = 1, b = 1, a = 1 }
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
					local bg = world_object(bg_id)
					self:apply_background(self.combat_exit_target_bg)
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
			node_id = 'combat_wekker',
			page_index = null,
			choice_index = 1,
			stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 },
			inline_pages = {},
			inline_next = '',
			pages = null,
			transition_center_x = 0,
			transition_target_bg = story.title.bg,
			fade_target_bg = story.title.bg,
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
			all_out_origin_x = 0,
			all_out_origin_y = 0,
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
	local line_height = 16
	local prompt_lines = 1
	local choice_lines = 4
	local main_lines = 4
	local prompt_top = h - (line_height * prompt_lines)
	local choice_top = h - (line_height * (prompt_lines + choice_lines))
	local main_top = h - (line_height * (prompt_lines + choice_lines + main_lines))

	spawn_sprite('p3.bg.def', {
		id = bg_id,
		pos = { x = 0, y = 0, z = 0 },
		imgid = 'none',
		visible = false,
	})

	local horizontal_margin = w / 10
	spawn_textobject('p3.text.main.def', {
		id = text_main_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = main_top, bottom = choice_top },
		pos = { z = 1000 },
	})
	spawn_textobject('p3.text.choice.def', {
		id = text_choice_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = choice_top, bottom = prompt_top },
		pos = { z = 1001 },
	})
	spawn_textobject('p3.text.prompt.def', {
		id = text_prompt_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = prompt_top, bottom = h },
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
