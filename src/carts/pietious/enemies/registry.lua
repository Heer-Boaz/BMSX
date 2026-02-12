local constants = require('constants')
local mijterfoe_module = require('enemies/mijterfoe')
local zakfoe_module = require('enemies/zakfoe')
local crossfoe_module = require('enemies/crossfoe')
local boekfoe_module = require('enemies/boekfoe')
local paperfoe_module = require('enemies/paperfoe')
local muziekfoe_module = require('enemies/muziekfoe')
local nootfoe_module = require('enemies/nootfoe')
local stafffoe_module = require('enemies/stafffoe')
local staffspawn_module = require('enemies/staffspawn')
local cloud_module = require('enemies/cloud')
local vlokspawner_module = require('enemies/vlokspawner')
local vlokfoe_module = require('enemies/vlokfoe')
local marspeinenaardappel_module = require('enemies/marspeinenaardappel')

local registry = {}

local modules_by_kind = {
	mijterfoe = mijterfoe_module,
	zakfoe = zakfoe_module,
	crossfoe = crossfoe_module,
	boekfoe = boekfoe_module,
	paperfoe = paperfoe_module,
	muziekfoe = muziekfoe_module,
	nootfoe = nootfoe_module,
	stafffoe = stafffoe_module,
	staffspawn = staffspawn_module,
	cloud = cloud_module,
	vlokspawner = vlokspawner_module,
	vlokfoe = vlokfoe_module,
	marspeinenaardappel = marspeinenaardappel_module,
}

local kind_order = {
	'mijterfoe',
	'zakfoe',
	'crossfoe',
	'boekfoe',
	'paperfoe',
	'muziekfoe',
	'nootfoe',
	'stafffoe',
	'staffspawn',
	'cloud',
	'vlokspawner',
	'vlokfoe',
	'marspeinenaardappel',
}

local behaviour_tree_ids = {
	mijterfoe = constants.ids.enemy_bt .. '.m',
	zakfoe = constants.ids.enemy_bt .. '.z',
	crossfoe = constants.ids.enemy_bt .. '.c',
	boekfoe = constants.ids.enemy_bt .. '.b',
	paperfoe = constants.ids.enemy_bt .. '.p',
	muziekfoe = constants.ids.enemy_bt .. '.mu',
	nootfoe = constants.ids.enemy_bt .. '.n',
	stafffoe = constants.ids.enemy_bt .. '.sf',
	staffspawn = constants.ids.enemy_bt .. '.ss',
	cloud = constants.ids.enemy_bt .. '.cl',
	vlokspawner = constants.ids.enemy_bt .. '.vs',
	vlokfoe = constants.ids.enemy_bt .. '.vf',
	marspeinenaardappel = constants.ids.enemy_bt .. '.ma',
}

function registry.register_behaviour_trees()
	for i = 1, #kind_order do
		local kind = kind_order[i]
		local kind_module = modules_by_kind[kind]
		kind_module.register_behaviour_tree(behaviour_tree_ids[kind])
	end
end

registry.modules_by_kind = modules_by_kind
registry.behaviour_tree_ids = behaviour_tree_ids

return registry
