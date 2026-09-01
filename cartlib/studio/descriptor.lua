local bool01<const> = require('cartlib/util/bool01')
local component_class<const> = require('cartlib/component/component_class')
local dma<const> = require('cartlib/dma')
local protocol<const> = require('cartlib/studio/protocol')
local registry<const> = require('cartlib/registry')
local token<const> = require('cartlib/token')

local descriptor<const> = {}
descriptor.__index = descriptor

local transfer_word_capacity<const> = 1024
local cart_ram_address<const> = 0x30000000
local word_bytes<const> = 4

bss studio_descriptor_transfer_words: word[transfer_word_capacity]

local transfer_words<const>: *word = studio_descriptor_transfer_words
local transfer_floats<const>: *f32 = studio_descriptor_transfer_words

local stream<const> = {}
stream.__index = stream

function stream.new(copy_to_board)
	return setmetatable({
		copy_to_board = copy_to_board,
		target_word_offset = 0,
		word_count = 0,
	}, stream)
end

function stream:begin_at(target_word_offset)
	self.target_word_offset = target_word_offset
	self.word_count = 0
end

function stream:flush()
	local word_count<const> = self.word_count
	if word_count == 0 then
		return
	end
	dma.wait0_idle()
	self.copy_to_board(
		studio_descriptor_transfer_words,
		cart_ram_address + self.target_word_offset * word_bytes,
		word_count
	)
	dma.wait0_idle()
	self.target_word_offset = self.target_word_offset + word_count
	self.word_count = 0
end

function stream:word(value)
	local index<const> = self.word_count
	transfer_words[index] = value
	local word_count<const> = index + 1
	self.word_count = word_count
	if word_count == transfer_word_capacity then
		self:flush()
	end
end

function stream:f32(value)
	local index<const> = self.word_count
	transfer_floats[index] = value
	local word_count<const> = index + 1
	self.word_count = word_count
	if word_count == transfer_word_capacity then
		self:flush()
	end
end

local cache_component_identity<const> = function(comp)
	if comp._studio_component_class_word == nil then
		comp._studio_component_class_word = component_class.word(getmetatable(comp))
	end
	if comp._studio_local_id_kind ~= nil then
		return
	end
	local local_id<const> = comp.id_local
	if local_id == nil then
		comp._studio_local_id_kind = protocol.component_local_id_none
		comp._studio_local_id_value = 0
		comp._studio_local_id_hi = 0
	elseif type(local_id) == 'string' then
		local lo<const>, hi<const> = token.hash(local_id)
		comp._studio_local_id_kind = protocol.component_local_id_token
		comp._studio_local_id_value = lo
		comp._studio_local_id_hi = hi
	else
		comp._studio_local_id_kind = protocol.component_local_id_f32
		comp._studio_local_id_value = local_id
		comp._studio_local_id_hi = 0
	end
end

local prepare_visual_order<const> = function(world, objects)
	for object_index = 1, #objects do
		local obj<const> = objects[object_index]
		obj._studio_visual_order = 0
		local components<const> = obj._components
		for component_index = 1, #components do
			components[component_index]._studio_visual_order = 0
		end
	end
	world:_rebuild_render_visuals()
	local visuals<const> = world._render_visuals
	for visual_order = 1, world._render_visual_count do
		local visual<const> = visuals[visual_order]
		visual._studio_visual_order = visual_order
		visual.parent._studio_visual_order = visual_order
	end
end

function descriptor.new(copy_to_board, revision)
	return setmetatable({
		stream = stream.new(copy_to_board),
		revision = revision,
	}, descriptor)
end

local write_header<const> = function(self, runtime, world, object_count, component_count, component_offset, odd_revision)
	local writer<const> = self.stream
	local editor<const> = runtime.editor
	local selected_object_handle = 0
	if editor.selected_object ~= nil then
		selected_object_handle = registry:handle(editor.selected_object)
	end
	local selected_component_handle = 0
	if editor.selected_component ~= nil then
		selected_component_handle = registry:handle(editor.selected_component)
	end
	local hover_object_handle = 0
	if editor.hover_object ~= nil then
		hover_object_handle = registry:handle(editor.hover_object)
	end
	local flags = 0
	if world.gameplay_clock_running then
		flags = flags | protocol.flag_gameplay_running
	end
	if editor.primary_down then
		flags = flags | protocol.flag_pointer_primary
	end
	if editor.translating then
		flags = flags | protocol.flag_translating
	end
	local active_space<const> = world._active_space
	local page_size<const> = runtime.page_size
	writer:word(protocol.descriptor_magic)
	writer:word(protocol.descriptor_version)
	writer:word(odd_revision)
	writer:word(flags)
	writer:word(object_count)
	writer:word(component_count)
	writer:word(selected_object_handle)
	writer:word(selected_component_handle)
	writer:word(hover_object_handle)
	writer:word(active_space.token_lo)
	writer:word(active_space.token_hi)
	writer:word(0)
	writer:word(0)
	writer:word(page_size & 0x0000ffff)
	writer:word(page_size >> 16)
	writer:f32(editor.pointer_x)
	writer:f32(editor.pointer_y)
	writer:word(runtime.command.applied_sequence)
	writer:word(protocol.header_word_count)
	writer:word(protocol.object_stride_words)
	writer:word(component_offset)
	writer:word(protocol.component_stride_words)
	writer:word(protocol.command_word_offset)
	writer:word(protocol.command_word_count)
	writer:word(runtime.game_slot)
	writer:word(runtime.board_slot)
	writer:word(runtime.overlay_origin)
	writer:word(runtime.game_origin)
	for _ = 29, protocol.header_word_count do
		writer:word(0)
	end
end

local write_object<const> = function(writer, editor, obj, first_component)
	local left<const>, top<const>, right<const>, bottom<const> = obj:edit_bounds()
	local flags<const> = protocol.object_flag_active
		| (obj.visible and protocol.object_flag_visible or 0)
		| (obj == editor.selected_object and protocol.object_flag_selected or 0)
		| (obj == editor.hover_object and protocol.object_flag_hover or 0)
		| (left ~= nil and protocol.object_flag_has_pick_bounds or 0)
	writer:word(registry:handle(obj))
	writer:word(obj._definition_token_lo)
	writer:word(obj._definition_token_hi)
	writer:word(obj._space.token_lo)
	writer:word(obj._space.token_hi)
	writer:word(0)
	writer:f32(obj.x)
	writer:f32(obj.y)
	writer:f32(obj.z)
	writer:f32(obj.sx)
	writer:f32(obj.sy)
	if left ~= nil then
		writer:f32(left)
		writer:f32(top)
		writer:f32(right)
		writer:f32(bottom)
	else
		writer:word(0)
		writer:word(0)
		writer:word(0)
		writer:word(0)
	end
	writer:word(flags)
	writer:word(first_component)
	writer:word(#obj._components)
	writer:word(obj._studio_visual_order)
	writer:word(0)
end

local write_component<const> = function(writer, editor, comp)
	cache_component_identity(comp)
	local left<const>, top<const>, right<const>, bottom<const> = comp:edit_bounds()
	local flags = bool01(comp.enabled) * protocol.component_flag_enabled
	if left ~= nil then
		flags = flags | protocol.component_flag_has_pick_bounds
	end
	if comp.is_visual then
		flags = flags | protocol.component_flag_visual
	end
	if comp == editor.selected_component then
		flags = flags | protocol.component_flag_selected
	end
	writer:word(registry:handle(comp))
	writer:word(registry:handle(comp.parent))
	writer:word(comp._studio_component_class_word)
	local local_id_kind<const> = comp._studio_local_id_kind
	writer:word(local_id_kind)
	if local_id_kind == protocol.component_local_id_f32 then
		writer:f32(comp._studio_local_id_value)
	else
		writer:word(comp._studio_local_id_value)
	end
	writer:word(comp._studio_local_id_hi)
	writer:word(flags)
	if left ~= nil then
		writer:f32(comp.parent.x + left)
		writer:f32(comp.parent.y + top)
		writer:f32(comp.parent.x + right)
		writer:f32(comp.parent.y + bottom)
	else
		writer:word(0)
		writer:word(0)
		writer:word(0)
		writer:word(0)
	end
	writer:word(comp._studio_visual_order)
end

function descriptor:publish(runtime, world)
	local objects<const> = world._active_space._active_objects
	local object_count<const> = #objects
	local component_count = 0
	for object_index = 1, object_count do
		component_count = component_count + #objects[object_index]._components
	end
	local component_offset<const> = protocol.header_word_count
		+ object_count * protocol.object_stride_words
	local descriptor_end<const> = component_offset
		+ component_count * protocol.component_stride_words
	if descriptor_end > protocol.command_word_offset then
		error('Studio descriptor exceeds expansion-board RAM.')
	end
	prepare_visual_order(world, objects)
	local even_revision<const> = (self.revision + 2) & 0xffffffff
	local odd_revision<const> = (even_revision - 1) & 0xffffffff
	local writer<const> = self.stream
	writer:begin_at(0)
	write_header(self, runtime, world, object_count, component_count, component_offset, odd_revision)
	local first_component = 0
	for object_index = 1, object_count do
		local obj<const> = objects[object_index]
		write_object(writer, runtime.editor, obj, first_component)
		first_component = first_component + #obj._components
	end
	for object_index = 1, object_count do
		local components<const> = objects[object_index]._components
		for component_index = 1, #components do
			write_component(writer, runtime.editor, components[component_index])
		end
	end
	writer:flush()
	writer:begin_at(protocol.header_revision)
	writer:word(even_revision)
	writer:flush()
	self.revision = even_revision
end

return descriptor
