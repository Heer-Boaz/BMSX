local abilities = require('src/marlies2020console/res/lua/marlies2020_abilities')
local playerAbilityIds = abilities.abilityIds
local playerInputProgram = abilities.inputProgram
local playerAbilityOrder = abilities.abilityOrder

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


worldobject({
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
