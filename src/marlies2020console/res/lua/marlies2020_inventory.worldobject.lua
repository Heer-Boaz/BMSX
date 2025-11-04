InventoryFrameObject = InventoryFrameObject or {}

worldobject({
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
