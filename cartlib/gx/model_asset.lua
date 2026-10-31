-- Mesh streams stay in ROM. The resource directory owns each loaded generation;
-- preparing that record binds addresses once, without per-mesh/vertex tables.
-- A binding belongs to that generation; reacquire it after directory reload.
local rom_dir<const> = require('cartlib/rom_dir')
local model_asset<const> = {}

-- Matches toolchain/ts/rompack/model_asset_layout.ts. All offsets are relative
-- to the model resource, including offsets in primitive descriptors.
struct model_asset_header
	rich_offset: word
	rich_length: word
	mesh_directory_offset: word
	mesh_count: word
	primitive_directory_offset: word
	primitive_count: word
	scene_directory_offset: word
	scene_count: word
	part_directory_offset: word
	part_count: word
	material_directory_offset: word
	material_count: word
	default_scene: word
end

struct model_mesh
	first_primitive: word
	primitive_count: word
end

struct model_primitive
	positions_offset: word
	position_scalar_count: word
	indices_offset: word
	index_count: word
	index_component_type: word
	material_index: word
end

struct model_scene
	first_part: word
	part_count: word
	features: word
end

struct model_part
	node: word
	mesh: word
	xx: f64
	xy: f64
	xz: f64
	yx: f64
	yy: f64
	yz: f64
	zx: f64
	zy: f64
	zz: f64
	ox: f64
	oy: f64
	oz: f64
end

struct model_material
	command: word
	double_sided: word
end

struct model_position
	x: f32
	y: f32
	z: f32
end

function model_asset.resolve(id)
	local resource<const> = rom_dir.model(id)
	local prepared = resource._model_asset
	if prepared ~= nil then return prepared end
	local address<const> = resource.addr
	local header<const>: *model_asset_header = address
	prepared = {
		addr = address,
		meshes = address + header->mesh_directory_offset,
		mesh_count = header->mesh_count,
		primitives = address + header->primitive_directory_offset,
		primitive_count = header->primitive_count,
		scenes = address + header->scene_directory_offset,
		scene_count = header->scene_count,
		parts = address + header->part_directory_offset,
		part_count = header->part_count,
		materials = address + header->material_directory_offset,
		default_scene = header->default_scene,
	}
	resource._model_asset = prepared
	return prepared
end

return model_asset
