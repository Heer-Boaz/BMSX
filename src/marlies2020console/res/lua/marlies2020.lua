local BUTTON_LEFT = 0
local BUTTON_RIGHT = 1
local BUTTON_UP = 2
local BUTTON_DOWN = 3
local BUTTON_O = 4
local BUTTON_X = 5

local SCREEN_WIDTH = 256
local SCREEN_HEIGHT = 212

local COLUMN_X = { 36, 48, 80, 160, 200 }
local START_COLUMN = 2
local INVENTORY_POS = { x = 12, y = 12 }

local MAX_CORONA = 3
local SPAWN_INTERVAL = 3.2
local MIN_CORONA_MOVE = 16
local MAX_CORONA_MOVE = 72
local CORONA_SPEED = 55
local CORONA_FRAME_INTERVAL = 0.14
local FIRE_LIFETIME = 0.45
local FIRE_SPEED = 180
local FIRE_FRAME_INTERVAL = 0.05
local PLAYER_MOVE_SPEED = 96
local PLAYER_SWITCH_SPEED = 140
local PLAYER_HIT_RECOVERY = 1.0
local PLAYER_ANIM_INTERVAL = 0.12
local PITAS_REQUIRED = 1

local SOUND_FIRE = 'init'
local SOUND_SELECT = 'selectie'
local SOUND_HIT = 'fout'

local CORONA_SPAWN_LOCS = {
	{ x = SCREEN_WIDTH, y = 0 },
	{ x = SCREEN_WIDTH, y = SCREEN_HEIGHT - 1 },
}

local INITIAL_INGREDIENTS = {
	{ type = 'komkommer', x = 26, y = 40 },
	{ type = 'tomaatjes', x = 26, y = 88 },
	{ type = 'mes', x = 26, y = 136 },
	{ type = 'falafel', x = 100, y = 64 },
}

local INITIAL_PITAS = {
	{ x = 100, y = 88 },
}

local BOARD_POSITIONS = {
	{ x = 160, y = 74 },
	{ x = 160, y = 100 },
	{ x = 200, y = 74 },
	{ x = 200, y = 100 },
}

local SPRITES = {
	background = 'keuken',
	inventory = 'invframe',
	board = 'bord',
	pita = 'pita',
	pitaFilled = 'pitagevuld',
	komkommer = 'komkommer',
	komkommerSliced = 'komkommer_gesneden',
	tomaatjes = 'tomaatjes',
	falafel = 'falafel',
	mes = 'mes',
	extinguisher = 'brandblusser',
	playerDown = { 'p1', 'p2', 'p3', 'p2' },
	playerUp = { 'p4', 'p5', 'p6', 'p5' },
	playerSwitch = 'p7',
	playerHurt = { 'p8', 'p9' },
	playerWin = 'p10',
	corona = { 'corona1', 'corona2', 'corona3', 'corona2' },
	fire = { 'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10' },
}

local state = {
	frame = 0,
	player = nil,
	boards = {},
	ingredients = {},
	coronae = {},
	fires = {},
	extinguisher = nil,
	inventory = nil,
	spawnTimer = SPAWN_INTERVAL,
	pitasServed = 0,
	win = false,
}

local idCounters = {
	ingredient = 0,
	board = 0,
	corona = 0,
	fire = 0,
}

local function next_id(prefix)
	idCounters[prefix] = idCounters[prefix] + 1
	return prefix .. '_' .. tostring(idCounters[prefix])
end

local function collider_center(x, y, width, height)
	return x + width / 2, y + height / 2
end

local function create_player()
    collider_create('player', { kind = 'box', width = 12, height = 16, layer = 1, isTrigger = true })
	return {
		x = COLUMN_X[START_COLUMN],
		y = 16,
		column = START_COLUMN,
		targetColumn = START_COLUMN,
		switching = false,
		switchDir = 0,
		direction = 'down',
		animTimer = 0,
		animIndex = 1,
		fireCooldown = 0,
		hitTimer = 0,
		mode = 'normal',
		flipH = false,
	}
end

local function get_sprite_for_ingredient_type(ingredientType)
	if ingredientType == 'komkommer' then
		return SPRITES.komkommer
	elseif ingredientType == 'gesneden_komkommer' then
		return SPRITES.komkommerSliced
	elseif ingredientType == 'tomaatjes' then
		return SPRITES.tomaatjes
	elseif ingredientType == 'falafel' then
		return SPRITES.falafel
	elseif ingredientType == 'mes' then
		return SPRITES.mes
	elseif ingredientType == 'gevulde_pita' then
		return SPRITES.pitaFilled
	else
		return SPRITES.pita
	end
end

local function create_ingredient(def)
	local id = next_id('ingredient')
    collider_create(id, { kind = 'box', width = 16, height = 16, layer = 1, isTrigger = true })
	return {
		id = id,
		type = def.type,
		sprite = get_sprite_for_ingredient_type(def.type),
		x = def.x,
		y = def.y,
		ingredients = def.ingredients or {},
	}
end

local function create_board(pos)
	local id = next_id('board')
    collider_create(id, { kind = 'box', width = 16, height = 16, layer = 1, isTrigger = true })
	return {
		id = id,
		x = pos.x,
		y = pos.y,
		filled = false,
	}
end

local function create_corona(spawn)
	local id = next_id('corona')
    collider_create(id, { kind = 'box', width = 16, height = 16, layer = 1, isTrigger = true })
	local dirs = { 'left', 'right', 'up', 'down' }
	return {
		id = id,
		x = spawn.x,
		y = spawn.y,
		direction = dirs[math.random(1, #dirs)],
		moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE),
		animTimer = 0,
		animIndex = 1,
	}
end

local function create_fire(x, y, direction)
	local id = next_id('fire')
	collider_create(id, { kind = 'box', width = 12, height = 12, layer = 1, isTrigger = true })
	return {
		id = id,
		x = x,
		y = y,
		direction = direction,
		lifetime = 0,
		animTimer = 0,
		animIndex = 1,
	}
end

local function reset_game_state()
	state.player = create_player()
	state.boards = {}
	state.ingredients = {}
	state.coronae = {}
	state.fires = {}
	state.extinguisher = nil
	state.inventory = nil
	state.spawnTimer = SPAWN_INTERVAL
	state.pitasServed = 0
	state.win = false

	for _, pos in ipairs(BOARD_POSITIONS) do
		state.boards[#state.boards + 1] = create_board(pos)
	end
	for _, def in ipairs(INITIAL_INGREDIENTS) do
		state.ingredients[#state.ingredients + 1] = create_ingredient(def)
	end
	for _, def in ipairs(INITIAL_PITAS) do
		local ingredient = create_ingredient({ type = 'pita', x = def.x, y = def.y, ingredients = {} })
		state.ingredients[#state.ingredients + 1] = ingredient
	end
end

local function set_player_column(player, column)
	player.column = column
	player.targetColumn = column
end

local function can_switch_left(y, column)
	if column == 1 then
		return false
	elseif column == 2 then
		return y >= 144
	elseif column == 3 then
		return true
	elseif column == 4 then
		return y <= 12 or y >= 144
	elseif column == 5 then
		return true
	end
	return false
end

local function can_switch_right(y, column)
	if column == 1 or column == 2 then
		return true
	elseif column == 3 then
		return y <= 12 or y >= 144
	elseif column == 4 then
		return true
	elseif column == 5 then
		return false
	end
	return false
end

local function set_player_state(player, mode)
	if player.mode == mode then
		return
	end
	player.mode = mode
	player.animTimer = 0
	player.animIndex = 1
end

local function try_start_switch(direction)
	local player = state.player
	if state.win or player.mode == 'hurt' then
		return
	end
	if direction == 'left' then
		if not can_switch_left(player.y, player.column) then
			return
		end
		player.switching = true
		player.switchDir = -1
		player.targetColumn = player.column - 1
		player.direction = 'left'
		player.flipH = true
	elseif direction == 'right' then
		if not can_switch_right(player.y, player.column) then
			return
		end
		player.switching = true
		player.switchDir = 1
		player.targetColumn = player.column + 1
		player.direction = 'right'
		player.flipH = false
	end
	if player.switching then
		set_player_state(player, 'switch')
	end
end

local function update_player_switch(delta)
	local player = state.player
	if not player.switching then
		return
	end
	local targetX = COLUMN_X[player.targetColumn]
	if player.switchDir < 0 then
		player.x = player.x - PLAYER_SWITCH_SPEED * delta
		if player.x <= targetX then
			player.x = targetX
			player.switching = false
			set_player_column(player, player.targetColumn)
			player.direction = 'down'
			player.flipH = false
			set_player_state(player, 'normal')
		end
	else
		player.x = player.x + PLAYER_SWITCH_SPEED * delta
		if player.x >= targetX then
			player.x = targetX
			player.switching = false
			set_player_column(player, player.targetColumn)
			player.direction = 'down'
			player.flipH = false
			set_player_state(player, 'normal')
		end
	end
end

local function clamp(value, minv, maxv)
	if value < minv then
		return minv
	elseif value > maxv then
		return maxv
	end
	return value
end

local function update_player_movement(delta)
	local player = state.player
	if player.switching or player.mode == 'hurt' or state.win then
		return
	end
	local moved = false
	if btn(BUTTON_UP) then
		if player.y >= 4 and player.column ~= 1 then
			if player.column ~= 4 and player.column ~= 5 or player.y > 104 or player.y <= 80 then
				player.y = player.y - PLAYER_MOVE_SPEED * delta
				moved = true
			end
		end
		player.direction = 'up'
		player.flipH = false
	elseif btn(BUTTON_DOWN) then
		if player.y <= SCREEN_HEIGHT - 32 and player.column ~= 1 then
			if player.column ~= 4 and player.column ~= 5 or player.y < 44 or player.y >= 80 then
				player.y = player.y + PLAYER_MOVE_SPEED * delta
				moved = true
			end
		end
		player.direction = 'down'
		player.flipH = false
	end
	player.y = clamp(player.y, 4, SCREEN_HEIGHT - 32)

	if btnp(BUTTON_LEFT) then
		try_start_switch('left')
	elseif btnp(BUTTON_RIGHT) then
		try_start_switch('right')
	end

	if moved and player.mode == 'normal' then
		player.animTimer = player.animTimer + delta
		if player.animTimer >= PLAYER_ANIM_INTERVAL then
			player.animTimer = player.animTimer - PLAYER_ANIM_INTERVAL
			player.animIndex = player.animIndex % #SPRITES.playerDown + 1
		end
	else
		player.animIndex = 1
		player.animTimer = 0
	end
end

local function spawn_fire_effect()
	local player = state.player
	if state.win or player.mode == 'hurt' then
		return
	end
	if player.fireCooldown > 0 then
		return
	end
	player.fireCooldown = PLAYER_HIT_RECOVERY * 0.5
	local baseX = player.x
	local baseY = player.y
	local direction = player.direction
	if direction == 'down' then
		baseY = baseY + 20
	elseif direction == 'up' then
		baseY = baseY - 8
	elseif direction == 'right' then
		baseX = baseX + 12
		baseY = baseY + 12
	elseif direction == 'left' then
		baseX = baseX - 12
		baseY = baseY + 12
	end
	for i = 1, 3 do
		local offsetX = math.random(-8, 8)
		local offsetY = math.random(-4, 4)
		local fire = create_fire(baseX + offsetX, baseY + offsetY, direction)
		state.fires[#state.fires + 1] = fire
	end
	state.extinguisher = { timer = 0, duration = 0.3 }
	sfx(SOUND_FIRE)
end

local function has_inventory()
	return state.inventory ~= nil
end

local function clear_inventory()
	state.inventory = nil
end

local function pick_up_ingredient(index)
	if has_inventory() then
		return
	end
	local ingredient = table.remove(state.ingredients, index)
if ingredient then
	collider_destroy(ingredient.id)
		ingredient.x = INVENTORY_POS.x
		ingredient.y = INVENTORY_POS.y
		state.inventory = ingredient
		sfx(SOUND_SELECT)
	end
end

local function convert_cucumber(ingredient)
	ingredient.type = 'gesneden_komkommer'
	ingredient.sprite = SPRITES.komkommerSliced
end

local function try_slice_cucumber(ingredient)
	if not state.inventory then
		return false
	end
	if state.inventory.type ~= 'mes' then
		return false
	end
	if ingredient.type ~= 'komkommer' then
		return false
	end
	convert_cucumber(ingredient)
	clear_inventory()
	sfx(SOUND_SELECT)
	return true
end

local function try_fill_pita(pita)
	if not state.inventory then
		return false
	end
	local invType = state.inventory.type
	if invType ~= 'gesneden_komkommer' and invType ~= 'tomaatjes' and invType ~= 'falafel' then
		return false
	end
	for _, existing in ipairs(pita.ingredients) do
		if existing == invType then
			return false
		end
	end
	pita.ingredients[#pita.ingredients + 1] = invType
	if #pita.ingredients >= 3 then
		pita.type = 'gevulde_pita'
		pita.sprite = SPRITES.pitaFilled
	end
	clear_inventory()
	sfx(SOUND_SELECT)
	return true
end

local function place_pita_on_board(board)
	if not state.inventory or state.inventory.type ~= 'gevulde_pita' then
		return false
	end
	board.filled = true
	clear_inventory()
	state.pitasServed = state.pitasServed + 1
	if state.pitasServed >= PITAS_REQUIRED then
		state.win = true
		set_player_state(state.player, 'win')
	end
	sfx(SOUND_SELECT)
	return true
end

local function colliders_overlap(a, b)
	if not a or not b then
		return false
	end
	if not collider_overlap(a, b) then
		return false
	end
	return true
end

local function try_interact_with_world()
	local player = state.player
	if player.mode == 'hurt' then
		return
	end
	local playerCollider = 'player'
	for index = #state.ingredients, 1, -1 do
		local ingredient = state.ingredients[index]
		if ingredient and colliders_overlap(playerCollider, ingredient.id) then
			if try_slice_cucumber(ingredient) then
				return
			end
			if ingredient.type == 'pita' then
				if try_fill_pita(ingredient) then
					return
				end
			elseif ingredient.type ~= 'komkommer' then
				pick_up_ingredient(index)
				return
			end
		end
	end
	for _, board in ipairs(state.boards) do
		if not board.filled and colliders_overlap(playerCollider, board.id) then
			if place_pita_on_board(board) then
				return
			end
		end
	end
end

local function handle_player_hit()
	local player = state.player
	if state.win or player.mode == 'hurt' then
		return
	end
	player.hitTimer = PLAYER_HIT_RECOVERY
	set_player_state(player, 'hurt')
	player.flipH = false
	player.direction = 'down'
	sfx(SOUND_HIT)
end

local function update_player(delta)
	local player = state.player
	if player.fireCooldown > 0 then
		player.fireCooldown = math.max(player.fireCooldown - delta, 0)
	end
	if player.mode == 'hurt' then
		player.hitTimer = player.hitTimer - delta
		if player.hitTimer <= 0 then
			set_player_state(player, 'normal')
			player.hitTimer = 0
		else
			player.animTimer = player.animTimer + delta
			if player.animTimer >= PLAYER_ANIM_INTERVAL * 0.5 then
				player.animTimer = player.animTimer - PLAYER_ANIM_INTERVAL * 0.5
				player.animIndex = player.animIndex % #SPRITES.playerHurt + 1
			end
		end
		return
	end
	update_player_switch(delta)
	update_player_movement(delta)
end

local function update_corona(delta)
	local playerCollider = 'player'
	for index = #state.coronae, 1, -1 do
		local corona = state.coronae[index]
		if corona then
			local move = CORONA_SPEED * delta
			if corona.direction == 'left' then
				corona.x = corona.x - move
			elseif corona.direction == 'right' then
				corona.x = corona.x + move
			elseif corona.direction == 'up' then
				corona.y = corona.y - move
			else
				corona.y = corona.y + move
			end
			if corona.x <= -16 then
				corona.x = -16
				corona.direction = 'right'
				corona.moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
			elseif corona.x >= SCREEN_WIDTH then
				corona.x = SCREEN_WIDTH
				corona.direction = 'left'
				corona.moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
			end
			if corona.y <= -16 then
				corona.y = -16
				corona.direction = 'down'
				corona.moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
			elseif corona.y >= SCREEN_HEIGHT - 16 then
				corona.y = SCREEN_HEIGHT - 16
				corona.direction = 'up'
				corona.moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
			end
			corona.moveRemaining = corona.moveRemaining - move
			if corona.moveRemaining <= 0 then
				local dirs = { 'left', 'right', 'up', 'down' }
				corona.direction = dirs[math.random(1, #dirs)]
				corona.moveRemaining = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
			end
			corona.animTimer = corona.animTimer + delta
			if corona.animTimer >= CORONA_FRAME_INTERVAL then
				corona.animTimer = corona.animTimer - CORONA_FRAME_INTERVAL
				corona.animIndex = corona.animIndex % #SPRITES.corona + 1
			end
		collider_set_position(corona.id, corona.x + 8, corona.y + 8)
			if colliders_overlap(playerCollider, corona.id) then
				handle_player_hit()
			else
				for fireIndex = #state.fires, 1, -1 do
					local fire = state.fires[fireIndex]
		if fire and colliders_overlap(corona.id, fire.id) then
			collider_destroy(corona.id)
						table.remove(state.coronae, index)
		collider_destroy(fire.id)
						table.remove(state.fires, fireIndex)
						break
					end
				end
			end
		end
	end
end

local function update_fires(delta)
	for index = #state.fires, 1, -1 do
		local fire = state.fires[index]
		fire.lifetime = fire.lifetime + delta
		if fire.lifetime >= FIRE_LIFETIME then
			collider_destroy(fire.id)
			table.remove(state.fires, index)
		else
			local move = FIRE_SPEED * delta
			if fire.direction == 'left' then
				fire.x = fire.x - move
			elseif fire.direction == 'right' then
				fire.x = fire.x + move
			elseif fire.direction == 'up' then
				fire.y = fire.y - move
			else
				fire.y = fire.y + move
			end
			fire.animTimer = fire.animTimer + delta
			if fire.animTimer >= FIRE_FRAME_INTERVAL then
				fire.animTimer = fire.animTimer - FIRE_FRAME_INTERVAL
				fire.animIndex = fire.animIndex % #SPRITES.fire + 1
			end
		collider_set_position(fire.id, fire.x + 6, fire.y + 6)
		end
	end
end

local function update_extinguisher(delta)
	if not state.extinguisher then
		return
	end
	state.extinguisher.timer = state.extinguisher.timer + delta
	if state.extinguisher.timer >= state.extinguisher.duration then
		state.extinguisher = nil
	end
end

local function update_spawn(delta)
	if state.win then
		return
	end
	if #state.coronae >= MAX_CORONA then
		return
	end
	state.spawnTimer = state.spawnTimer - delta
	if state.spawnTimer <= 0 then
		local spawn = CORONA_SPAWN_LOCS[math.random(1, #CORONA_SPAWN_LOCS)]
		state.coronae[#state.coronae + 1] = create_corona(spawn)
		state.spawnTimer = SPAWN_INTERVAL
	end
end

local function update_colliders()
	local player = state.player
	local playerCenterX, playerCenterY = player.x + 8, player.y + 24
	collider_set_position('player', playerCenterX, playerCenterY)
	for _, ingredient in ipairs(state.ingredients) do
		collider_set_position(ingredient.id, ingredient.x + 8, ingredient.y + 8)
	end
	for _, board in ipairs(state.boards) do
		collider_set_position(board.id, board.x + 8, board.y + 8)
	end
end

local function draw_background()
	spr(SPRITES.background, 0, 0, { layer = 'bg' })
end

local function draw_boards()
	for _, board in ipairs(state.boards) do
		spr(SPRITES.board, math.floor(board.x), math.floor(board.y), { layer = 'actors' })
		if board.filled then
			spr(SPRITES.pitaFilled, math.floor(board.x), math.floor(board.y), { layer = 'actors' })
		end
	end
end

local function draw_ingredients()
	for _, ingredient in ipairs(state.ingredients) do
		spr(ingredient.sprite, math.floor(ingredient.x), math.floor(ingredient.y), { layer = 'actors' })
	end
	if state.inventory then
		spr(state.inventory.sprite, INVENTORY_POS.x, INVENTORY_POS.y, { layer = 'ui' })
	end
end

local function draw_corona()
	for _, corona in ipairs(state.coronae) do
		local frame = SPRITES.corona[corona.animIndex]
		spr(frame, math.floor(corona.x), math.floor(corona.y), { layer = 'actors' })
	end
end

local function draw_fires()
	for _, fire in ipairs(state.fires) do
		local frame = SPRITES.fire[fire.animIndex]
		spr(frame, math.floor(fire.x), math.floor(fire.y), { layer = 'actors' })
	end
	if state.extinguisher then
		local player = state.player
		spr(SPRITES.extinguisher, math.floor(player.x), math.floor(player.y + 12), { layer = 'actors' })
	end
end

local function draw_player()
	local player = state.player
	local frame
	if player.mode == 'win' then
		frame = SPRITES.playerWin
	elseif player.mode == 'hurt' then
		frame = SPRITES.playerHurt[player.animIndex]
	elseif player.switching then
		frame = SPRITES.playerSwitch
	elseif player.direction == 'up' then
		frame = SPRITES.playerUp[player.animIndex]
	else
		frame = SPRITES.playerDown[player.animIndex]
	end
	spr(frame, math.floor(player.x), math.floor(player.y), { layer = 'actors', flipH = player.flipH })
end

local function draw_ui()
	print('Held: ' .. (state.inventory and state.inventory.type or '--'), 4, 4, 7)
	print('Pitas: ' .. tostring(state.pitasServed) .. '/' .. tostring(PITAS_REQUIRED), 4, 12, 10)
	if state.win then
		print('Hoera!', 96, 12, 11)
	end
end

function init()
	math.randomseed(os.time())
	collider_clear()
	reset_game_state()
end

function update(delta)
	state.frame = state.frame + 1
	update_player(delta)
	update_spawn(delta)
	update_corona(delta)
	update_fires(delta)
	update_extinguisher(delta)
	update_colliders()

	if state.player.mode ~= 'hurt' and not state.player.switching and not state.win then
		if btnp(BUTTON_X) then
			try_interact_with_world()
		end
	end
	if btn(BUTTON_O) and not state.player.switching and state.player.mode ~= 'hurt' then
		spawn_fire_effect()
	end
	if state.player.mode == 'normal' then
		state.player.animTimer = state.player.animTimer + delta
		if state.player.animTimer >= PLAYER_ANIM_INTERVAL then
			state.player.animTimer = state.player.animTimer - PLAYER_ANIM_INTERVAL
			state.player.animIndex = state.player.animIndex % #SPRITES.playerDown + 1
		end
	end
end

function draw()
	cls(0)
	draw_background()
	draw_boards()
	draw_ingredients()
	draw_corona()
	draw_fires()
	draw_player()
	spr(SPRITES.inventory, INVENTORY_POS.x - 4, INVENTORY_POS.y - 4, { layer = 'ui' })
	draw_ui()
end
