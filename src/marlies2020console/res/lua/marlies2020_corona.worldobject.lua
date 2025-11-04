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

worldobject({
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
