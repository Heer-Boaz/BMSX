BoardObject = BoardObject or {}

worldobject({
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
