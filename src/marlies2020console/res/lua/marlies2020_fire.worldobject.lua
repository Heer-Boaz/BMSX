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

worldobject({
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
