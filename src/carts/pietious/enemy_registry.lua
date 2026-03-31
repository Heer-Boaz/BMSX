local enemy_modules_without_bt<const> = {
	require('enemies/breakablewall'),
	require('enemies/disappearingwall'),
}

local enemy_modules_with_bt<const> = {
	{ module = require('enemies/boekfoe'), bt_id = 'enemy_boekfoe' },
	{ module = require('enemies/cloud'), bt_id = 'enemy_cloud' },
	{ module = require('enemies/crossfoe'), bt_id = 'enemy_crossfoe' },
	{ module = require('enemies/marspeinenaardappel'), bt_id = 'enemy_marspeinenaardappel' },
	{ module = require('enemies/mijterfoe'), bt_id = 'enemy_mijterfoe' },
	{ module = require('enemies/muziekfoe'), bt_id = 'enemy_muziekfoe' },
	{ module = require('enemies/nootfoe'), bt_id = 'enemy_nootfoe' },
	{ module = require('enemies/paperfoe'), bt_id = 'enemy_paperfoe' },
	{ module = require('enemies/stafffoe'), bt_id = 'enemy_stafffoe' },
	{ module = require('enemies/staffspawn'), bt_id = 'enemy_staffspawn' },
	{ module = require('enemies/vlokfoe'), bt_id = 'enemy_vlokfoe' },
	{ module = require('enemies/vlokspawner'), bt_id = 'enemy_vlokspawner' },
	{ module = require('enemies/zakfoe'), bt_id = 'enemy_zakfoe' },
}

local enemy_registry<const> = {}

function enemy_registry.register_all()
	for i = 1, #enemy_modules_without_bt do
		enemy_modules_without_bt[i].register_enemy_definition()
	end

	for i = 1, #enemy_modules_with_bt do
		local entry<const> = enemy_modules_with_bt[i]
		entry.module.register_behaviour_tree(entry.bt_id)
		entry.module.register_enemy_definition()
	end
end

return enemy_registry
