local bin<const> = require('cartlib/bin')
local bt_library<const> = require('cartlib/behaviour_tree/library')

-- Cooked Behavior Tree resources remain ordinary cart data. This admission
-- boundary validates the registration-local manifest before it mutates shared
-- key descriptors, lowers the decoded definition once and hands that native
-- definition to the existing retained program owner.

local resource<const> = {}
local cooked_format_version<const> = 1
local walk_by_type<const> = {}
local walk_node

local resolve_binding<const> = function(bindings, binding_id, binding_kind, tree_id)
	local binding<const> = bindings[binding_id]
	if binding == nil then
		error(
			'behaviour tree "' .. tree_id .. '" has no '
			.. binding_kind .. ' binding "' .. binding_id .. '".'
		)
	end
	return binding
end

local verify_service<const> = function(definition, manifest, tree_id)
	local binding_id<const> = definition.binding_id
	local service<const> = resolve_binding(manifest.services, binding_id, 'Service', tree_id)
	if service.on_tick ~= nil then
		if definition.interval == nil then
			error(
				'behaviour tree "' .. tree_id .. '" Service binding "'
				.. binding_id .. '" requires an interval.'
			)
		end
	elseif definition.interval ~= nil
	or definition.tick_on_search_start ~= nil
	or definition.restart_timer_on_each_activation ~= nil then
		error(
			'behaviour tree "' .. tree_id .. '" Service binding "'
			.. binding_id .. '" does not tick.'
		)
	end
end

local verify_node<const> = function(node, manifest, _keys_by_name, tree_id)
	local services<const> = node.services
	if services ~= nil then
		for index = 1, #services do
			verify_service(services[index], manifest, tree_id)
		end
	end

	local decorators<const> = node.decorators
	if decorators ~= nil then
		for index = 1, #decorators do
			local decorator<const> = decorators[index]
			if decorator.type == 'condition' then
				resolve_binding(manifest.decorators, decorator.binding_id, 'decorator', tree_id)
			end
		end
	end

	if node.type == 'task' then
		local binding_id<const> = node.binding_id
		local task<const> = resolve_binding(manifest.tasks, binding_id, 'Task', tree_id)
		if node.interval_ticks ~= nil and task.tick == nil then
			error(
				'behaviour tree "' .. tree_id .. '" Task binding "'
				.. binding_id .. '" does not tick.'
			)
		end
	end
end

local verify_blackboard_manifest<const> = function(document, manifest)
	local entry_index_by_name<const> = {}
	local entries<const> = document.blackboard
	if entries ~= nil then
		for index = 1, #entries do
			entry_index_by_name[entries[index].name] = index
		end
	end

	local manifest_keys<const> = manifest.blackboard
	local manifest_key_names<const> = {}
	for index = 1, #manifest_keys do
		local name<const> = manifest_keys[index].name
		if manifest_key_names[name] then
			error(
				'behaviour tree "' .. document.definition_id
				.. '" repeats blackboard manifest key "' .. name .. '".'
			)
		end
		manifest_key_names[name] = true
		if entry_index_by_name[name] == nil then
			error(
				'behaviour tree "' .. document.definition_id
				.. '" does not declare blackboard key "' .. name .. '".'
			)
		end
	end
	return entry_index_by_name
end

local bind_blackboard_keys<const> = function(document, manifest, entry_index_by_name)
	local entries<const> = document.blackboard
	if entries == nil then
		return entry_index_by_name
	end
	local manifest_keys<const> = manifest.blackboard
	for index = 1, #manifest_keys do
		local key<const> = manifest_keys[index]
		local entry_index<const> = entry_index_by_name[key.name]
		key.initial_value = entries[entry_index].initial_value
		entries[entry_index] = key
	end
	for index = 1, #entries do
		local key<const> = entries[index]
		entry_index_by_name[key.name] = key
	end
	return entry_index_by_name
end

local bind_node<const> = function(node, manifest, keys_by_name, _tree_id)
	local services<const> = node.services
	if services ~= nil then
		for index = 1, #services do
			local definition<const> = services[index]
			definition.service = manifest.services[definition.binding_id]
		end
	end

	local decorators<const> = node.decorators
	if decorators ~= nil then
		for index = 1, #decorators do
			local decorator<const> = decorators[index]
			if decorator.type == 'condition' then
				decorator.decorator = manifest.decorators[decorator.binding_id]
			elseif decorator.type == 'blackboard' then
				decorator.key = keys_by_name[decorator.key]
			end
		end
	end

	local node_type<const> = node.type
	if node_type == 'task' then
		node.task = manifest.tasks[node.binding_id]
	elseif node_type == 'set_blackboard' then
		node.key = keys_by_name[node.key]
	elseif node_type == 'add_blackboard' then
		node.key = keys_by_name[node.key]
	end
end

local walk_children<const> = function(node, visit, manifest, keys_by_name, tree_id)
	local children<const> = node.children
	for index = 1, #children do
		walk_node(children[index], visit, manifest, keys_by_name, tree_id)
	end
end

walk_by_type.sequence = walk_children
walk_by_type.selector = walk_children
walk_by_type.random_selector = walk_children

walk_by_type.weighted_random_selector = function(node, visit, manifest, keys_by_name, tree_id)
	local choices<const> = node.choices
	for index = 1, #choices do
		walk_node(choices[index].child, visit, manifest, keys_by_name, tree_id)
	end
end

walk_by_type.simple_parallel = function(node, visit, manifest, keys_by_name, tree_id)
	walk_node(node.main_task, visit, manifest, keys_by_name, tree_id)
	walk_node(node.background_tree, visit, manifest, keys_by_name, tree_id)
end

local walk_leaf<const> = function(_node, _visit, _manifest, _keys_by_name, _tree_id)
end

walk_by_type.task = walk_leaf
walk_by_type.timeline = walk_leaf
walk_by_type.wait = walk_leaf
walk_by_type.set_blackboard = walk_leaf
walk_by_type.add_blackboard = walk_leaf

walk_node = function(node, visit, manifest, keys_by_name, tree_id)
	visit(node, manifest, keys_by_name, tree_id)
	walk_by_type[node.type](node, visit, manifest, keys_by_name, tree_id)
end

function resource.register(address, manifest)
	local document<const> = bin.decode(address, 'behaviour-tree resource')
	if document.format_version ~= cooked_format_version then
		error(
			'cooked behaviour-tree format ' .. document.format_version
			.. ' is unsupported; expected ' .. cooked_format_version .. '.'
		)
	end
	local tree_id<const> = document.definition_id
	local entry_index_by_name<const> = verify_blackboard_manifest(document, manifest)
	walk_node(document.root, verify_node, manifest, nil, tree_id)
	local keys_by_name<const> = bind_blackboard_keys(document, manifest, entry_index_by_name)
	walk_node(document.root, bind_node, manifest, keys_by_name, tree_id)
	bt_library.register(tree_id, document)
end

return resource
