IngredientObject = IngredientObject or {}

worldobject({
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
