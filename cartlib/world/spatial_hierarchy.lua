-- Spatial topology and read-through evaluation. Structural primitives commit
-- synchronously; the integrating World owns admission and mutation barriers.
local affine2<const> = require('cartlib/math/affine2')
local affine3<const> = require('cartlib/math/affine3')

local world_dirty<const> = 1
local local_basis<const> = 2
local local_origin<const> = 4
local parent_inputs<const> = 8
local all_dirty<const> = world_dirty | local_basis | local_origin | parent_inputs

local spatial<const> = {
	committed = 0,
	retired_target = 1,
	invalid_relationship = 2,
	singular_parent = 3,
}

function spatial.new()
	return { _scratch = {}, _scratch_capacity = 0, _count = 0 }
end

local admit<const> = function(graph)
	local count<const> = graph._count + 1
	graph._count = count
	if count > graph._scratch_capacity then
		graph._scratch[count] = false
		graph._scratch_capacity = count
	end
end

function spatial.create2(graph, owner, xx, xy, yx, yy, ox, oy)
	local node<const> = {
		owner = owner, _family = affine2, _origin_only = false,
		_hierarchy = graph, _flags = all_dirty,
		_basis_revision = 0, _origin_revision = 0,
		_parent_basis_revision = 0, _parent_origin_revision = 0,
		xx = xx, xy = xy, yx = yx, yy = yy, ox = ox, oy = oy,
		wxx = 0, wxy = 0, wyx = 0, wyy = 0, wox = 0, woy = 0,
	}
	admit(graph)
	return node
end

function spatial.create_origin2(graph, owner, x, y)
	local node<const> = spatial.create2(graph, owner, 1, 0, 0, 1, x, y)
	node._origin_only = true
	return node
end

function spatial.create3(graph, owner, xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	local node<const> = {
		owner = owner, _family = affine3, _origin_only = false,
		_hierarchy = graph, _flags = all_dirty,
		_basis_revision = 0, _origin_revision = 0,
		_parent_basis_revision = 0, _parent_origin_revision = 0,
		xx = xx, xy = xy, xz = xz, yx = yx, yy = yy, yz = yz,
		zx = zx, zy = zy, zz = zz, ox = ox, oy = oy, oz = oz,
		wxx = 0, wxy = 0, wxz = 0, wyx = 0, wyy = 0, wyz = 0,
		wzx = 0, wzy = 0, wzz = 0, wox = 0, woy = 0, woz = 0,
	}
	admit(graph)
	return node
end

-- Every dirty node has only dirty descendants. Own local-write bits are set
-- before this walk, even when a previous write already dirtied the subtree.
local invalidate<const> = function(root)
	if (root._flags & world_dirty) ~= 0 then
		return
	end
	local node = root
	while true do
		if (node._flags & world_dirty) == 0 then
			node._flags = node._flags | world_dirty
			local first<const> = node._first_child
			if first ~= nil then
				node = first
				goto visit
			end
		end
		while node ~= root and node._next_sibling == nil do
			node = node.spatial_parent
		end
		if node == root then
			return
		end
		node = node._next_sibling
		::visit::
	end
end

function spatial.write_local2(node, xx, xy, yx, yy, ox, oy)
	node.xx = xx
	node.xy = xy
	node.yx = yx
	node.yy = yy
	node.ox = ox
	node.oy = oy
	node._flags = node._flags | local_basis | local_origin
	invalidate(node)
end

function spatial.write_local3(node, xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	node.xx = xx
	node.xy = xy
	node.xz = xz
	node.yx = yx
	node.yy = yy
	node.yz = yz
	node.zx = zx
	node.zy = zy
	node.zz = zz
	node.ox = ox
	node.oy = oy
	node.oz = oz
	node._flags = node._flags | local_basis | local_origin
	invalidate(node)
end

function spatial.write_origin2(node, x, y)
	node.ox = x
	node.oy = y
	-- A clean, childless root already has world == local. Publish directly;
	-- the common flat-object path needs neither traversal nor a resolver call.
	if node.spatial_parent == nil and node._first_child == nil and node._flags == 0 then
		node.wox = x
		node.woy = y
		node._origin_revision = node._origin_revision + 1
		return
	end
	node._flags = node._flags | local_origin
	invalidate(node)
end

function spatial.write_origin3(node, x, y, z)
	node.ox = x
	node.oy = y
	node.oz = z
	if node.spatial_parent == nil and node._first_child == nil and node._flags == 0 then
		node.wox = x
		node.woy = y
		node.woz = z
		node._origin_revision = node._origin_revision + 1
		return
	end
	node._flags = node._flags | local_origin
	invalidate(node)
end

function spatial.resolve(target)
	if (target._flags & world_dirty) == 0 then
		return target
	end
	local scratch<const> = target._hierarchy._scratch
	local evaluate<const> = target._family.evaluate
	local count = 0
	local node = target
	while node ~= nil and (node._flags & world_dirty) ~= 0 do
		count = count + 1
		scratch[count] = node
		node = node.spatial_parent
	end
	while count > 0 do
		node = scratch[count]
		scratch[count] = false
		count = count - 1
		local flags<const> = node._flags
		local parent<const> = node.spatial_parent
		local basis_changed = (flags & (local_basis | parent_inputs)) ~= 0
		local origin_changed = (flags & (local_origin | parent_inputs)) ~= 0
		if parent ~= nil then
			local basis_revision<const> = parent._basis_revision
			local origin_revision<const> = parent._origin_revision
			local parent_basis_changed<const> = basis_revision ~= node._parent_basis_revision
			basis_changed = basis_changed or parent_basis_changed
			origin_changed = origin_changed or parent_basis_changed
				or origin_revision ~= node._parent_origin_revision
			node._parent_basis_revision = basis_revision
			node._parent_origin_revision = origin_revision
		end
		evaluate(node, parent, basis_changed, origin_changed)
		if basis_changed then
			node._basis_revision = node._basis_revision + 1
		end
		if origin_changed then
			node._origin_revision = node._origin_revision + 1
		end
		node._flags = 0
	end
	return target
end

function spatial.write_world_origin2(node, x, y)
	local parent<const> = node.spatial_parent
	if parent ~= nil then
		spatial.resolve(parent)
	end
	if not affine2.origin_from_world(node, parent, x, y) then
		return false
	end
	node._flags = node._flags | local_origin
	invalidate(node)
	return true
end

function spatial.write_world_origin3(node, x, y, z)
	local parent<const> = node.spatial_parent
	if parent ~= nil then
		spatial.resolve(parent)
	end
	if not affine3.origin_from_world(node, parent, x, y, z) then
		return false
	end
	node._flags = node._flags | local_origin
	invalidate(node)
	return true
end

local unlink<const> = function(node)
	local parent<const> = node.spatial_parent
	local previous<const> = node._previous_sibling
	local next<const> = node._next_sibling
	if previous ~= nil then
		previous._next_sibling = next
	elseif parent ~= nil then
		parent._first_child = next
	end
	if next ~= nil then
		next._previous_sibling = previous
	elseif parent ~= nil then
		parent._last_child = previous
	end
	node.spatial_parent = nil
	node._previous_sibling = nil
	node._next_sibling = nil
end

function spatial.reparent(node, parent, keep_world)
	local graph<const> = node._hierarchy
	if graph == nil or (parent ~= nil and parent._hierarchy == nil) then
		return spatial.retired_target
	end
	if parent ~= nil then
		if node._origin_only or parent._hierarchy ~= graph or parent._family ~= node._family then
			return spatial.invalid_relationship
		end
		local ancestor = parent
		while ancestor ~= nil do
			if ancestor == node then
				return spatial.invalid_relationship
			end
			ancestor = ancestor.spatial_parent
		end
	end
	if keep_world then
		spatial.resolve(node)
		if parent ~= nil then
			spatial.resolve(parent)
		end
		if not node._family.relative_world(node, parent) then
			return spatial.singular_parent
		end
	end
	unlink(node)
	if parent ~= nil then
		local previous<const> = parent._last_child
		node.spatial_parent = parent
		node._previous_sibling = previous
		if previous ~= nil then
			previous._next_sibling = node
		else
			parent._first_child = node
		end
		parent._last_child = node
	end
	-- Invalidate the moved subtree, independently of its new parent's state.
	-- Keep World has changed local authority; parent-input invalidation forces
	-- both parts for Keep Local as well.
	node._flags = node._flags | parent_inputs
	invalidate(node)
	return spatial.committed
end

function spatial.remove(node)
	local graph<const> = node._hierarchy
	if graph == nil then
		return spatial.retired_target
	end
	local child = node._first_child
	while child ~= nil do
		local next<const> = child._next_sibling
		spatial.reparent(child, nil, true)
		child = next
	end
	unlink(node)
	node._hierarchy = nil
	graph._count = graph._count - 1
	return spatial.committed
end

return spatial
