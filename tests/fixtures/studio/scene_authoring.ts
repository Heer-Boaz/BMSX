/** Source-owned UI fixture, independent of game carts and runtime actor identities. */
export const SCENE_AUTHORING_SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture.room', { objects = {
	{ member_id = 'first', definition_id = 'fixture.actor', options = { pos = { x = 1, y = 2, z = 3 } } },
	{ member_id = 'second', definition_id = 'fixture.other', options = { pos = { x = 4, y = 5, z = 6 } } },
	{ member_id = 'subject', definition_id = 'fixture.subject', options = { pos = { x = 0, y = 0, z = 0 }, tint = 0xffabcdef } },
	{ member_id = 'last', definition_id = 'fixture.last', options = { pos = { x = 7, y = 8, z = 9 } } },
} })
return {}
`;
