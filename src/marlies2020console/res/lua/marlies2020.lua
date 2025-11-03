SCREEN_WIDTH = 256
SCREEN_HEIGHT = 212

COLUMN_X = { 36, 48, 80, 160, 200 }
START_COLUMN = 2
INVENTORY_POS = { x = 12, y = 12, z = 2000 }

MAX_CORONA = 3
SPAWN_INTERVAL = 3.0
MIN_CORONA_MOVE = 16
MAX_CORONA_MOVE = 72
CORONA_SPEED = 55
CORONA_FRAME_TICKS = 6
FIRE_SPEED = 180
FIRE_LIFETIME = 0.45
FIRE_FRAME_TICKS = 2
PLAYER_MOVE_SPEED = 96
PLAYER_SWITCH_SPEED = 140
PLAYER_HIT_RECOVERY = 1.1
PLAYER_FIRE_COOLDOWN = 0.35
PLAYER_FRAME_TICKS = 4
PITAS_REQUIRED = 1

SOUNDS = {
	fire = 'init',
	select = 'selectie',
	hurt = 'fout',
}

SPRITES = {
	background = 'keuken',
	inventory = 'invframe',
	board = 'bord',
	pita = 'pita',
	pita_filled = 'pitagevuld',
	cucumber = 'komkommer',
	cucumber_sliced = 'komkommer_gesneden',
	tomato = 'tomaatjes',
	falafel = 'falafel',
	knife = 'mes',
	extinguisher = 'brandblusser',
	player_down = { 'p1', 'p2', 'p3', 'p2' },
	player_up = { 'p4', 'p5', 'p6', 'p5' },
	player_switch = { 'p7' },
	player_hurt = { 'p8', 'p9' },
	player_win = { 'p10' },
	corona = { 'corona1', 'corona2', 'corona3', 'corona2' },
	fire = { 'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10' },
	sint = 'sint',
}

PLAYER_ABILITY_IDS = {
	fire = 'marlies2020.player.fire',
	interact = 'marlies2020.player.interact',
	move_horizontal = 'marlies2020.player.move_horizontal',
	move_horizontal_stop = 'marlies2020.player.move_horizontal_stop',
	move_vertical = 'marlies2020.player.move_vertical',
	move_vertical_stop = 'marlies2020.player.move_vertical_stop',
	hurt = 'marlies2020.player.hurt',
}

local PLAYER_INPUT_PROGRAM = {
	schema = 1,
	bindings = {
		{
			name = 'move_left',
			priority = 10,
			on = { hold = 'move_left[h]', release = 'move_left[jr]' },
			['do'] = {
				hold = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_horizontal, payload = { direction = 'left' } } },
					{ ['input.consume'] = 'move_left' },
				},
				release = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_horizontal_stop } },
					{ ['input.consume'] = 'move_left' },
				},
			},
		},
		{
			name = 'move_right',
			priority = 10,
			on = { hold = 'move_right[h]', release = 'move_right[jr]' },
			['do'] = {
				hold = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_horizontal, payload = { direction = 'right' } } },
					{ ['input.consume'] = 'move_right' },
				},
				release = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_horizontal_stop } },
					{ ['input.consume'] = 'move_right' },
				},
			},
		},
		{
			name = 'move_up',
			priority = 9,
			on = { hold = 'move_up[h]', release = 'move_up[jr]' },
			['do'] = {
				hold = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_vertical, payload = { direction = 'up' } } },
					{ ['input.consume'] = 'move_up' },
				},
				release = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_vertical_stop } },
					{ ['input.consume'] = 'move_up' },
				},
			},
		},
		{
			name = 'move_down',
			priority = 9,
			on = { hold = 'move_down[h]', release = 'move_down[jr]' },
			['do'] = {
				hold = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_vertical, payload = { direction = 'down' } } },
					{ ['input.consume'] = 'move_down' },
				},
				release = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.move_vertical_stop } },
					{ ['input.consume'] = 'move_down' },
				},
			},
		},
		{
			name = 'fire',
			priority = 8,
			on = { press = 'fire[j]' },
			['do'] = {
				press = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.fire } },
					{ ['input.consume'] = 'fire' },
				},
			},
		},
		{
			name = 'interact',
			priority = 8,
			on = { press = 'interact[j]' },
			['do'] = {
				press = {
					{ ['ability.request'] = { id = PLAYER_ABILITY_IDS.interact } },
					{ ['input.consume'] = 'interact' },
				},
			},
		},
	},
}

CORONA_SPAWN_LOCS = {
	{ x = SCREEN_WIDTH, y = 0 },
	{ x = SCREEN_WIDTH, y = SCREEN_HEIGHT - 16 },
}

INITIAL_INGREDIENTS = {
	{ kind = 'cucumber', x = 26, y = 40 },
	{ kind = 'tomato', x = 26, y = 88 },
	{ kind = 'knife', x = 26, y = 136 },
	{ kind = 'falafel', x = 100, y = 64 },
}

INITIAL_PITAS = {
	{ x = 100, y = 88 },
}

BOARD_POSITIONS = {
	{ x = 160, y = 74 },
	{ x = 160, y = 100 },
	{ x = 200, y = 74 },
	{ x = 200, y = 100 },
}

game_state = {
	boards = {},
	ingredients = {},
	corona = {},
	fires = {},
	spawn_timer = SPAWN_INTERVAL,
	pitas_served = 0,
	corona_count = 0,
	player = nil,
	player_id = nil,
	player_ability_component = nil,
}

local ability_definitions_ready = false

local function assert_sprite_id(component, context)
	if component.imgid == nil then
		error('Sprite missing image id for ' .. context)
	end
end

local function ingredient_sprite(kind)
	if kind == 'cucumber_sliced' then
		return SPRITES.cucumber_sliced
	elseif kind == 'tomato' then
		return SPRITES.tomato
	elseif kind == 'falafel' then
		return SPRITES.falafel
	elseif kind == 'knife' then
		return SPRITES.knife
	elseif kind == 'pita_filled' then
		return SPRITES.pita_filled
	end
	return SPRITES.pita
end

function fill_board(board)
	board.filled = true
	board.sprite.imgid = SPRITES.pita_filled
end

local function register_board(id, object)
	game_state.boards[id] = {
		id = id,
		object = object,
		sprite = object:getcomponentbyid('board_sprite'),
		filled = false,
	}
	assert_sprite_id(game_state.boards[id].sprite, 'board:' .. id)
end

local function register_ingredient(id, object, kind, contents)
	game_state.ingredients[id] = {
		id = id,
		object = object,
		sprite = object:getcomponentbyid('ingredient_sprite'),
		kind = kind,
		contents = contents or {},
		held = false,
	}
	assert_sprite_id(game_state.ingredients[id].sprite, 'ingredient:' .. id .. ':' .. kind)
end

local function release_inventory(state)
	local item = state.inventory_item
	item.held = false
	state.inventory_item = nil
end

local function ability_fire(ctx)
	local owner = ctx.owner
	local state = owner
	local direction = state.direction
	local dx = 0
	local dy = 1
	if direction == 'up' then
		dy = -1
	elseif direction == 'left' then
		dx = -1
		dy = 0
	elseif direction == 'right' then
		dx = 1
		dy = 0
	end
	spawn_fire(owner, dx, dy)
	sfx(SOUNDS.fire)
	ctx.dispatchMode('player.fire', nil, owner.id)
end

local function ability_interact(ctx)
	local owner = ctx.owner
	local state = owner
	local held = state.inventory_item

	if held and held.kind == 'knife' then
		for _, ingredient in pairs(state.touch_ingredients) do
			if ingredient.kind == 'cucumber' and not ingredient.held then
				ingredient.kind = 'cucumber_sliced'
				ingredient.object:getcomponentbyid('ingredient_sprite').imgid = SPRITES.cucumber_sliced
				release_inventory(state)
				sfx(SOUNDS.select)
				return
			end
		end
	end

	if held and held.kind == 'pita_filled' then
		for _, board in pairs(state.touch_boards) do
			if not board.filled then
				fill_board(board)
				game_state.pitas_served = game_state.pitas_served + 1
				release_inventory(state)
				sfx(SOUNDS.select)
				return
			end
		end
	end

	if held and held.kind ~= 'knife' and held.kind ~= 'pita_filled' then
		for _, target in pairs(state.touch_ingredients) do
			if target.kind == 'pita' then
				local contents = target.contents
				for index = 1, #contents do
					if contents[index] == held.kind then
						return
					end
				end
				contents[#contents + 1] = held.kind
				if held.kind == 'cucumber_sliced' then
					target.kind = 'pita_filled'
					target.object:getcomponentbyid('ingredient_sprite').imgid = SPRITES.pita_filled
				end
				release_inventory(state)
				sfx(SOUNDS.select)
				return
			end
		end
	end

	if not held then
		for _, ingredient in pairs(state.touch_ingredients) do
			if not ingredient.held then
				ingredient.held = true
				state.inventory_item = ingredient
				sfx(SOUNDS.select)
				return
			end
		end
	end
end

local function ability_move_horizontal(ctx, params)
	local owner = ctx.owner
	local state = owner
	local column = state.column
	local direction = params.direction
	local next_column = direction == 'left' and (column - 1) or (column + 1)
	if next_column < 1 or next_column > #COLUMN_X then
		return
	end
	state.switch_target = next_column
	state.horizontal_direction = direction
end

local function ability_move_horizontal_stop(ctx)
	local state = ctx.owner
	state.horizontal_direction = nil
	state.switch_target = nil
end

local function ability_move_vertical(ctx, params)
	local state = ctx.owner
	state.vertical_intent = params.direction
end

local function ability_move_vertical_stop(ctx)
	local state = ctx.owner
	state.vertical_intent = nil
end

local function ability_hurt(ctx, params)
	local owner = ctx.owner
	local state = owner
	state.vertical_intent = nil
	state.horizontal_direction = nil
	state.switch_target = nil
	state.hurt_remaining = PLAYER_HIT_RECOVERY
	sfx(SOUNDS.hurt)
	ctx.dispatchMode('player.hurt', params, owner.id)
end

local function ensure_player_ability_definitions()
	if ability_definitions_ready then
		return
	end

	define_ability({
		id = PLAYER_ABILITY_IDS.fire,
		cooldownMs = math.floor(PLAYER_FIRE_COOLDOWN * 1000),
		activation = ability_fire,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.interact,
		activation = ability_interact,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.move_horizontal,
		unique = 'ignore',
		activation = ability_move_horizontal,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.move_horizontal_stop,
		activation = ability_move_horizontal_stop,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.move_vertical,
		unique = 'ignore',
		activation = ability_move_vertical,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.move_vertical_stop,
		activation = ability_move_vertical_stop,
	})

	define_ability({
		id = PLAYER_ABILITY_IDS.hurt,
		cooldownMs = math.floor(PLAYER_HIT_RECOVERY * 1000),
		activation = ability_hurt,
	})

	ability_definitions_ready = true
end

local function initialize_player_abilities()
	ensure_player_ability_definitions()
	if game_state.player_abilities_granted then
		return
	end
	local player_id = game_state.player_id
	grant_ability(player_id, PLAYER_ABILITY_IDS.fire)
	grant_ability(player_id, PLAYER_ABILITY_IDS.interact)
	grant_ability(player_id, PLAYER_ABILITY_IDS.move_horizontal)
	grant_ability(player_id, PLAYER_ABILITY_IDS.move_horizontal_stop)
	grant_ability(player_id, PLAYER_ABILITY_IDS.move_vertical)
	grant_ability(player_id, PLAYER_ABILITY_IDS.move_vertical_stop)
	grant_ability(player_id, PLAYER_ABILITY_IDS.hurt)
	game_state.player_abilities_granted = true
end

local function setup_player_components(object)
	local abilities = object:getcomponentbyid('player_abilities')
	local input_component = object:getcomponentbyid('player_input')
	input_component.playerIndex = 1
	input_component.program = PLAYER_INPUT_PROGRAM

	game_state.player_ability_component = abilities
	game_state.player_abilities_granted = false
end

PlayerObject = {
	id = 'marlies2020.PlayerObject',
	class = 'PlayerObject',
	components = {
		{ class = 'SpriteComponent', id_local = 'player_sprite', imgid = SPRITES.player_down[1], layer = 'actors', colliderLocalId = 'player_collider' },
		{ class = 'Collider2DComponent', id_local = 'player_collider', isTrigger = true, generateOverlapEvents = true },
		{ class = 'AbilitySystemComponent', id_local = 'player_abilities' },
		{ class = 'InputAbilityComponent', id_local = 'player_input' },
	},
	fsm = 'marlies2020_player',
}

function PlayerObject:create(owner)
	owner.column = START_COLUMN
	owner.inventory_item = nil
	owner.touch_ingredients = {}
	owner.touch_boards = {}
	owner.touch_corona = {}
	owner.horizontal_direction = nil
	owner.switch_target = nil
	owner.vertical_intent = nil
	owner.direction = 'down'
	owner.hurt_remaining = nil
end

function PlayerObject:on_spawn()
	self.touch_ingredients = {}
	self.touch_boards = {}
	self.touch_corona = {}
	self.inventory_item = nil
	self.direction = 'down'
	self.hurt_remaining = nil

	setup_player_components(self)
	assert_sprite_id(self:getcomponentbyid('player_sprite'), 'player')

	local collider = self:getcomponentbyid('player_collider')
	collider.generateOverlapEvents = true
	collider.isTrigger = true

	local function begin_overlap(_, _, payload)
		local other = payload.otherId
		local ingredient = game_state.ingredients[other]
		if ingredient then
			self.touch_ingredients[other] = ingredient
		end
		local board = game_state.boards[other]
		if board then
			self.touch_boards[other] = board
		end
		if game_state.corona[other] then
			self.touch_corona[other] = true
			request_ability(self.id, PLAYER_ABILITY_IDS.hurt, { payload = { source = other } })
		end
	end

	local function end_overlap(_, _, payload)
		local other = payload.otherId
		self.touch_ingredients[other] = nil
		self.touch_boards[other] = nil
	self.touch_corona[other] = nil
	end

	events:on('overlapBegin', begin_overlap, self, { emitter = self.id, persistent = true })
	events:on('overlapEnd', end_overlap, self, { emitter = self.id, persistent = true })

	game_state.player = self
	game_state.player_id = self.id
	initialize_player_abilities()
end

function PlayerObject:on_dispose()
	if self.inventory_item then
		self.inventory_item.held = false
		self.inventory_item = nil
	end
	game_state.player = nil
	game_state.player_id = nil
	game_state.player_ability_component = nil
end

define_worldobject({
	id = PlayerObject.id,
	class = 'PlayerObject',
	components = PlayerObject.components,
	fsm = PlayerObject.fsm,
})

CoronaObject = {
	id = 'marlies2020.CoronaObject',
	class = 'CoronaObject',
	components = {
		{ class = 'SpriteComponent', id_local = 'corona_sprite', imgid = SPRITES.corona[1], layer = 'actors', colliderLocalId = 'corona_collider' },
		{ class = 'Collider2DComponent', id_local = 'corona_collider', isTrigger = true, generateOverlapEvents = true },
		{ class = 'ProhibitLeavingScreenComponent', id_local = 'corona_bounds' },
	},
	fsm = 'marlies2020_corona',
}
function CoronaObject:create(owner)
	owner.move_x = -1
	owner.move_y = 0
end

function CoronaObject:on_spawn()
	self.move_x = self.move_x or -1
	self.move_y = self.move_y or 0
	assert_sprite_id(self:getcomponentbyid('corona_sprite'), 'corona:' .. self.id)
	local collider = self:getcomponentbyid('corona_collider')
	collider.generateOverlapEvents = true
	collider.isTrigger = true

	local function handle_overlap(_, _, payload)
		local other = payload.otherId
		if game_state.fires[other] then
			self.sc:dispatch_event('dispel', self, { source = other })
		end
	end

	events:on('overlapBegin', handle_overlap, self, { emitter = self.id, persistent = true })
	attach_bt(self.id, 'marlies2020_corona_bt')
	self:tickTree('marlies2020_corona_bt')
	game_state.corona[self.id] = self
	game_state.corona_count = game_state.corona_count + 1
end

function CoronaObject:on_dispose()
	game_state.corona[self.id] = nil
	game_state.corona_count = game_state.corona_count - 1
end

define_worldobject({
	id = CoronaObject.id,
	class = 'CoronaObject',
	components = CoronaObject.components,
	fsm = CoronaObject.fsm,
})

FireObject = {
	id = 'marlies2020.FireObject',
	class = 'FireObject',
	components = {
		{ class = 'SpriteComponent', id_local = 'fire_sprite', imgid = SPRITES.fire[1], layer = 'actors', colliderLocalId = 'fire_collider' },
		{ class = 'Collider2DComponent', id_local = 'fire_collider', isTrigger = true, generateOverlapEvents = true, spaceEvents = 'current' },
		{ class = 'ScreenBoundaryComponent', id_local = 'fire_bounds' },
	},
	fsm = 'marlies2020_fire',
}
function FireObject:create(owner)
	owner.vx = 0
	owner.vy = 0
	owner.life = FIRE_LIFETIME
end

function FireObject:on_spawn()
	assert_sprite_id(self:getcomponentbyid('fire_sprite'), 'fire:' .. self.id)
	local collider = self:getcomponentbyid('fire_collider')
	collider.generateOverlapEvents = true
	collider.isTrigger = true

	local function hit_corona(_, _, payload)
		local other = payload.otherId
		if game_state.corona[other] then
			despawn(other)
		end
	end

	local function leave_screen()
		despawn(self.id)
	end

	events:on('overlapBegin', hit_corona, self, { emitter = self.id, persistent = true })
	events:on('leaveScreen', leave_screen, self, { emitter = self.id, persistent = true })
	game_state.fires[self.id] = self
end

function FireObject:on_dispose()
	game_state.fires[self.id] = nil
end

define_worldobject({
	id = FireObject.id,
	class = 'FireObject',
	components = FireObject.components,
	fsm = FireObject.fsm,
})

function reset_game_state()
	if game_state.player_id then
		despawn(game_state.player_id)
	end
	for id, board in pairs(game_state.boards) do
		despawn(board.id)
		game_state.boards[id] = nil
	end
	for id in pairs(game_state.ingredients) do
		despawn(id)
		game_state.ingredients[id] = nil
	end
	for id in pairs(game_state.corona) do
		despawn(id)
		game_state.corona[id] = nil
	end
	for id in pairs(game_state.fires) do
		despawn(id)
		game_state.fires[id] = nil
	end
	if game_state.background_id then
		despawn(game_state.background_id)
	end
	if game_state.inventory_id then
		despawn(game_state.inventory_id)
	end
	if game_state.victory_id then
		despawn(game_state.victory_id)
	end
	game_state.player = nil
	game_state.player_id = nil
	game_state.player_ability_component = nil
	game_state.player_abilities_granted = false
	game_state.corona_count = 0
	game_state.spawn_timer = SPAWN_INTERVAL
	game_state.pitas_served = 0
	game_state.victory = false
	game_state.boards = {}
	game_state.ingredients = {}
	game_state.corona = {}
	game_state.fires = {}
	game_state.background_id = nil
	game_state.inventory_id = nil
	game_state.victory_id = nil
end

function spawn_fire(owner, dx, dy)
	local id = spawn_world_object('marlies2020.FireObject', {
		position = { x = owner.x + dx * 12, y = owner.y + dy * 12, z = owner.z + 100 },
	})
	local object = registry:get(id)
	local state = object
	state.vx = dx * FIRE_SPEED
	state.vy = dy * FIRE_SPEED
	state.life = FIRE_LIFETIME
	game_state.fires[id] = object
	return id, object
end

local function spawn_background()
	local previous = game_state.background_id
	if previous then
		despawn(previous)
	end
	game_state.background_id = spawn_world_object('WorldObject', {
		position = { x = 0, y = 0, z = 0 },
		components = {
			{ class = 'SpriteComponent', id_local = 'sprite', imgid = SPRITES.background, layer = 'bg', colliderLocalId = nil },
		},
	})
	local object = registry:get(game_state.background_id)
	assert_sprite_id(object:getcomponentbyid('sprite'), 'background')
end

local function spawn_inventory_frame()
	local previous = game_state.inventory_id
	if previous then
		despawn(previous)
	end
	game_state.inventory_id = spawn_world_object('WorldObject', {
		position = { x = INVENTORY_POS.x - 4, y = INVENTORY_POS.y - 4, z = INVENTORY_POS.z - 1 },
		components = {
			{ class = 'SpriteComponent', id_local = 'sprite', imgid = SPRITES.inventory, layer = 'ui', colliderLocalId = nil },
		},
	})
	local object = registry:get(game_state.inventory_id)
	assert_sprite_id(object:getcomponentbyid('sprite'), 'inventory_frame')
end

local function spawn_board(position)
	local id = spawn_world_object('WorldObject', {
		position = { x = position.x, y = position.y, z = 800 },
		components = {
			{ class = 'SpriteComponent', id_local = 'board_sprite', imgid = SPRITES.board, layer = 'actors', colliderLocalId = 'board_collider' },
			{ class = 'Collider2DComponent', id_local = 'board_collider', isTrigger = true, generateOverlapEvents = true },
		},
	})
	local object = registry:get(id)
	register_board(id, object)
end

local function spawn_ingredient(def)
	local id = spawn_world_object('WorldObject', {
		position = { x = def.x, y = def.y, z = 950 },
		components = {
			{ class = 'SpriteComponent', id_local = 'ingredient_sprite', imgid = ingredient_sprite(def.kind), layer = 'actors', colliderLocalId = 'ingredient_collider' },
			{ class = 'Collider2DComponent', id_local = 'ingredient_collider', isTrigger = true, generateOverlapEvents = true },
		},
	})
	local object = registry:get(id)
	register_ingredient(id, object, def.kind, def.contents)
end

local function spawn_player()
	spawn_world_object('marlies2020.PlayerObject', {
		position = { x = COLUMN_X[START_COLUMN], y = 16, z = 1000 },
	})
end

local function spawn_corona(x, y)
	local id = spawn_world_object('marlies2020.CoronaObject', {
		position = { x = x, y = y, z = 900 },
	})
	local object = registry:get(id)
	local state = object
	state.move_x = x <= 0 and 1 or -1
	state.move_y = 0
end

local function spawn_world()
	spawn_background()
	spawn_inventory_frame()
	for index = 1, #BOARD_POSITIONS do
		spawn_board(BOARD_POSITIONS[index])
	end
	for index = 1, #INITIAL_INGREDIENTS do
		spawn_ingredient(INITIAL_INGREDIENTS[index])
	end
	for index = 1, #INITIAL_PITAS do
		spawn_ingredient({ kind = 'pita', x = INITIAL_PITAS[index].x, y = INITIAL_PITAS[index].y, contents = {} })
	end
	spawn_player()
end

local function spawn_victory_sprite()
	local previous = game_state.victory_id
	if previous then
		despawn(previous)
	end
	game_state.victory_id = spawn_world_object('WorldObject', {
		position = { x = 96, y = 80, z = 1100 },
		components = {
			{ class = 'SpriteComponent', id_local = 'victory_sprite', imgid = SPRITES.sint, layer = 'actors', colliderLocalId = nil },
		},
	})
	local object = registry:get(game_state.victory_id)
	assert_sprite_id(object:getcomponentbyid('victory_sprite'), 'victory')
end

local function advance_spawn_timer(delta)
	game_state.spawn_timer = game_state.spawn_timer - delta
	if game_state.spawn_timer <= 0 and game_state.corona_count < MAX_CORONA then
		game_state.spawn_timer = SPAWN_INTERVAL + math.random()
		local spawn_right = math.random(1, 2) == 1
		local x = spawn_right and (SCREEN_WIDTH + 16) or -16
		local y = math.random(8, SCREEN_HEIGHT - 24)
		spawn_corona(x, y)
	end
end

function init()
	math.randomseed(os.time())
	reset_game_state()
	ensure_player_ability_definitions()
	spawn_world()
end

function update(delta)
	if game_state.victory then
		if not game_state.victory_id then
			spawn_victory_sprite()
		end
	else
		advance_spawn_timer(delta)
		if game_state.pitas_served >= PITAS_REQUIRED then
			game_state.victory = true
			if game_state.player then
				game_state.player.sc:dispatch_event('player.win', game_state.player)
			end
			spawn_victory_sprite()
		end
	end
end

function draw()
	local text_y = INVENTORY_POS.y + 24
	print('Pitas: ' .. tostring(game_state.pitas_served) .. '/' .. tostring(PITAS_REQUIRED), 4, text_y, 10)
	if game_state.victory then
		print('Hoera!', 96, 12, 11)
	end
end
