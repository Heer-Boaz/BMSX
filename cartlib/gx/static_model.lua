-- Static authored-pose, opaque constant-color unlit rendering. Resource nodes
-- remain immutable mesh attachments; they never become World spatial nodes.
local model_asset<const> = require('cartlib/gx/model_asset')
local model_batch<const> = require('cartlib/gx/model_batch')

local static_model<const> = {}
local feature_names<const> = {'base-color textures','non-opaque alpha','vertex colors','morphing','skinning'}
local indexed_kernels<const> = {
	[5121] = model_batch.indexed8,
	[5123] = model_batch.indexed16,
	[5125] = model_batch.indexed32,
}

function static_model.resolve(id, scene_index)
	local asset<const> = model_asset.resolve(id)
	if scene_index == nil then scene_index = asset.default_scene end
	if scene_index == 0xffffffff then
		error('static model requires an explicit scene_index when its asset has no default scene')
	end
	if scene_index < 0 or scene_index >= asset.scene_count then
		error('static model scene_index is outside the asset scene directory')
	end
	local scenes = asset._static_scenes
	if scenes == nil then scenes = {}; asset._static_scenes = scenes end
	local cached<const> = scenes[scene_index]
	if cached ~= nil then return cached end
	local source<const>: *model_scene = asset.scenes + scene_index * sizeof(model_scene)
	if source->features ~= 0 then
		local names<const> = {}
		for index = 1, #feature_names do
			if (source->features & (1 << (index-1))) ~= 0 then
				names[#names+1] = feature_names[index]
			end
		end
		error('static-unlit model "' .. id .. '" scene ' .. scene_index .. ' requires ' .. table.concat(names, ', '))
	end
	local mesh_cache = asset._static_meshes
	if mesh_cache == nil then mesh_cache = {}; asset._static_meshes = mesh_cache end
	local meshes<const>: *model_mesh = asset.meshes
	local materials<const>: *model_material = asset.materials
	local parts<const> = {}
	local source_parts<const>: *model_part = asset.parts
	for index = 0, source->part_count - 1 do
		local part<const>: *model_part = source_parts + (source->first_part + index) * sizeof(model_part)
		local mesh<const>: *model_mesh = meshes + part->mesh * sizeof(model_mesh)
		local primitives = mesh_cache[part->mesh]
		if primitives == nil then
			primitives = {}
			for primitive_index = mesh->first_primitive, mesh->first_primitive + mesh->primitive_count - 1 do
				local record<const>: *model_primitive = asset.primitives + primitive_index * sizeof(model_primitive)
				local command_word, double_sided = 0x20ffffff, false
				if record->material_index ~= 0xffffffff then
					local material<const>: *model_material = materials + record->material_index * sizeof(model_material)
					command_word, double_sided = material->command, material->double_sided ~= 0
				end
				local queue = model_batch.triangles
				local indices = 0
				if record->indices_offset ~= 0 then
					queue = indexed_kernels[record->index_component_type]
					indices = asset.addr + record->indices_offset
				end
				primitives[#primitives + 1] = { asset = asset, positions = asset.addr + record->positions_offset,
					position_scalar_count = record->position_scalar_count, indices = indices,
					index_count = record->index_count, command_word = command_word, double_sided = double_sided,
					queue = queue }
			end
			mesh_cache[part->mesh] = primitives
		end
		parts[index + 1] = { node = part->node, mesh = part->mesh, primitives = primitives,
			xx=part->xx,xy=part->xy,xz=part->xz,yx=part->yx,yy=part->yy,yz=part->yz,
			zx=part->zx,zy=part->zy,zz=part->zz,ox=part->ox,oy=part->oy,oz=part->oz }
	end
	local prepared<const> = { asset = asset, scene_index = scene_index, parts = parts }
	scenes[scene_index] = prepared
	return prepared
end

return static_model
