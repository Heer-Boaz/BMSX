function spawnSourceRoom(test) {
	const [state] = test.evalLua(`
		local progression = require('progression')
		local room_spawner = require('room_spawner')
		local castle = oget('c')
		local player = oget('pietolon')
		local source_room = {
			room_number = 77,
			destroyed_rock_ids = {
				rock_077_01 = true,
				rock_077_02 = true,
			},
			rock_drops = {
				['drop.rock_077_02'] = {
					room_number = 77,
					x = 96,
					y = 64,
					item_type = 'ammofromrock',
				},
			},
			rocks = {
				{ id = 'rock_077_01', x = 64, y = 64, item_type = 'lamp' },
				{ id = 'rock_077_02', x = 96, y = 64, item_type = 'ammofromrock' },
			},
			lithographs = {},
			shrines = {},
			draaideuren = {},
			world_entrances = {},
			items = {
				{
					id = 'item_077_01',
					x = 128,
					y = 64,
					item_type = 'greenvase',
					conditions = { 'test.greenvase.ready' },
				},
			},
			enemies = {},
		}

		player.inventory_items.lamp = nil
		player.inventory_items.greenvase = nil
		progression.set(castle, 'test.greenvase.ready', true)
		room_spawner.spawn_all_for_room(source_room)

		return {
			lamp_drop_exists = oget('drop.rock_077_01') ~= nil,
			ammo_drop_exists = oget('drop.rock_077_02') ~= nil,
			vase_exists = oget('item_077_01') ~= nil,
		}
	`);
	return state;
}

function leaveSourceRoom(test) {
	const [state] = test.evalLua(`
		local room_spawner = require('room_spawner')
		room_spawner.spawn_all_for_room({
			room_number = 88,
			rock_drops = {},
			rocks = {},
			lithographs = {},
			shrines = {},
			draaideuren = {},
			world_entrances = {},
			items = {},
			enemies = {},
		})
		return {
			lamp_drop_exists = oget('drop.rock_077_01') ~= nil,
			ammo_drop_exists = oget('drop.rock_077_02') ~= nil,
			vase_exists = oget('item_077_01') ~= nil,
		}
	`);
	return state;
}

function samplePickupTileAlignment(test) {
	const [state] = test.evalLua(`
		inst('world_item', {
			id = 'test.world_item.tile_alignment',
			space_id = 'main',
			pos = { x = 67, y = 71, z = 130 },
			item_type = 'greenvase',
		})
		inst('loot_drop', {
			id = 'test.loot_drop.tile_alignment',
			space_id = 'main',
			pos = { x = 77, y = 83, z = 130 },
			loot_type = 'ammo',
		})
		local world_item = oget('test.world_item.tile_alignment')
		local loot_drop = oget('test.loot_drop.tile_alignment')
		return {
			world_item_x = world_item.x,
			world_item_y = world_item.y,
			loot_drop_x = loot_drop.x,
			loot_drop_y = loot_drop.y,
		}
	`);
	return state;
}

export default function schedule({ logger, test }) {
	test.run(async () => {
		await test.waitForGameplay({
			timeoutMs: 15000,
			objects: {
				castle: 'c',
				room: 'room',
				player: 'pietolon',
			},
		});

		let state = spawnSourceRoom(test);
		test.assert(state.lamp_drop_exists === true, 'inventory item from destroyed rock did not spawn');
		test.assert(state.ammo_drop_exists === true, 'refill item from destroyed rock did not stay in its source room');
		test.assert(state.vase_exists === true, 'appearing inventory item did not spawn');

		state = leaveSourceRoom(test);
		test.assert(state.lamp_drop_exists === false, 'inventory rock drop stayed live after leaving room');
		test.assert(state.ammo_drop_exists === false, 'refill rock drop stayed live after leaving room');
		test.assert(state.vase_exists === false, 'appearing item stayed live after leaving room');

		await test.waitFrames(1);

		state = spawnSourceRoom(test);
		test.assert(state.lamp_drop_exists === true, 'inventory rock drop did not respawn on return');
		test.assert(state.ammo_drop_exists === true, 'refill rock drop did not respawn in source room');
		test.assert(state.vase_exists === true, 'appearing item did not respawn on return');

		state = samplePickupTileAlignment(test);
		test.assert(state.world_item_x === 64 && state.world_item_y === 64, `world_item not tile-aligned: ${state.world_item_x},${state.world_item_y}`);
		test.assert(state.loot_drop_x === 72 && state.loot_drop_y === 80, `loot_drop not tile-aligned: ${state.loot_drop_x},${state.loot_drop_y}`);
		test.finish('[assert] room item progression persistence passed');
	});
}
