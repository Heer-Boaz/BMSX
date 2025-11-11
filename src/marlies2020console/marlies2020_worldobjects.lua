-- consolidated world object registrations for marlies 2020 console.

local abilities = require('marlies2020_abilities')

local playerabilityids = abilities.abilityids
local playerinputprogram = abilities.inputprogram
local playerabilityorder = abilities.abilityorder

backgroundobject = backgroundobject or {}

register_worldobject({
	id = 'marlies2020.background',
	class = 'BackgroundObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'background_sprite',
			imgid = 'keuken',
			layer = 'bg',
			colliderlocalid = nil,
		},
	},
})

boardobject = boardobject or {}

register_worldobject({
	id = 'marlies2020.board',
	class = 'BoardObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'board_sprite',
			imgid = 'bord',
			layer = 'actors',
			colliderlocalid = 'board_collider',
		},
		{
			preset = 'overlap_trigger',
			params = {
				id_local = 'board_collider',
			},
		},
	},
})

ingredientobject = ingredientobject or {}

register_worldobject({
	id = 'marlies2020.ingredient',
	class = 'IngredientObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'ingredient_sprite',
			layer = 'actors',
			colliderlocalid = 'ingredient_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'ingredient_collider',
			istrigger = true,
			generateoverlapevents = true,
		},
	},
})

inventoryframeobject = inventoryframeobject or {}

register_worldobject({
	id = 'marlies2020.inventory_frame',
	class = 'InventoryFrameObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'inventory_sprite',
			imgid = 'invframe',
			layer = 'ui',
			colliderlocalid = nil,
		},
	},
})

victoryobject = victoryobject or {}

register_worldobject({
	id = 'marlies2020.victory',
	class = 'VictoryObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'victory_sprite',
			imgid = 'sint',
			layer = 'actors',
			colliderlocalid = nil,
		},
	},
})

coronaobject = coronaobject or {}

function coronaobject:create(owner)
	owner.move_x = -1
	owner.move_y = 0
end

function coronaobject:on_spawn()
	self.move_x = self.move_x or -1
	self.move_y = self.move_y or 0
	attach_bt(self.id, 'marlies2020_corona_bt')

	local function handle_overlap(_, _, _, payload)
		local other = payload.other_id
		if game_state.fires[other] then
			self.sc:dispatch_event('dispel', self, {
				source = other
			})
		end
	end

	events:on('overlap.begin', handle_overlap, self, {
		emitter = self.id,
		persistent = true
	})
	game_state.corona[self.id] = self
	game_state.corona_count = game_state.corona_count + 1
end

function coronaobject:on_dispose()
	game_state.corona[self.id] = nil
	game_state.corona_count = game_state.corona_count - 1
end

register_worldobject({
	id = 'marlies2020.corona',
	class = 'coronaobject',
	defaults = {
		move_x = -1,
		move_y = 0,
	},
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'corona_sprite',
			imgid = 'corona1',
			layer = 'actors',
			colliderlocalid = 'corona_collider',
		},
		{
			preset = 'overlap_trigger',
			params = {
				id_local = 'corona_collider',
			},
		},
	},
	fsms = {
		{ id = 'marlies2020_corona' },
	},
	bts = {
		{ id = 'marlies2020_corona_bt', auto_tick = true },
	},
})

fireobject = fireobject or {}

function fireobject:create(owner)
	owner.vx = 0
	owner.vy = 0
	owner.life = fire_lifetime
end

function fireobject:on_spawn()
	local function hit_corona(_, _, _, payload)
		local other = payload.other_id
		if game_state.corona[other] then
			game_state.corona[other].__native__e.dispose()
			-- despawn(other)
		end
	end

	local function leave_screen()
		despawn(self.id)
	end

	events:on('overlap.begin', hit_corona, self, {
		emitter = self.id,
		persistent = true
	})
	events:on('screen.leave', leave_screen, self, {
		emitter = self.id,
		persistent = true
	})
	game_state.fires[self.id] = self
end

function fireobject:on_dispose()
	game_state.fires[self.id] = nil
end

register_worldobject({
	id = 'marlies2020.fire',
	class = 'FireObject',
	defaults = {
		vx = 0,
		vy = 0,
		life = 0.45,
	},
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'fire_sprite',
			imgid = 'vuur1',
			layer = 'actors',
			colliderlocalid = 'fire_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'fire_collider',
			istrigger = true,
			generateoverlapevents = true,
			spaceevents = 'current',
		},
		{
			class = 'ScreenBoundaryComponent',
			id_local = 'fire_bounds',
		},
	},
	fsms = {
		{ id = 'marlies2020_fire' },
	},
})

playerobject = playerobject or {}

function playerobject:create(owner)
	owner.column = start_column
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

function playerobject:on_spawn()
	self.touch_ingredients = {}
	self.touch_boards = {}
	self.touch_corona = {}
	self.inventory_item = nil
	self.direction = 'down'
	self.hurt_remaining = nil

	local input_component = self:getcomponentbyid('player_input')
	input_component.playerindex = 1
	input_component.program = playerinputprogram

	local asc = self:getcomponentbyid('player_abilities')
	assert(asc ~= nil, '[PlayerObject:on_spawn] AbilitySystemComponent missing')
	assert(type(asc.hasability) == 'function', '[PlayerObject:on_spawn] AbilitySystemComponent lacks hasAbility')
	assert(asc:hasability(playerabilityids.fire), '[PlayerObject:on_spawn] fire ability missing')
	assert(asc:hasability(playerabilityids.move_horizontal), '[PlayerObject:on_spawn] move ability missing')
	assert(asc:hasability(playerabilityids.interact), '[PlayerObject:on_spawn] interact ability missing')

		local function begin_overlap(_, _, _, payload)
			local other = payload.other_id
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
			request_ability(self.id, playerabilityids.hurt, {
				payload = {
					source = other
				}
			})
		end
	end

		local function end_overlap(_, _, _, payload)
			local other = payload.other_id
		self.touch_ingredients[other] = nil
		self.touch_boards[other] = nil
		self.touch_corona[other] = nil
	end

	events:on('overlap.begin', begin_overlap, self, {
		emitter = self.id,
		persistent = true
	})
	events:on('overlap.end', end_overlap, self, {
		emitter = self.id,
		persistent = true
	})

	game_state.player = self
	game_state.player_id = self.id
end

function playerobject:on_dispose()
	if self.inventory_item then
		self.inventory_item.held = false
		self.inventory_item = nil
	end
	game_state.player = nil
	game_state.player_id = nil
end

register_worldobject({
	id = 'marlies2020.player',
	class = 'PlayerObject',
	tags = { 'player' },
	defaults = {
		column = 2,
		inventory_item = nil,
		touch_ingredients = {},
		touch_boards = {},
		touch_corona = {},
		horizontal_direction = nil,
		switch_target = nil,
		vertical_intent = nil,
		direction = 'down',
		hurt_remaining = nil,
	},
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'player_sprite',
			layer = 'actors',
			colliderlocalid = 'player_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'player_collider',
			istrigger = true,
			generateoverlapevents = true,
		},
		{
			class = 'AbilitySystemComponent',
			id_local = 'player_abilities',
		},
		{
			class = 'InputAbilityComponent',
			id_local = 'player_input',
		},
	},
	fsms = {
		{ id = 'marlies2020_player' },
	},
	abilities = playerabilityorder,
})
