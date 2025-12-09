local controller_def_id = 'intro2025.controller'
local controller_instance_id = 'intro2025.controller.instance'
local controller_fsm_id = 'intro2025.controller.fsm'
local glitch_timeline_id = 'intro2025.glitch.timeline'
local glitch_timeline_event = 'intro2025.timeline.frame'

local viewport_width = 256
local char_width = 8
local line_height = 10

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

local intro_controller = {}
intro_controller.__index = intro_controller

function intro_controller:onspawn()
	self.text_full = {}
	self.text_display = {}
	self.current_line = 1
	self.current_char = 1
	self.typing = false
	self.typing_timer = 0
	self.typing_delay = 0.03
	self.pages = narrative.start
	self.page_index = 1
	self.choice_index = 1
	self.choice_response = narrative.choice.options[1].response
	self.choice_label = narrative.choice.options[1].label
	self.glitch_active = false
	self.glitch_phase = 0
	self.glitch_tone = 'low'
	self.portal_timer = 0
	self.scene_label = 'start'

	local timeline_component = self.timelines
	timeline_component.define(timeline_component, {
		id = glitch_timeline_id,
		frames = { 'buzz', 'flash', 'static' },
		ticks_per_frame = 0.18,
		playback_mode = 'loop',
		markers = {
			{ frame = 0, event = glitch_timeline_event, payload = { tone = 'low' } },
			{ frame = 1, event = glitch_timeline_event, payload = { tone = 'mid' } },
			{ frame = 2, event = glitch_timeline_event, payload = { tone = 'high' } },
		},
	})
	timeline_component.play(timeline_component, glitch_timeline_id, { rewind = true, snap_to_start = true })

	self.events:on({
		event = glitch_timeline_event,
		subscriber = self,
		handler = function(event)
			if self.glitch_active then
				self.glitch_phase = self.glitch_phase + 1
				self.glitch_tone = event.tone
			end
		end,
	})

	self:set_pages(self.pages)
end

function intro_controller:set_pages(pages)
	self.pages = pages
	self.page_index = 1
	self:set_lines(self.pages[self.page_index])
end

function intro_controller:set_lines(lines)
	self.text_full = lines
	self.text_display = {}
	for index = 1, #lines do
		self.text_display[index] = ''
	end
	self.current_line = 1
	self.current_char = 1
	self.typing = true
	self.typing_timer = 0
end

function intro_controller:type_next_character()
	local line = self.text_full[self.current_line]
	local char_to_add = string.sub(line, self.current_char, self.current_char)
	self.text_display[self.current_line] = self.text_display[self.current_line] .. char_to_add
	self.current_char = self.current_char + 1
	if self.current_char > #line then
		self.current_line = self.current_line + 1
		self.current_char = 1
		if self.current_line > #self.text_full then
			self.typing = false
		end
	end
end

function intro_controller:tick_text(dt)
	if not self.typing then
		return
	end
	self.typing_timer = self.typing_timer + dt
	while self.typing_timer >= self.typing_delay do
		self.typing_timer = self.typing_timer - self.typing_delay
		self:type_next_character()
		if not self.typing then
			break
		end
	end
end

function intro_controller:finish_block()
	self.text_display = {}
	for index = 1, #self.text_full do
		self.text_display[index] = self.text_full[index]
	end
	self.typing = false
end

function intro_controller:advance_page()
	if self.typing then
		self:finish_block()
		return true
	end
	if self.page_index < #self.pages then
		self.page_index = self.page_index + 1
		self:set_lines(self.pages[self.page_index])
		return true
	end
	return false
end

function intro_controller:start_glitch()
	self.glitch_active = true
	self.glitch_phase = 0
	self.glitch_tone = 'low'
end

function intro_controller:stop_glitch()
	self.glitch_active = false
end

function intro_controller:set_choice_index(next_index)
	self.choice_index = next_index
	local option = narrative.choice.options[self.choice_index]
	self.choice_label = option.label
	self.choice_response = option.response
end

function intro_controller:confirm_choice()
	local option = narrative.choice.options[self.choice_index]
	self.choice_response = option.response
	if self.choice_index == 1 then
		self.scene_label = 'accept'
	else
		self.scene_label = 'doubt'
	end
	return '/open_portal'
end

function intro_controller:portal_pages()
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
					self:tick_text(game.deltatime_seconds)
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
					self:tick_text(game.deltatime_seconds)
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
					self:tick_text(game.deltatime_seconds)
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
					self:tick_text(game.deltatime_seconds)
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
					self:tick_text(game.deltatime_seconds)
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
					self:set_lines(self.pages[self.page_index])
					self.portal_timer = 0
				end,
				tick = function(self)
					self:tick_text(game.deltatime_seconds)
					self.portal_timer = self.portal_timer + game.deltatime_seconds
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
	define_world_object({
		def_id = controller_def_id,
		class = intro_controller,
		fsms = { controller_fsm_id },
		defaults = {
			label = 'IntroController',
			text_full = {},
			text_display = {},
			current_line = 1,
			current_char = 1,
			typing = false,
			typing_timer = 0,
			pages = {},
			page_index = 1,
			glitch_active = false,
			glitch_phase = 0,
			scene_label = 'start',
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
	spawn_sprite(controller_def_id, {
		id = controller_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
end

local function draw_background(controller)
	if controller.glitch_active then
		local flash_color = (controller.glitch_phase % 2 == 0) and 6 or 2
		cls(flash_color)
	else
		cls(1)
	end
end

local function draw_text_block(lines, anchor_y)
	for index = 1, #lines do
		local line = lines[index]
		local x = math.floor((viewport_width - (#line * char_width)) * 0.5)
		local y = anchor_y + (index - 1) * line_height
		write(line, x, y, 0, 15)
	end
end

local function draw_choice_ui(controller, anchor_y)
	for index = 1, #narrative.choice.options do
		local option = narrative.choice.options[index]
		local prefix = controller.choice_index == index and '> ' or '  '
		local line = prefix .. option.label
		local x = math.floor((viewport_width - (#line * char_width)) * 0.5)
		local y = anchor_y + (index - 1) * line_height
		local color = controller.choice_index == index and 10 or 7
		write(line, x, y, 0, color)
	end
end

local function draw_prompt(controller)
	local prompt = controller.typing and '[A] skip' or '[A] verder'
	local x = math.floor((viewport_width - (#prompt * char_width)) * 0.5)
	local y = 180
	write(prompt, x, y, 0, 11)
end

function draw()
	local controller = world_object(controller_instance_id)
	draw_background(controller)
	local anchor_y = 40
	draw_text_block(controller.text_display, anchor_y)
	if controller.scene_label == 'choice' then
		draw_choice_ui(controller, anchor_y + (#controller.text_display + 1) * line_height)
	end
	draw_prompt(controller)
end

function update(dt)
	-- no-op; FSM ticks handle logic via states
end
