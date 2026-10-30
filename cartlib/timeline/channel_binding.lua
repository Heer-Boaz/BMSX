-- Cold output admission. Component classes own the writable channel surface;
-- generated evaluators retain concrete receivers and substantive AOT writers.
local transform2<const> = require('cartlib/component/transform_2d_component')
local transform3<const> = require('cartlib/component/transform_3d_component')
local visual2<const> = require('cartlib/component/visual_2d_component')
local binding<const> = {}

function binding.operation(name)
	if name == 'local_origin2' then return transform2.timeline_channels.groups[name] end
	if name == 'local_origin3' then return transform3.timeline_channels.groups[name] end
	if name == 'local_affine2' then return transform2.affine.timeline_channels.groups[name] end
	if name == 'local_affine3' then return transform3.affine.timeline_channels.groups[name] end
	local visual_group<const> = visual2.timeline_channels.groups[name]
	if visual_group ~= nil then return visual_group end
	error('unknown timeline spatial operation: ' .. name)
end

function binding.target(entry, index)
	if index == 1 then return entry.primary_binding end
	return entry.bindings[index]
end

function binding.resolve(entry)
	local program<const> = entry.program
	local paths<const> = program.output_paths
	local receivers = entry.output_receivers
	if receivers == nil then receivers = {}; entry.output_receivers = receivers end
	for index = 1, #paths do
		local output<const> = paths[index]
		local receiver = binding.target(entry, output.binding_index)
		local path<const> = output.path
		for depth = 1, #path - 1 do receiver = receiver[path[depth]] end
		local field<const> = path[#path]
		local channels<const> = receiver.timeline_channels
		if channels ~= nil and channels.protected[field] then
			error('timeline raw write targets a protected channel: ' .. field)
		end
		receivers[index] = receiver
	end
	for index = #paths + 1, #receivers do receivers[index] = nil end
	local outputs<const> = program.writer_outputs
	if #outputs == 0 then
		entry.channel_writers = nil
		return
	end
	local writers = entry.channel_writers
	if writers == nil then writers = {}; entry.channel_writers = writers end
	for index = 1, #outputs do
		local output<const> = outputs[index]
		local receiver<const> = binding.target(entry, output.binding_index)
		local channels<const> = receiver.timeline_channels
		if channels == nil then error('timeline binding has no declared writer channels') end
		if output.operation ~= nil then
			local groups<const> = channels.groups
			local group<const> = groups and groups[output.operation]
			if group == nil then error('timeline binding does not admit ' .. output.operation) end
			if program.phase == 'presentation' and group.phase == 'physical' then
				error('presentation timeline cannot write a physical transform')
			end
			writers[index] = group.write
		else
			local properties<const> = channels.properties
			local writer<const> = properties and properties[output.property]
			if writer == nil then error('timeline property has no declared writer: ' .. output.property) end
			writers[index] = writer
		end
	end
	for index = #outputs + 1, #writers do writers[index] = nil end
end

return binding
