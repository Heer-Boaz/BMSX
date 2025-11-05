-- Consolidated world object registrations for Marlies 2020 console.

local abilities = require('src/marlies2020console/res/lua/marlies2020_abilities')

local playerAbilityIds = abilities.abilityIds
local playerInputProgram = abilities.inputProgram
local playerAbilityOrder = abilities.abilityOrder

BackgroundObject = BackgroundObject or {}

register_worldobject({
	id = 'marlies2020.background',
	class = 'BackgroundObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'background_sprite',
			imgid = 'keuken',
			layer = 'bg',
			colliderLocalId = nil,
		},
	},
})

BoardObject = BoardObject or {}

register_worldobject({
	id = 'marlies2020.board',
	class = 'BoardObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'board_sprite',
			imgid = 'bord',
			layer = 'actors',
			colliderLocalId = 'board_collider',
		},
		{
			preset = 'overlap_trigger',
			params = {
				id_local = 'board_collider',
			},
		},
	},
})

IngredientObject = IngredientObject or {}

register_worldobject({
	id = 'marlies2020.ingredient',
	class = 'IngredientObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'ingredient_sprite',
			layer = 'actors',
			colliderLocalId = 'ingredient_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'ingredient_collider',
			isTrigger = true,
			generateOverlapEvents = true,
		},
	},
})

InventoryFrameObject = InventoryFrameObject or {}

register_worldobject({
	id = 'marlies2020.inventory_frame',
	class = 'InventoryFrameObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'inventory_sprite',
			imgid = 'invframe',
			layer = 'ui',
			colliderLocalId = nil,
		},
	},
})

VictoryObject = VictoryObject or {}

register_worldobject({
	id = 'marlies2020.victory',
	class = 'VictoryObject',
	components = {
		{
			class = 'SpriteComponent',
			id_local = 'victory_sprite',
			imgid = 'sint',
			layer = 'actors',
			colliderLocalId = nil,
		},
	},
})

CoronaObject = CoronaObject or {}

function CoronaObject:create(owner)
	owner.move_x = -1
	owner.move_y = 0
end

function CoronaObject:on_spawn()
	self.move_x = self.move_x or -1
	self.move_y = self.move_y or 0
	attach_bt(self.id, 'marlies2020_corona_bt')

	local function handle_overlap(_, _, payload)
		local other = payload.otherId
		if game_state.fires[other] then
			self.sc:dispatch_event('dispel', self, {
				source = other
			})
		end
	end

	events:on('overlapBegin', handle_overlap, self, {
		emitter = self.id,
		persistent = true
	})
	game_state.corona[self.id] = self
	game_state.corona_count = game_state.corona_count + 1
end

function CoronaObject:on_dispose()
	game_state.corona[self.id] = nil
	game_state.corona_count = game_state.corona_count - 1
end

register_worldobject({
	id = 'marlies2020.corona',
	class = 'CoronaObject',
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
			colliderLocalId = 'corona_collider',
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

FireObject = FireObject or {}

function FireObject:create(owner)
	owner.vx = 0
	owner.vy = 0
	owner.life = FIRE_LIFETIME
end

function FireObject:on_spawn()
	local function hit_corona(_, _, payload)
		local other = payload.otherId
		if game_state.corona[other] then
			despawn(other)
		end
	end

	local function leave_screen()
		despawn(self.id)
	end

	events:on('overlapBegin', hit_corona, self, {
		emitter = self.id,
		persistent = true
	})
	events:on('leaveScreen', leave_screen, self, {
		emitter = self.id,
		persistent = true
	})
	game_state.fires[self.id] = self
end

function FireObject:on_dispose()
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
			colliderLocalId = 'fire_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'fire_collider',
			isTrigger = true,
			generateOverlapEvents = true,
			spaceEvents = 'current',
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

PlayerObject = PlayerObject or {}

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

	local input_component = self:getComponentById('player_input')
	input_component.playerIndex = 1
	input_component.program = playerInputProgram

	local asc = self:getComponentById('player_abilities')
	assert(asc ~= nil, '[PlayerObject:on_spawn] AbilitySystemComponent missing')
	assert(type(asc.hasAbility) == 'function', '[PlayerObject:on_spawn] AbilitySystemComponent lacks hasAbility')
	assert(asc:hasAbility(playerAbilityIds.fire), '[PlayerObject:on_spawn] fire ability missing')
	assert(asc:hasAbility(playerAbilityIds.move_horizontal), '[PlayerObject:on_spawn] move ability missing')
	assert(asc:hasAbility(playerAbilityIds.interact), '[PlayerObject:on_spawn] interact ability missing')

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
			request_ability(self.id, playerAbilityIds.hurt, {
				payload = {
					source = other
				}
			})
		end
	end

	local function end_overlap(_, _, payload)
		local other = payload.otherId
		self.touch_ingredients[other] = nil
		self.touch_boards[other] = nil
		self.touch_corona[other] = nil
	end

	events:on('overlapBegin', begin_overlap, self, {
		emitter = self.id,
		persistent = true
	})
	events:on('overlapEnd', end_overlap, self, {
		emitter = self.id,
		persistent = true
	})

	game_state.player = self
	game_state.player_id = self.id
end

function PlayerObject:on_dispose()
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
			colliderLocalId = 'player_collider',
		},
		{
			class = 'Collider2DComponent',
			id_local = 'player_collider',
			isTrigger = true,
			generateOverlapEvents = true,
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
	abilities = playerAbilityOrder,
})
