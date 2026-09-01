local cartridge_io<const> = require('cartlib/cartridge/io')
local dma<const> = require('cartlib/dma')
local protocol<const> = require('cartlib/studio/protocol')
local registry<const> = require('cartlib/registry')

local command<const> = {}
command.__index = command

local word_bytes<const> = 4

bss studio_command_words: word[protocol.command_word_count]

local command_words<const>: *word = studio_command_words
local command_floats<const>: *f32 = studio_command_words

function command.new(copy_from_board)
	return setmetatable({
		copy_from_board = copy_from_board,
		pending_sequence = 0,
		applied_sequence = 0,
	}, command)
end

function command:signal(sequence)
	self.pending_sequence = sequence
end

local selected_entry<const> = function(handle)
	if handle == 0 then
		return nil
	end
	return registry:get_handle(handle)
end

function command:apply_pending(world, editor)
	local pending_sequence<const> = self.pending_sequence
	if pending_sequence == self.applied_sequence then
		return
	end
	dma.wait0_idle()
	self.copy_from_board(
		cartridge_io.ram_address + protocol.command_word_offset * word_bytes,
		studio_command_words,
		protocol.command_word_count
	)
	dma.wait0_idle()
	local sequence<const> = command_words[protocol.command_sequence]
	if sequence ~= pending_sequence then
		error('Studio mailbox sequence does not match its command record.')
	end
	local opcode<const> = command_words[protocol.command_opcode]
	if opcode == protocol.command_select then
		editor:set_selection(
			selected_entry(command_words[protocol.command_object_handle]),
			selected_entry(command_words[protocol.command_component_handle])
		)
	elseif opcode == protocol.command_set_pos then
		local obj<const> = registry:get_handle(command_words[protocol.command_object_handle])
		obj:set_pos(
			command_floats[protocol.command_arg0],
			command_floats[protocol.command_arg1],
			command_floats[protocol.command_arg2]
		)
	elseif opcode == protocol.command_set_visible then
		local obj<const> = registry:get_handle(command_words[protocol.command_object_handle])
		obj:set_visible(command_words[protocol.command_arg0] ~= 0)
	elseif opcode == protocol.command_set_component_enabled then
		local comp<const> = registry:get_handle(command_words[protocol.command_component_handle])
		comp:set_enabled(command_words[protocol.command_arg0] ~= 0)
	elseif opcode == protocol.command_set_gameplay_running then
		world:set_gameplay_clock_running(command_words[protocol.command_arg0] ~= 0)
	elseif opcode == protocol.command_spawn then
		local obj<const> = world:spawn_by_token(
			command_words[protocol.command_token_lo],
			command_words[protocol.command_token_hi],
			{
				pos = {
					x = command_floats[protocol.command_arg0],
					y = command_floats[protocol.command_arg1],
					z = command_floats[protocol.command_arg2],
				},
			}
		)
		editor:set_selection(obj, nil)
	elseif opcode == protocol.command_dispose then
		local obj<const> = registry:get_handle(command_words[protocol.command_object_handle])
		world:mark_for_disposal(obj)
	else
		error('Unknown Studio command opcode ' .. opcode .. '.')
	end
	self.applied_sequence = sequence
end

return command
