screen_width = 256
screen_height = 212

column_x = {36, 48, 80, 160, 200}
start_column = 2
inventory_pos = {
    x = 12,
    y = 12,
    z = 2000
}

max_corona = 3
spawn_interval = 3.0
min_corona_move = 16
max_corona_move = 72
corona_speed = 55
corona_frame_ticks = 6
fire_speed = 180
fire_lifetime = 0.45
fire_frame_ticks = 2
player_move_speed = 96
player_switch_speed = 140
player_hit_recovery = 1.1
player_fire_cooldown = 0.35
player_frame_ticks = 4
pitas_required = 1

sounds = {
    fire = 'init',
    select = 'selectie',
    hurt = 'fout'
}

sprites = {
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
    player_down = {'p1', 'p2', 'p3', 'p2'},
    player_up = {'p4', 'p5', 'p6', 'p5'},
    player_switch = {'p7'},
    player_hurt = {'p8', 'p9'},
    player_win = {'p10'},
    corona = {'corona1', 'corona2', 'corona3', 'corona2'},
    fire = {'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10'},
    sint = 'sint'
}

local abilities = require('src/marlies2020console/marlies2020_abilities')
require('src/marlies2020console/marlies2020_systems')
require('src/marlies2020console/marlies2020_worldobjects')

local playerabilityids = abilities.abilityids
local playerinputprogram = abilities.inputprogram
local playerabilitygrantorder = abilities.abilityorder

player_ability_ids = playerabilityids
player_ability_order = playerabilitygrantorder
player_input_program = playerinputprogram

corona_spawn_locs = {{
    x = screen_width,
    y = 0
}, {
    x = screen_width,
    y = screen_height - 16
}}

initial_ingredients = {{
    kind = 'cucumber',
    x = 26,
    y = 40
}, {
    kind = 'tomato',
    x = 26,
    y = 88
}, {
    kind = 'knife',
    x = 26,
    y = 136
}, {
    kind = 'falafel',
    x = 100,
    y = 64
}}

initial_pitas = {{
    x = 100,
    y = 88
}}

board_positions = {{
    x = 160,
    y = 74
}, {
    x = 160,
    y = 100
}, {
    x = 200,
    y = 74
}, {
    x = 200,
    y = 100
}}

game_state = {
    boards = {},
    ingredients = {},
    corona = {},
    fires = {},
    spawn_timer = spawn_interval,
    pitas_served = 0,
    corona_count = 0,
    player = nil,
    player_id = nil
}

local ability_definitions_ready = false

local function ingredient_sprite(kind)
    if kind == 'cucumber_sliced' then
        return sprites.cucumber_sliced
    elseif kind == 'tomato' then
        return sprites.tomato
    elseif kind == 'falafel' then
        return sprites.falafel
    elseif kind == 'knife' then
        return sprites.knife
    elseif kind == 'pita_filled' then
        return sprites.pita_filled
    end
    return sprites.pita
end

function fill_board(board)
    board.filled = true
    board.sprite.imgid = sprites.pita_filled
end

local function register_board(id, object)
    game_state.boards[id] = {
        id = id,
        object = object,
        sprite = object:getcomponentbyid('board_sprite'),
        filled = false
    }
end

local function register_ingredient(id, object, kind, contents)
    local sprite = object:getcomponentbyid('ingredient_sprite')
    game_state.ingredients[id] = {
        id = id,
        object = object,
        sprite = sprite,
        kind = kind,
        contents = contents or {},
        held = false
    }
    sprite.imgid = ingredient_sprite(kind)
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
    sfx(sounds.fire)
    ctx.dispatchmode('player.fire', nil, owner.id)
end

local function ability_interact(ctx)
    local owner = ctx.owner
    local state = owner
    local held = state.inventory_item

    if held and held.kind == 'knife' then
        for _, ingredient in pairs(state.touch_ingredients) do
            if ingredient.kind == 'cucumber' and not ingredient.held then
                ingredient.kind = 'cucumber_sliced'
                ingredient.object:getcomponentbyid('ingredient_sprite').imgid = sprites.cucumber_sliced
                release_inventory(state)
                sfx(sounds.select)
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
                sfx(sounds.select)
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
                    target.object:getcomponentbyid('ingredient_sprite').imgid = sprites.pita_filled
                end
                release_inventory(state)
                sfx(sounds.select)
                return
            end
        end
    end

    if not held then
        for _, ingredient in pairs(state.touch_ingredients) do
            if not ingredient.held then
                ingredient.held = true
                state.inventory_item = ingredient
                sfx(sounds.select)
                return
            end
        end
    end
end

local function ability_move_horizontal(ctx, params)
    local payload = params or ctx.payload
    if not payload then
        return
    end
    local direction = payload.direction
    if not direction then
        return
    end
    local owner = ctx.owner
    local state = owner
    local column = state.column
    local next_column = direction == 'left' and (column - 1) or (column + 1)
    if next_column < 1 or next_column > #column_x then
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
    local payload = params or ctx.payload
    if not payload then
        return
    end
    local direction = payload.direction
    if not direction then
        return
    end
    local state = ctx.owner
    state.vertical_intent = direction
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
    state.hurt_remaining = player_hit_recovery
    sfx(sounds.hurt)
    ctx.dispatchmode('player.hurt', params, owner.id)
end

local function ensure_player_ability_definitions()
    if ability_definitions_ready then
        return
    end

    define_ability({
        id = playerabilityids.fire,
        cooldownms = math.floor(player_fire_cooldown * 1000),
        activation = ability_fire
    })

    define_ability({
        id = playerabilityids.interact,
        activation = ability_interact
    })

    define_ability({
        id = playerabilityids.move_horizontal,
        unique = 'ignore',
        activation = ability_move_horizontal
    })

    define_ability({
        id = playerabilityids.move_horizontal_stop,
        activation = ability_move_horizontal_stop
    })

    define_ability({
        id = playerabilityids.move_vertical,
        unique = 'ignore',
        activation = ability_move_vertical
    })

    define_ability({
        id = playerabilityids.move_vertical_stop,
        activation = ability_move_vertical_stop
    })

    define_ability({
        id = playerabilityids.hurt,
        cooldownms = math.floor(player_hit_recovery * 1000),
        activation = ability_hurt
    })

    ability_definitions_ready = true
end

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
    game_state.corona_count = 0
    game_state.spawn_timer = spawn_interval
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
    local id = spawn_object('marlies2020.fire', {
        position = {
            x = owner.x + dx * 12,
            y = owner.y + dy * 12,
            z = owner.z + 100
        },
        defaults = {
            vx = dx * fire_speed,
            vy = dy * fire_speed,
            life = fire_lifetime
        }
    })
    local object = registry:get(id)
    return id, object
end

local function spawn_background()
    local previous = game_state.background_id
    if previous then
        despawn(previous)
    end
    game_state.background_id = spawn_object('marlies2020.background', {
        position = {
            x = 0,
            y = 0,
            z = 0
        }
    })
end

local function spawn_inventory_frame()
    local previous = game_state.inventory_id
    if previous then
        despawn(previous)
    end
    game_state.inventory_id = spawn_object('marlies2020.inventory_frame', {
        position = {
            x = inventory_pos.x - 4,
            y = inventory_pos.y - 4,
            z = inventory_pos.z - 1
        }
    })
end

local function spawn_board(position)
    local id = spawn_object('marlies2020.board', {
        position = {
            x = position.x,
            y = position.y,
            z = 800
        }
    })
    local object = registry:get(id)
    register_board(id, object)
end

local function spawn_ingredient(def)
    local id = spawn_object('marlies2020.ingredient', {
        position = {
            x = def.x,
            y = def.y,
            z = 950
        },
        defaults = {
            contents = def.contents or {}
        }
    })
    local object = registry:get(id)
    register_ingredient(id, object, def.kind, def.contents)
end

local function spawn_player()
    spawn_object('marlies2020.player', {
        position = {
            x = column_x[start_column],
            y = 16,
            z = 1000
        }
    })
end

local function spawn_corona(x, y)
    spawn_object('marlies2020.corona', {
        position = {
            x = x,
            y = y,
            z = 900
        },
        defaults = {
            move_x = x <= 0 and 1 or -1,
            move_y = 0
        }
    })
end

local function spawn_world()
    spawn_background()
    spawn_inventory_frame()
    for index = 1, #board_positions do
        spawn_board(board_positions[index])
    end
    for index = 1, #initial_ingredients do
        spawn_ingredient(initial_ingredients[index])
    end
    for index = 1, #initial_pitas do
        spawn_ingredient({
            kind = 'pita',
            x = initial_pitas[index].x,
            y = initial_pitas[index].y,
            contents = {}
        })
    end
    spawn_player()
end

local function spawn_victory_sprite()
    local previous = game_state.victory_id
    if previous then
        despawn(previous)
    end
    game_state.victory_id = spawn_object('marlies2020.victory', {
        position = {
            x = 96,
            y = 80,
            z = 1100
        }
    })
end

local function advance_spawn_timer(delta)
    game_state.spawn_timer = game_state.spawn_timer - delta
    if game_state.spawn_timer <= 0 and game_state.corona_count < max_corona then
        game_state.spawn_timer = spawn_interval + math.random()
        local spawn_right = math.random(1, 2) == 1
        local x = spawn_right and (screen_width + 16) or -16
        local y = math.random(8, screen_height - 24)
        spawn_corona(x, y)
    end
end

function init()
	set_input_map({
		keyboard = {
			move_left = { 'ArrowLeft' },
			move_right = { 'ArrowRight' },
			move_up = { 'ArrowUp' },
			move_down = { 'ArrowDown' },
			fire = { 'KeyZ' },
			interact = { 'KeyX' },
		},
		gamepad = {
			move_left = { 'left' },
			move_right = { 'right' },
			move_up = { 'up' },
			move_down = { 'down' },
			fire = { 'b' },
			interact = { 'a' },
		},
	})
	math.randomseed(os.time())
	reset_game_state()
	ensure_player_ability_definitions()
	spawn_world()
end

function update(delta)
-- error('dsdf')
    if game_state.victory then
        if not game_state.victory_id then
            spawn_victory_sprite()
        end
    else
        advance_spawn_timer(delta)
        if game_state.pitas_served >= pitas_required then
            game_state.victory = true
            if game_state.player then
                game_state.player.sc:dispatch_event('player.win', game_state.player)
            end
            spawn_victory_sprite()
        end
    end
end

function draw()
    local text_y = inventory_pos.y + 60
    print('Pitas: ' .. tostring(game_state.pitas_served) .. '/' .. tostring(pitas_required), 4, text_y, 10)
    if game_state.victory then
        print('Hoera!', 96, 12, 11)
    end
    print('Boaz is stoer', 32, 64, 15)
end
