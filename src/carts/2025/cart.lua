local controller_def_id = 'intro2025.controller'
local controller_instance_id = 'intro2025.controller.instance'
local controller_fsm_id = 'intro2025.controller.fsm'
local glitch_timeline_id = 'intro2025.glitch'
local glitch_timeline_event = 'timeline.frame.' .. glitch_timeline_id

local text_main_def_id = 'intro2025.text.main'
local text_main_id = 'intro2025.text.main.instance'
local text_choice_def_id = 'intro2025.text.choice'
local text_choice_id = 'intro2025.text.choice.instance'
local text_prompt_def_id = 'intro2025.text.prompt'
local text_prompt_id = 'intro2025.text.prompt.instance'

local narrative = {
	start = {
		{ 'Pakjesavond 5 december...', 'Een moderne slaapkamer.', 'Druk [A] om te beginnen.' },
	},
	niece = {
		{ 'Ik dacht dat vanavond rustig zou zijn.', 'Even gamen, even ontsnappen.' },
		{ 'Maar waarom voelt het alsof iemand me aankijkt?', 'Alsof de muren luisteren.' },
		{ 'Oké, adem in. Wat is het ergste dat kan gebeuren?' },
	},
	transmission = {
		{ 'Een lage zoemtoon vult de kamer...', 'Het beeld flikkert.' },
		{ '--n...t... ben jij daar?', 'De lijst... de balans... pas op...' },
	},
	sinter = {
		{ 'Verschiet niet, meisje.', 'Ik ben Sinterklaas... of wat ervan overblijft.' },
		{ 'Het Grote Boek corrumpeert zichzelf.', 'Portalen zijn geopend.', 'De wereld raakt uit balans.' },
		{ 'Jij staat buiten het systeem.', 'Alleen jij kunt het herstellen.', 'Help me het evenwicht terug te brengen.' },
	},
	choice = {
		prompt = { 'Je voelt zijn blik. Wat zeg je?' },
		options = {
			{ label = 'Natuurlijk help ik.', response = 'Ik wist het. Je lef maakt het verschil.' },
			{ label = 'Wat als ik weiger?', response = 'Dan herschrijft het Boek ons allemaal. Maar ik geloof dat je mee gaat.' },
		},
	},
	portal = {
		common = {
			{ 'Een blauw licht vult de kamer.', 'Het portaal gromt en glitcht.' },
			{ 'Stap erin. Vertrouw op mij.', 'De Sinterdimension wacht.' },
		},
		accept = { 'Ik doe het. Geen weg terug.' },
		doubt = { 'Oké... maar ik wil antwoorden als dit voorbij is.' },
	},
}

local function set_text_lines(text_object_id, lines, typed)
	local text_obj = world_object(text_object_id)
	text_obj:setTextFromLines(lines)
	if typed then
		return
	end
	text_obj.displayed_lines = text_obj.full_text_lines
	text_obj.text = text_obj.full_text_lines
	text_obj.is_typing = false
end

local function finish_text(text_object_id)
	local text_obj = world_object(text_object_id)
	text_obj.displayed_lines = text_obj.full_text_lines
	text_obj.text = text_obj.full_text_lines
	text_obj.is_typing = false
end

local function tick_text(text_object_id)
	local text_obj = world_object(text_object_id)
	if text_obj.is_typing then
		text_obj:typeNextCharacter()
	end
end

local function set_prompt_lines()
	local prompt_obj = world_object(text_prompt_id)
	local main_text = world_object(text_main_id)
	local prompt = main_text.is_typing and '[A] skip' or '[A] verder'
	set_text_lines(text_prompt_id, { prompt }, false)
end

local function choice_lines(choice_index)
	local lines = {}
	for index = 1, #narrative.choice.options do
		local option = narrative.choice.options[index]
		local prefix = choice_index == index and '> ' or '  '
		lines[#lines + 1] = prefix .. option.label
	end
	return lines
end

local intro_service = {}
intro_service.__index = intro_service
intro_service.id = controller_instance_id

function intro_service:ensure_glitch_timeline()
	if self.glitch_timeline then
		return
	end
	self.glitch_timeline = new_timeline({
		id = glitch_timeline_id,
		frames = { 'low', 'mid', 'high' },
		ticks_per_frame = 1,
		playback_mode = 'loop',
	})
end

function intro_service:set_pages(pages)
	self.pages = pages
	self.page_index = 1
	self:set_lines(self.pages[self.page_index], true)
end

function intro_service:set_lines(lines, typed)
	set_text_lines(text_main_id, lines, typed)
	set_prompt_lines()
end

function intro_service:tick_texts()
	tick_text(text_main_id)
	set_prompt_lines()
end

function intro_service:finish_block()
	finish_text(text_main_id)
	set_prompt_lines()
end

function intro_service:advance_page()
	local main_text = world_object(text_main_id)
	if main_text.is_typing then
		self:finish_block()
		return true
	end
	if self.page_index < #self.pages then
		self.page_index = self.page_index + 1
		self:set_lines(self.pages[self.page_index], true)
		return true
	end
	return false
end

function intro_service:start_glitch()
	self.glitch_active = true
	self.glitch_phase = 0
	self.glitch_tone = 'low'
	self:ensure_glitch_timeline()
	self.glitch_timeline:rewind()
end

function intro_service:stop_glitch()
	self.glitch_active = false
end

function intro_service:tick_glitch()
	if not self.glitch_active then
		return
	end
	local tl = self.glitch_timeline
	local events = tl:advance()
	for index = 1, #events do
		local ev = events[index]
		if ev.kind == 'frame' then
			self.glitch_phase = self.glitch_phase + 1
			self.glitch_tone = ev.value
			emit(glitch_timeline_event, self, { tone = ev.value })
		end
	end
end

function intro_service:set_choice_index(next_index)
	self.choice_index = next_index
	local option = narrative.choice.options[self.choice_index]
	self.choice_response = option.response
	set_text_lines(text_choice_id, choice_lines(self.choice_index), false)
end

function intro_service:confirm_choice()
	if self.choice_index == 1 then
		self.scene_label = 'accept'
	else
		self.scene_label = 'doubt'
	end
	return '/open_portal'
end

function intro_service:portal_pages()
	local decision_line = self.choice_response
	local accept_lines = self.scene_label == 'accept' and narrative.portal.accept or narrative.portal.doubt
	local blocks = {
		{ decision_line },
	}
	for index = 1, #narrative.portal.common do
		blocks[#blocks + 1] = narrative.portal.common[index]
	end
	blocks[#blocks + 1] = accept_lines
	return blocks
end

local function build_intro_fsm()
	define_fsm(controller_fsm_id, {
		initial = 'start_screen',
		states = {
			start_screen = {
				entering_state = function(self)
					self.scene_label = 'start'
					self:set_pages(narrative.start)
				end,
				tick = function(self)
					self:tick_texts()
					self:tick_glitch()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
							return '/niece_intro'
						end,
					},
				},
			},
			niece_intro = {
				entering_state = function(self)
					self.scene_label = 'niece'
					self:set_pages(narrative.niece)
				end,
				tick = function(self)
					self:tick_texts()
					self:tick_glitch()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
							return '/transmission'
						end,
					},
				},
			},
			transmission = {
				entering_state = function(self)
					self.scene_label = 'transmission'
					self:start_glitch()
					self:set_pages(narrative.transmission)
				end,
				tick = function(self)
					self:tick_texts()
					self:tick_glitch()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
							return '/sinter_appear'
						end,
					},
				},
			},
			sinter_appear = {
				entering_state = function(self)
					self.scene_label = 'sinter'
					self:stop_glitch()
					self:set_pages(narrative.sinter)
				end,
				tick = function(self)
					self:tick_texts()
					self:tick_glitch()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
							return '/player_choice'
						end,
					},
				},
			},
			player_choice = {
				entering_state = function(self)
					self.scene_label = 'choice'
					self:set_pages({ narrative.choice.prompt })
					self.choice_index = 1
					self:set_choice_index(1)
				end,
				tick = function(self)
					self:tick_texts()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_up[jp]'] = {
						go = function(self)
							local next_index = math.max(1, self.choice_index - 1)
							self:set_choice_index(next_index)
						end,
					},
					['console_down[jp]'] = {
						go = function(self)
							local next_index = math.min(#narrative.choice.options, self.choice_index + 1)
							self:set_choice_index(next_index)
						end,
					},
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
							return self:confirm_choice()
						end,
					},
				},
			},
			open_portal = {
				entering_state = function(self)
					self:stop_glitch()
					self.pages = self:portal_pages()
					self.page_index = 1
					self:set_lines(self.pages[self.page_index], true)
				end,
				tick = function(self)
					self:tick_texts()
					self:tick_glitch()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['console_a[jp]'] = {
						go = function(self)
							if self:advance_page() then
								return
							end
						end,
					},
				},
			},
		},
	})
end

local function register_controller()
	define_service({
		def_id = controller_def_id,
		class = intro_service,
		fsms = { controller_fsm_id },
		defaults = {
			label = 'IntroController',
			pages = narrative.start,
			page_index = 1,
			glitch_active = false,
			glitch_phase = 0,
			glitch_tone = 'low',
			scene_label = 'start',
			choice_index = 1,
			choice_response = narrative.choice.options[1].response,
		},
	})
end

local function define_blueprints_and_handlers()
	build_intro_fsm()
	register_controller()
end

function init()
	define_blueprints_and_handlers()
end

function new_game()
	local w = display_width()
	local h = display_height()
	local line_height = 8

	spawn_textobject(text_main_def_id, {
		id = text_main_id,
		dimensions = { left = 0, right = w, top = line_height * 2, bottom = h - line_height * 6 },
	})
	spawn_textobject(text_choice_def_id, {
		id = text_choice_id,
		dimensions = { left = 0, right = w, top = h - line_height * 7, bottom = h - line_height * 3 },
	})
	spawn_textobject(text_prompt_def_id, {
		id = text_prompt_id,
		dimensions = { left = 0, right = w, top = h - line_height * 2, bottom = h },
	})

	create_service(controller_def_id)
	local ctrl = service(controller_instance_id)
	ctrl:ensure_glitch_timeline()
	ctrl:set_pages(narrative.start)
	set_text_lines(text_choice_id, {}, false)
	set_prompt_lines()
	ctrl:activate()
end

local function draw_background(controller)
	if controller.glitch_active then
		local flash_color = (controller.glitch_phase % 2 == 0) and 6 or 2
		cls(flash_color)
		return
	end
	cls(1)
end

function draw()
	local controller = service(controller_instance_id)
	draw_background(controller)
end

function update()
	local controller = service(controller_instance_id)
	controller.sc:tick()
end
