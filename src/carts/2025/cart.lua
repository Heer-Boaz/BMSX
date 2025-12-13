local director_def_id = 'p3.director'
local director_instance_id = 'p3.director.instance'
local director_fsm_id = 'p3.director.fsm'

local bg_id = 'p3.bg'
local text_main_id = 'p3.text.main'
local text_choice_id = 'p3.text.choice'
local text_prompt_id = 'p3.text.prompt'
local text_transition_id = 'p3.text.transition'

local overgang_timeline_id = 'overgang'
local overgang_frame_count = 60

local story = {
	title = {
		kind = 'dialogue',
		bg = 'titel',
		music = 'm02',
		typed = false,
		pages = {
			{ 'Pakjesavond 5 december...', 'Een moderne slaapkamer.', 'Druk [A] om te beginnen.' },
		},
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
				effects = { { stat = 'courage', add = 1 } },
				result_pages = {
					{ 'Je staat op. Geen weg terug.', 'Moed +1' },
				},
				next = 'overgang_downstairs',
			},
			{
				label = 'Blijf liggen.',
				effects = { { stat = 'academics', add = 1 } },
				result_pages = {
					{ 'Je trekt de deken over je hoofd.', 'Maar de geluiden stoppen niet.', 'Studie +1' },
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
				effects = { { stat = 'charm', add = 1 } },
				result_pages = {
					{ 'Een stem fluistert: "Pas op voor de schaduw."', 'Charme +1' },
				},
				next = 'overgang_darkhour',
			},
			{
				label = 'Negeer het.',
				effects = { { stat = 'courage', add = 1 } },
				result_pages = {
					{ 'Je drukt weg. Je moet focussen.', 'Moed +1' },
				},
				next = 'overgang_darkhour',
			},
		},
	},
	overgang_darkhour = {
		kind = 'transition',
		label = 'DARK HOUR',
		music = 'm16',
		next = 'combat_intro',
	},
	combat_intro = {
		kind = 'combat',
		bg = 'klas1',
		music = 'm16',
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
		next = 'title',
	},
	__inline_dialogue = {
		kind = 'dialogue_inline',
		typed = true,
	},
}

local function playmusic(musicid)
	if musicid ~= nil then
		$.playaudio(musicid)
	else
		$.stopmusic()
	end
end

local function set_text_lines(text_object_id, lines, typed)
	local text_obj = world_object(text_object_id)
	text_obj.set_text(array(lines))
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

function director:apply_effects(effects)
	for i = 1, #effects do
		local effect = effects[i]
		self.stats[effect.stat] = self.stats[effect.stat] + effect.add
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
		self:set_prompt_line('[A] skip')
		return
	end
	if self.page_index < #self.pages then
		self:set_prompt_line('[A] next')
		return
	end
	self:set_prompt_line('[A] continue')
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
					self.current_music = nil
					self.stats = { courage = 0, charm = 0, academics = 0 }
					self.inline_pages = nil
					self.inline_next = nil
					clear_text(text_main_id)
					clear_text(text_choice_id)
					clear_text(text_prompt_id)
					clear_text(text_transition_id)
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
					if node.kind == 'choice' then
						return '/choice'
					end
					if node.kind == 'combat' then
						return '/combat'
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
								ticks_per_frame = 16,
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
					local transition_text = world_object(text_transition_id)
					transition_text.centered_block_x = display_width()
				end,
				on = {
					['timeline.frame.' .. overgang_timeline_id] = {
						go = function(self, _state, event)
							local frame_index = event.frame_index
							local u = frame_index / (overgang_frame_count - 1)
							local start_x = display_width()
							local end_x = -display_width()
							local x = start_x + (end_x - start_x) * u
							local transition_text = world_object(text_transition_id)
							transition_text.centered_block_x = x
						end,
					},
					['timeline.end.' .. overgang_timeline_id] = {
						go = function(self)
							local node = story[self.node_id]
							self.node_id = node.next
							clear_text(text_transition_id)
							return '/run_node'
						end,
					},
				},
				leaving_state = function(self)
					clear_text(text_transition_id)
				end,
			},
			dialogue = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
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
								self.inline_pages = nil
								self.inline_next = nil
							else
								self.node_id = node.next
							end
							return '/run_node'
						end,
					},
				},
			},
			choice = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
					self:setup_choice_menu(node)
					self:set_prompt_line('[A] skip')
				end,
				tick = function(self)
					local main = world_object(text_main_id)
					if main.is_typing then
						main.type_next()
						self:set_prompt_line('[A] skip')
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
			combat = {
				entering_state = function(self)
					local node = story[self.node_id]
					playmusic(node.music)
					self:apply_background(node.bg)
					clear_text(text_transition_id)
					clear_text(text_choice_id)
					set_text_lines(text_main_id, { 'COMBAT!!', '(placeholder)', 'Druk [A] om te winnen.' }, false)
					self:set_prompt_line('[A] win')
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
			current_music = nil,
			stats = { courage = 0, charm = 0, academics = 0 },
			inline_pages = nil,
			inline_next = nil,
			pages = nil,
		},
	})
end

function init()
	build_director_fsm()
	register_director()
end

function new_game()
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
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = h - (h / 3), bottom = h - (line_height * 2) },
		pos = { z = 1000 },
	})
	spawn_textobject('p3.text.choice.def', {
		id = text_choice_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = h - (line_height * 7), bottom = h - (line_height * 3) },
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

	clear_text(text_main_id)
	clear_text(text_choice_id)
	clear_text(text_prompt_id)
	clear_text(text_transition_id)

	spawn_object(director_def_id, { id = director_instance_id })
end

function update(_dt)
end

function draw()
end
