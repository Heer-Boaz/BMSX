local states = {
	title = 'title',
	game = 'game',
	overgang = 'overgang',
}

local gamestate = states.title

local function draw_title()
	sprite('titel', 0, 0, 0)
end

local function draw_game()
	cls(4)
end

local function update_title()
end

local update_handlers = {
	title=update_title,
	game=update_game,
	overgang=update_overgang,
}

local draw_handlers = {
	title=draw_title,
	game=draw_game,
	overgang=draw_overgang,
}

local next_state = nil
local overgang_x = 0
local overgang_y = 64

local function draw_overgang()
	write('MONDAY', overgang_x, overgang_y, 0, 15)
end
if action_triggered('a[jp]') then
	gamestate = states.overgang
end

function init()
	define_FSM('state', {
		initial = 'boot',
		states = {
			boot = {
				tick = function(self)
					return './title'
				end,
			},
			title = {
				entering_state = function(self)
					$.playaudio('m02')
				end,
				input_event_handlers = {
					['a[jp]'] = {
						go = function(self)
							next_state = '/bla'
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
					overgang_x = display_width
					$.playaudio('m05')
				end,
				tick = function(self)
					overgang_x -= 4
					if overgang_x < -48 then
						return next_state
					end
				end,
			},
			player_choice = {
				entering_state = function(self)
					choice_index = 1
				end,
				tick = function(self)
					self:tick_texts()
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
							local next_index = math.min(#narrative.choice.options, choice_index + 1)
							choice_index = next_index
						end,
					},
					['a[jp]'] = {
						go = function(self)
							local selected_option = narrative.choice.options[choice_index]
							if selected_option then
								next_state = selected_option.next_state
								return '/overgang'
							end
						end,
					},
				},
			},
		}
	})
	
	define_service(
end

function new_game()
	create_service('state')
	spawn_textobject('textbox', {
		dimensions = { left = 0, right = display_width(), top = display_height() - (display_height() / 4), bottom = display_height() },
	})
end

function update()
	-- print(gamestate)
	update_handlers[gamestate]()
end

function draw()
	draw_handlers[gamestate]()
end
