local blaat = {
	a = {
		tekst = array({ 'Pakjesavond 5 december...', 'Een moderne slaapkamer.', 'Druk [A] om te beginnen.' }),
		keuzes = { -- Choices here => show choice menu instead of going immediately to next state
			{ tekst = 'Ga naar beneden.', handle = function() return '/game' end },
			{ tekst = 'Blijf liggen.', handle = function() return '/staybed' end },
		},
	},
	b = {
		tekst = array({ 'Je ligt in bed en probeert te slapen.', 'Maar je hoort iets vreemds beneden...', 'Druk [A] om te gaan kijken.' }),
		keuzes = nil, -- No choices here => continue story
		next_state = '/downstairs', -- Next state to go to after text is done and [A] is pressed
	},
}

local states = {
	title = 'title',
	game = 'game',
	overgang = 'overgang',
}

local gamestate = nil
local keuzestate = 'A'

local function draw_title()
	sprite('titel', 0, 0, 0)
end

Bg = nil
local function draw_game()
	if bg == nil then return end
	sprite(bg, 0, 0, 0)
end

local next_state = nil
local overgang_x = 0
local overgang_y = 64

local function draw_overgang()
	write('MONDAY', overgang_x, overgang_y, 0, 15)
end

local draw_handlers = {
	title=draw_title,
	game=draw_game,
	overgang=draw_overgang,
}

local state_svc = {}
state_svc.__index = state_svc

function state_svc:bla()
end

function init()
	define_FSM('state_fsm', {
		initial = 'boot',
		states = {
			boot = {
				tick = function(self)
					return '/title'
				end,
			},
			title = {
				entering_state = function(self)
					gamestate = 'title'
					$.playaudio('m02')
				end,
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							next_state = '/player_choice'
							return '/overgang'
						end,
					},
				},
				leaving_state = function(self)
					$.stopaudio('m02')
				end,
			},
			overgang = {
				entering_state = function(self)
					gamestate = 'overgang'
					overgang_x = display_width()
					$.playaudio('m05')
				end,
				tick = function(self)
					overgang_x -= 2
					if overgang_x < -48 then
						return next_state
					end
				end,
				-- zoefin = {
					-- tick = functIon(self)
						-- overgang_x -= 4
						-- if overgang_x < -48 then
							-- return '../zoefwacht'
						-- end
					-- end
				-- },
				-- zoefwacht = {
				-- }
			},
			game = {
				entering_state = function(self)
					gamestate = 'game'
					bg = 'ochtend'
				end
			},
			player_choice = {
				entering_state = function(self)
					gamestate = 'game'
					choice_index = 1
					local tekstding = rget('textbox')
					tekstding.set_text(array({'asfasassdasdasadsads', 'sdfsdfdsf', 'sfdsfdsf'}))
				end,
				tick = function(self)
					local tekstding = rget('textbox')
					tekstding.type_next()
				end,
				input_eval = 'first',
				input_event_handlers = {
					['up[jp]'] = {
						go = function(self)
							local next_index = math.max(1, choice_index - 1)
							choice_index = next_index
						end,
					},
					['down[jp]'] = {
						go = function(self)
							local next_index = math.min(#blaat[keuzestate].keuzes, choice_index + 1)
							choice_index = next_index
						end,
					},
					['a[jp]'] = {
						go = function(self)
							local selected_option = blaat[keuzestate].keuzes[choice_index].handle
							local result = selected_option()
							if result then return result end
						end,
					},
				},
			},
		}
	})

	define_service({
		def_id = 'state_def',
		class = state_svc,
		fsms = { 'state_fsm' },
		defaults = {
		},
	})
end

function new_game()
	local svc = create_service('state_def')
	svc.activate()
	spawn_textobject('textbox', {
		dimensions = { left = 0, right = display_width(), top = display_height() - (display_height() / 4), bottom = display_height() },
		pos = { z = 10000 },
	})
end

function update()
	-- print(gamestate)
end

function draw()
	draw_handlers[gamestate]()
end
