-- GEO's translated instances consume retained binary32 geometry. This owner
-- converts the admitted local shape through a basis only; instance origin is
-- staged separately. Bounds are reduced from the exact stored F32 vertices.
local shape_geometry<const> = {}

struct collider_geo_shape
	kind: word
	count: word
	data_offset: word
	bounds_offset: word
end

struct collider_geo_bounds
	left: f32
	top: f32
	right: f32
	bottom: f32
end

struct collider_geo_vertex
	x: f32
	y: f32
end

local piece_bytes<const> = function(address)
	local shape<const>: *collider_geo_shape = address
	return shape->kind == 1 and 64 or 32 + shape->count * 8
end

function shape_geometry.measure(address)
	local shape<const>: *collider_geo_shape = address
	if shape->kind ~= 4 then return piece_bytes(address) end
	local count<const> = shape->count
	local pieces<const> = address + shape->data_offset
	local bytes = 32
	for index = 0, count - 1 do
		bytes = bytes + piece_bytes(pieces + index * 16)
	end
	return bytes
end

local finish_piece<const> = function(descriptor_address, bounds_address, vertices_address, count)
	local shape<const>: *collider_geo_shape = descriptor_address
	shape->kind = 3
	shape->count = count
	shape->data_offset = vertices_address - descriptor_address
	shape->bounds_offset = bounds_address - descriptor_address
	local vertices<const>: *collider_geo_vertex = vertices_address
	local left, top = vertices[0].x, vertices[0].y
	local right, bottom = left, top
	for index = 1, count - 1 do
		local x<const>, y<const> = vertices[index].x, vertices[index].y
		if x < left then left = x end
		if x > right then right = x end
		if y < top then top = y end
		if y > bottom then bottom = y end
	end
	local bounds<const>: *collider_geo_bounds = bounds_address
	bounds->left = left
	bounds->top = top
	bounds->right = right
	bounds->bottom = bottom
end

local write_area<const> = function(descriptor, data, left, top, right, bottom, xx, xy, yx, yy)
	local vertices<const>: *collider_geo_vertex = data + 16
	local lx<const>, ly<const> = xx * left, xy * left
	local rx<const>, ry<const> = xx * right, xy * right
	local tx<const>, ty<const> = yx * top, yy * top
	local bx<const>, by<const> = yx * bottom, yy * bottom
	vertices[0].x = lx + tx
	vertices[0].y = ly + ty
	vertices[2].x = rx + bx
	vertices[2].y = ry + by
	if xx * yy - yx * xy < 0 then
		vertices[1].x = lx + bx
		vertices[1].y = ly + by
		vertices[3].x = rx + tx
		vertices[3].y = ry + ty
	else
		vertices[1].x = rx + tx
		vertices[1].y = ry + ty
		vertices[3].x = lx + bx
		vertices[3].y = ly + by
	end
	finish_piece(descriptor, data, data + 16, 4)
	return data + 48
end

local write_piece<const> = function(source_address, descriptor, data, xx, xy, yx, yy)
	local source<const>: *collider_geo_shape = source_address
	if source->kind == 1 then
		local area<const>: *collider_geo_bounds = source_address + source->data_offset
		return write_area(descriptor, data, area->left, area->top, area->right, area->bottom, xx, xy, yx, yy)
	end
	local count<const> = source->count
	local input<const>: *collider_geo_vertex = source_address + source->data_offset
	local output<const>: *collider_geo_vertex = data + 16
	local output_index = 0
	local output_step = 1
	if xx * yy - yx * xy < 0 then
		output_index = count - 1
		output_step = -1
	end
	for index = 0, count - 1 do
		local x<const>, y<const> = input[index].x, input[index].y
		output[output_index].x = xx * x + yx * y
		output[output_index].y = xy * x + yy * y
		output_index = output_index + output_step
	end
	finish_piece(descriptor, data, data + 16, count)
	return data + 16 + count * 8
end

local finish_compound<const> = function(destination, count)
	local output<const>: *collider_geo_shape = destination
	output->kind = 4
	output->count = count
	output->data_offset = 32
	output->bounds_offset = 16
	local pieces<const> = destination + 32
	local first<const>: *collider_geo_shape = pieces
	local first_bounds<const>: *collider_geo_bounds = pieces + first->bounds_offset
	local left, top = first_bounds->left, first_bounds->top
	local right, bottom = first_bounds->right, first_bounds->bottom
	for index = 1, count - 1 do
		local piece_address<const> = pieces + index * 16
		local piece<const>: *collider_geo_shape = piece_address
		local bounds<const>: *collider_geo_bounds = piece_address + piece->bounds_offset
		if bounds->left < left then left = bounds->left end
		if bounds->top < top then top = bounds->top end
		if bounds->right > right then right = bounds->right end
		if bounds->bottom > bottom then bottom = bounds->bottom end
	end
	local bounds<const>: *collider_geo_bounds = destination + 16
	bounds->left = left
	bounds->top = top
	bounds->right = right
	bounds->bottom = bottom
end

function shape_geometry.write(source_address, destination, xx, xy, yx, yy)
	local source<const>: *collider_geo_shape = source_address
	if source->kind ~= 4 then
		return write_piece(source_address, destination, destination + 16, xx, xy, yx, yy)
	end
	local count<const> = source->count
	local source_pieces<const> = source_address + source->data_offset
	local pieces<const> = destination + 32
	local cursor = pieces + count * 16
	for index = 0, count - 1 do
		cursor = write_piece(source_pieces + index * 16, pieces + index * 16, cursor, xx, xy, yx, yy)
	end
	finish_compound(destination, count)
	return cursor
end

function shape_geometry.write_area(destination, left, top, right, bottom, xx, xy, yx, yy)
	return write_area(destination, destination + 16, left, top, right, bottom, xx, xy, yx, yy)
end

function shape_geometry.write_strip(destination, first, last, step_x, step_y, left, top, right, bottom, xx, xy, yx, yy, collapsed)
	if collapsed then
		local first_x<const>, first_y<const> = first * step_x, first * step_y
		local last_x<const>, last_y<const> = last * step_x, last * step_y
		local x0, y0, x1, y1 = first_x, first_y, last_x, last_y
		if last_x < first_x then x0, x1 = last_x, first_x end
		if last_y < first_y then y0, y1 = last_y, first_y end
		return write_area(destination, destination + 16, left + x0, top + y0, right + x1, bottom + y1, xx, xy, yx, yy)
	end
	local count<const> = last - first + 1
	local pieces<const> = destination + 32
	local cursor = pieces + count * 16
	local x, y = first * step_x, first * step_y
	for index = 0, count - 1 do
		cursor = write_area(pieces + index * 16, cursor, left + x, top + y, right + x, bottom + y, xx, xy, yx, yy)
		x, y = x + step_x, y + step_y
	end
	finish_compound(destination, count)
	return cursor
end

return shape_geometry
