-- piece_tree_buffer.lua

local piece_tree_buffer = {}
piece_tree_buffer.__index = piece_tree_buffer

local added_buffer_flush_threshold = 1 << 20

local function assert_ok(condition, message)
	if not condition then
		error(message)
	end
end

local function new_buffer_block(value, precomputed_line_starts, precomputed_len)
	local block = {}
	block.value = value
	if precomputed_line_starts then
		block.line_starts = precomputed_line_starts
		block.line_starts_len = precomputed_len
		return block
	end
	local line_starts = {}
	line_starts[0] = 0
	local line_count = 1
	for i = 1, #value do
		if string.byte(value, i) == 10 then
			line_starts[line_count] = i
			line_count = line_count + 1
		end
	end
	block.line_starts = line_starts
	block.line_starts_len = line_count
	return block
end

local function added_buffer_append(self, text)
	local start = #self.value
	local start_line = self.line_starts_len - 1
	local lf = 0
	for i = 1, #text do
		if string.byte(text, i) == 10 then
			self.line_starts[self.line_starts_len] = start + i
			self.line_starts_len = self.line_starts_len + 1
			lf = lf + 1
		end
	end
	self.value = self.value .. text
	self.append_start = start
	self.append_start_line = start_line
	self.append_lf = lf
end

local function new_added_buffer()
	return {
		value = "",
		line_starts = { [0] = 0 },
		line_starts_len = 1,
		append_start = 0,
		append_start_line = 0,
		append_lf = 0,
		append = added_buffer_append,
	}
end

local function upper_bound(values, length, x)
	local low = 0
	local high = length
	while low < high do
		local mid = (low + high) >> 1
		if values[mid] <= x then
			low = mid + 1
		else
			high = mid
		end
	end
	return low
end

local function line_index_at(block, offset)
	return upper_bound(block.line_starts, block.line_starts_len, offset) - 1
end

local function new_piece_tree_node()
	return {
		buf = 0,
		start = 0,
		len = 0,
		start_line = 0,
		lf = 0,
		prio = 0,
		left = nil,
		right = nil,
		sum_len = 0,
		sum_lf = 0,
		sum_nodes = 1,
	}
end

local function imul(a, b)
	local a_lo = a & 0xffff
	local a_hi = (a >> 16) & 0xffff
	local b_lo = b & 0xffff
	local b_hi = (b >> 16) & 0xffff
	local lo = (a_lo * b_lo) & 0xffffffff
	local mid = ((a_hi * b_lo + a_lo * b_hi) & 0xffff) << 16
	return (lo + mid) & 0xffffffff
end

local function set_piece(node, buf, start, len, start_line, lf, prio)
	node.buf = buf
	node.start = start
	node.len = len
	node.start_line = start_line
	node.lf = lf
	node.prio = prio
end

local function reset_links(node)
	node.left = nil
	node.right = nil
end

function piece_tree_buffer.new(text)
	local self = setmetatable({}, piece_tree_buffer)
	self.version = 0
	self.root = nil
	self.buffers = {}
	self.buffers_len = 0
	self.original = new_buffer_block((text))
	self.added = new_added_buffer()
	self.buffers[0] = self.original
	self.buffers[1] = self.added
	self.buffers_len = 2
	self.added_index = 1
	self.free = {}
	self.rng_state = 0x12345678
	self.parts = {}
	self.stack_n = {}
	self.stack_b = {}
	self.stack_s = {}
	self.split_1 = { left = nil, right = nil }
	self.split_2 = { left = nil, right = nil }
	self.merge_split_1 = { left = nil, right = nil }
	self.merge_split_2 = { left = nil, right = nil }
	if #self.original.value > 0 then
		local node = self:alloc_node()
		local lf = self.original.line_starts_len - 1
		set_piece(node, 0, 0, #self.original.value, 0, lf, self:next_prio())
		self:recalc(node)
		self.root = node
	end
	return self
end

function piece_tree_buffer:length()
	local root = self.root
	return root and root.sum_len or 0
end

function piece_tree_buffer:char_code_at(offset)
	assert_ok(offset >= 0 and offset < self:length(), "[piece_tree_buffer] char_code_at offset out of range")
	local node = self.root
	local pos = offset
	while node do
		local left = node.left
		local left_len = left and left.sum_len or 0
		if pos < left_len then
			node = left
		else
			pos = pos - left_len
			if pos < node.len then
				return string.byte(self.buffers[node.buf].value, node.start + pos + 1)
			end
			pos = pos - node.len
			node = node.right
		end
	end
	error("[piece_tree_buffer] char_code_at traversal failed")
end

function piece_tree_buffer:insert(offset, text)
	if #text == 0 then
		return
	end
	assert_ok(offset >= 0 and offset <= self:length(), "[piece_tree_buffer] insert offset out of range")
	local node = self:alloc_node()
	if #text > added_buffer_flush_threshold then
		local buf_index = self.buffers_len
		local block = new_buffer_block(text)
		self.buffers[buf_index] = block
		self.buffers_len = self.buffers_len + 1
		local lf = block.line_starts_len - 1
		set_piece(node, buf_index, 0, #text, 0, lf, self:next_prio())
	else
		self:flush_added_buffer_if_needed(#text)
		self.added:append(text)
		set_piece(node, self.added_index, self.added.append_start, #text, self.added.append_start_line, self.added.append_lf, self:next_prio())
	end
	self:recalc(node)
	self:split_and_insert(offset, node)
	self.version = self.version + 1
end

function piece_tree_buffer:split_and_insert(offset, node)
	self:split(self.root, offset, self.split_1)
	local merged_left = self:merge_adjacent(self.split_1.left, node)
	self.root = self:merge_adjacent(merged_left, self.split_1.right)
end

function piece_tree_buffer:delete(offset, length)
	if length == 0 then
		return
	end
	local deleted = self:delete_to_subtree(offset, length)
	self:release_subtree(deleted)
end

function piece_tree_buffer:replace(offset, length, text)
	local deleted = self:replace_to_subtree(offset, length, text)
	self:release_subtree(deleted)
end

function piece_tree_buffer:delete_to_subtree(offset, length)
	assert_ok(offset >= 0 and length >= 0 and offset + length <= self:length(), "[piece_tree_buffer] delete range out of bounds")
	self:split(self.root, offset, self.split_1)
	self:split(self.split_1.right, length, self.split_2)
	local deleted = self.split_2.left
	self.root = self:merge_adjacent(self.split_1.left, self.split_2.right)
	self.version = self.version + 1
	return deleted
end

function piece_tree_buffer:replace_to_subtree(offset, length, text)
	assert_ok(offset >= 0 and length >= 0 and offset + length <= self:length(), "[piece_tree_buffer] replace range out of bounds")
	self:split(self.root, offset, self.split_1)
	self:split(self.split_1.right, length, self.split_2)
	local deleted = self.split_2.left
	local inserted = self:build_inserted_tree(text)
	local merged_left = self:merge_adjacent(self.split_1.left, inserted)
	self.root = self:merge_adjacent(merged_left, self.split_2.right)
	self.version = self.version + 1
	return deleted
end

function piece_tree_buffer:insert_subtree(offset, subtree)
	if not subtree then
		return
	end
	assert_ok(offset >= 0 and offset <= self:length(), "[piece_tree_buffer] insert_subtree offset out of range")
	self:split(self.root, offset, self.split_1)
	local merged_left = self:merge_adjacent(self.split_1.left, subtree)
	self.root = self:merge_adjacent(merged_left, self.split_1.right)
	self.version = self.version + 1
end

function piece_tree_buffer:get_line_count()
	local root = self.root
	return root and root.sum_lf + 1 or 1
end

function piece_tree_buffer:get_line_start_offset(row)
	if row <= 0 then
		return 0
	end
	return self:find_offset_of_nth_lf(row - 1) + 1
end

function piece_tree_buffer:get_line_end_offset(row)
	local line_count = self:get_line_count()
	if row >= line_count - 1 then
		return self:length()
	end
	return self:find_offset_of_nth_lf(row)
end

function piece_tree_buffer:get_line_content(row)
	local start = self:get_line_start_offset(row)
	local ending = self:get_line_end_offset(row)
	return self:get_text_range(start, ending)
end

function piece_tree_buffer:get_line_signature(row)
	local start = self:get_line_start_offset(row)
	local ending = self:get_line_end_offset(row)
	return self:compute_range_signature(start, ending)
end

function piece_tree_buffer:offset_at(row, column)
	return self:get_line_start_offset(row) + column
end

function piece_tree_buffer:position_at(offset, out)
	assert_ok(offset >= 0 and offset <= self:length(), "[piece_tree_buffer] position_at offset out of range")
	local row = self:count_lf_before(offset)
	local row_start
	if row > 0 then
		row_start = self:find_offset_of_nth_lf(row - 1) + 1
	end
	out.row = row
	out.column = offset - row_start
end

function piece_tree_buffer:get_text_range(start_offset, end_offset)
	assert_ok(start_offset >= 0 and end_offset >= start_offset and end_offset <= self:length(), "[piece_tree_buffer] get_text_range out of range")
	if start_offset == end_offset then
		return ""
	end
	local parts = self.parts
	parts.n = 0
	self:append_range_to_parts(start_offset, end_offset, parts)
	if parts.n == 1 then
		return parts[1]
	end
	local out = table.concat(parts, "", 1, parts.n)
	return out
end

function piece_tree_buffer:get_text()
	return self:get_text_range(0, self:length())
end

function piece_tree_buffer:compute_range_signature(start_offset, end_offset)
	local root = self.root
	if not root or start_offset == end_offset then
		return 0
	end
	local stack_n = self.stack_n
	local stack_b = self.stack_b
	local stack_s = self.stack_s
	stack_n.n = 0
	stack_b.n = 0
	stack_s.n = 0

	local function push(stack, value)
		local n = (stack.n or 0) + 1
		stack.n = n
		stack[n] = value
	end
	local function pop(stack)
		local n = stack.n
		local value = stack[n]
		stack[n] = nil
		stack.n = n - 1
		return value
	end

	push(stack_n, root)
	push(stack_b, 0)
	push(stack_s, 0)

	local hash = 2166136261
	while stack_n.n > 0 do
		local state = pop(stack_s)
		local base = pop(stack_b)
		local node = pop(stack_n)
		if state == 0 then
			local subtree_end = base + node.sum_len
			if subtree_end <= start_offset then
				goto continue
			end
			if base >= end_offset then
				goto continue
			end
			local left = node.left
			local left_len = left and left.sum_len or 0
			local node_start = base + left_len
			local right_base = node_start + node.len
			local right = node.right
			if right then
				push(stack_n, right)
				push(stack_b, right_base)
				push(stack_s, 0)
			end
			push(stack_n, node)
			push(stack_b, base)
			push(stack_s, 1)
			if left then
				push(stack_n, left)
				push(stack_b, base)
				push(stack_s, 0)
			end
			goto continue
		end
		local left = node.left
		local left_len = left and left.sum_len or 0
		local node_start = base + left_len
		local node_end = node_start + node.len
		if node_end <= start_offset then
			goto continue
		end
		if node_start >= end_offset then
			goto continue
		end
		local seg_start = start_offset > node_start and start_offset - node_start or 0
		local seg_end = end_offset < node_end and end_offset - node_start or node.len
		local buf_start = node.start + seg_start
		local seg_len = seg_end - seg_start
		hash = imul(hash ~ node.buf, 16777619)
		hash = imul(hash ~ buf_start, 16777619)
		hash = imul(hash ~ seg_len, 16777619)
		::continue::
	end
	return hash
end

function piece_tree_buffer:build_inserted_tree(text)
	if #text == 0 then
		return nil
	end
	local node = self:alloc_node()
	if #text > added_buffer_flush_threshold then
		local buf_index = self.buffers_len
		local block = new_buffer_block(text)
		self.buffers[buf_index] = block
		self.buffers_len = self.buffers_len + 1
		local lf = block.line_starts_len - 1
		set_piece(node, buf_index, 0, #text, 0, lf, self:next_prio())
	else
		self:flush_added_buffer_if_needed(#text)
		self.added:append(text)
		set_piece(node, self.added_index, self.added.append_start, #text, self.added.append_start_line, self.added.append_lf, self:next_prio())
	end
	self:recalc(node)
	return node
end

function piece_tree_buffer:flush_added_buffer_if_needed(append_length)
	if #self.added.value + append_length <= added_buffer_flush_threshold then
		return
	end
	if #self.added.value > 0 then
		local starts = self.added.line_starts
		local line_starts = {}
		for i = 0, self.added.line_starts_len - 1 do
			line_starts[i] = starts[i]
		end
		self.buffers[self.added_index] = new_buffer_block(self.added.value, line_starts, self.added.line_starts_len)
	end
	self.added = new_added_buffer()
	self.added_index = self.buffers_len
	self.buffers[self.added_index] = self.added
	self.buffers_len = self.buffers_len + 1
end

function piece_tree_buffer:next_prio()
	local x = self.rng_state | 0
	x = x ~ (x << 13)
	x = x ~ (x >> 17)
	x = x ~ (x << 5)
	self.rng_state = x
	return x & 0xffffffff
end

function piece_tree_buffer:alloc_node()
	local free = self.free
	local count = free.n or 0
	if count > 0 then
		local node = free[count]
		free[count] = nil
		free.n = count - 1
		reset_links(node)
		return node
	end
	return new_piece_tree_node()
end

function piece_tree_buffer:release_subtree(root)
	if not root then
		return
	end
	local stack = self.stack_n
	stack.n = 0
	local function push(value)
		local n = (stack.n or 0) + 1
		stack.n = n
		stack[n] = value
	end
	local function pop()
		local n = stack.n
		local value = stack[n]
		stack[n] = nil
		stack.n = n - 1
		return value
	end
	push(root)
	local free = self.free
	while stack.n > 0 do
		local node = pop()
		local left = node.left
		local right = node.right
		if left then
			push(left)
		end
		if right then
			push(right)
		end
		node.left = nil
		node.right = nil
		local count = (free.n or 0) + 1
		free.n = count
		free[count] = node
	end
end

function piece_tree_buffer:recalc(node)
	local left = node.left
	local right = node.right
	node.sum_len = node.len + (left and left.sum_len or 0) + (right and right.sum_len or 0)
	node.sum_lf = node.lf + (left and left.sum_lf or 0) + (right and right.sum_lf or 0)
	node.sum_nodes = 1 + (left and left.sum_nodes or 0) + (right and right.sum_nodes or 0)
end

function piece_tree_buffer:split(root, left_len, out)
	if not root then
		out.left = nil
		out.right = nil
		return
	end
	assert_ok(left_len >= 0 and left_len <= root.sum_len, "[piece_tree_buffer] split out of range")
	local left = root.left
	local left_size = left and left.sum_len or 0
	if left_len <= left_size then
		self:split(left, left_len, out)
		root.left = out.right
		self:recalc(root)
		out.right = root
		return
	end
	local right = root.right
	local right_input_offset = left_len - left_size - root.len
	if left_len >= left_size + root.len then
		self:split(right, right_input_offset, out)
		root.right = out.left
		self:recalc(root)
		out.left = root
		return
	end
	local local_cut = left_len - left_size
	local original_right = root.right
	root.right = nil
	local original_len = root.len
	local original_lf = root.lf
	local split_pos = root.start + local_cut
	local block = self.buffers[root.buf]
	local split_line = line_index_at(block, split_pos)
	local left_lf = split_line - root.start_line
	local right_lf = original_lf - left_lf
	root.len = local_cut
	root.lf = left_lf
	self:recalc(root)
	local right_frag = self:alloc_node()
	set_piece(right_frag, root.buf, split_pos, original_len - local_cut, split_line, right_lf, self:next_prio())
	self:recalc(right_frag)
	local right_tree = self:merge(right_frag, original_right)
	out.left = root
	out.right = right_tree
end

function piece_tree_buffer:merge(a, b)
	if not a then
		return b
	end
	if not b then
		return a
	end
	if a.prio < b.prio then
		a.right = self:merge(a.right, b)
		self:recalc(a)
		return a
	end
	b.left = self:merge(a, b.left)
	self:recalc(b)
	return b
end

function piece_tree_buffer:leftmost_node(root)
	local node = root
	while node.left do
		node = node.left
	end
	return node
end

function piece_tree_buffer:rightmost_node(root)
	local node = root
	while node.right do
		node = node.right
	end
	return node
end

function piece_tree_buffer:merge_adjacent(a, b)
	if not a then
		return b
	end
	if not b then
		return a
	end
	local left = a
	local right = b
	while left and right do
		local last = self:rightmost_node(left)
		local first = self:leftmost_node(right)
		if last.buf ~= first.buf or last.start + last.len ~= first.start then
			break
		end
		local left_cut = left.sum_len - last.len
		self:split(left, left_cut, self.merge_split_1)
		self:split(right, first.len, self.merge_split_2)
		local left_rest = self.merge_split_1.left
		local last_node = self.merge_split_1.right
		local first_node = self.merge_split_2.left
		local right_rest = self.merge_split_2.right
		last_node.len = last_node.len + first_node.len
		last_node.lf = last_node.lf + first_node.lf
		self:recalc(last_node)
		first_node.left = nil
		first_node.right = nil
		local free = self.free
		local count = (free.n or 0) + 1
		free.n = count
		free[count] = first_node
		left = self:merge(left_rest, last_node)
		right = right_rest
		if not right then
			return left
		end
	end
	return self:merge(left, right)
end

function piece_tree_buffer:find_offset_of_nth_lf(nth)
	local node = self.root
	local base = 0
	while node do
		local left = node.left
		local left_lf = left and left.sum_lf or 0
		if nth < left_lf then
			node = left
		else
			base = base + (left and left.sum_len or 0)
			nth = nth - left_lf
			if nth < node.lf then
				local block = self.buffers[node.buf]
				local abs_line = node.start_line + nth
				local newline_pos = block.line_starts[abs_line + 1] - 1
				return base + (newline_pos - node.start)
			end
			base = base + node.len
			nth = nth - node.lf
			node = node.right
		end
	end
	error("[piece_tree_buffer] nth lf out of range")
end

function piece_tree_buffer:count_lf_before(offset)
	local node = self.root
	local pos = offset
	local acc_lf = 0
	while node do
		local left = node.left
		local left_len = left and left.sum_len or 0
		if pos < left_len then
			node = left
		else
			pos = pos - left_len
			acc_lf = acc_lf + (left and left.sum_lf or 0)
			if pos < node.len then
				local block = self.buffers[node.buf]
				local line_at_pos = line_index_at(block, node.start + pos)
				acc_lf = acc_lf + (line_at_pos - node.start_line)
				return acc_lf
			end
			pos = pos - node.len
			acc_lf = acc_lf + node.lf
			node = node.right
		end
	end
	return acc_lf
end

function piece_tree_buffer:append_range_to_parts(start_offset, end_offset, parts)
	local root = self.root
	if not root then
		return
	end
	local stack_n = self.stack_n
	local stack_b = self.stack_b
	local stack_s = self.stack_s
	stack_n.n = 0
	stack_b.n = 0
	stack_s.n = 0
	local function push(stack, value)
		local n = (stack.n or 0) + 1
		stack.n = n
		stack[n] = value
	end
	local function pop(stack)
		local n = stack.n
		local value = stack[n]
		stack[n] = nil
		stack.n = n - 1
		return value
	end
	push(stack_n, root)
	push(stack_b, 0)
	push(stack_s, 0)
	while stack_n.n > 0 do
		local state = pop(stack_s)
		local base = pop(stack_b)
		local node = pop(stack_n)
		if state == 0 then
			local subtree_end = base + node.sum_len
			if subtree_end <= start_offset then
				goto continue
			end
			if base >= end_offset then
				goto continue
			end
			local left = node.left
			local left_len = left and left.sum_len or 0
			local node_start = base + left_len
			local right_base = node_start + node.len
			local right = node.right
			if right then
				push(stack_n, right)
				push(stack_b, right_base)
				push(stack_s, 0)
			end
			push(stack_n, node)
			push(stack_b, base)
			push(stack_s, 1)
			if left then
				push(stack_n, left)
				push(stack_b, base)
				push(stack_s, 0)
			end
			goto continue
		end
		local left = node.left
		local left_len = left and left.sum_len or 0
		local node_start = base + left_len
		local node_end = node_start + node.len
		if node_end <= start_offset then
			goto continue
		end
		if node_start >= end_offset then
			goto continue
		end
		local seg_start = start_offset > node_start and start_offset - node_start or 0
		local seg_end = end_offset < node_end and end_offset - node_start or node.len
		local block = self.buffers[node.buf].value
		parts.n = parts.n + 1
		parts[parts.n] = string.sub(block, node.start + seg_start + 1, node.start + seg_end)
		::continue::
	end
end

return piece_tree_buffer
