/** Source-owned UI fixture, independent of game carts and runtime actor identities. */
export const SCENE_AUTHORING_SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture.room', { objects = {
	{ member_id = 'first', definition_id = 'fixture.actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } } },
	{ member_id = 'second', definition_id = 'fixture.other', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 4, 5, 6 } } },
	{ member_id = 'subject', definition_id = 'fixture.subject', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 } }, options = { tint = 0xffabcdef } },
	{ member_id = 'last', definition_id = 'fixture.last', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 7, 8, 9 } } },
} })
return {}
`;
