-- undo.lua

local undo = {}

local text_undo_op = {}
text_undo_op.__index = text_undo_op

function text_undo_op.new()
	return setmetatable({
		kind = "insert",
		offset = 0,
		deleted_len = 0,
		inserted_len = 0,
		deleted_root = nil,
		inserted_root = nil,
	}, text_undo_op)
end

function text_undo_op:set_insert(offset, inserted_len)
	self.kind = "insert"
	self.offset = offset
	self.deleted_len = 0
	self.inserted_len = inserted_len
	self.deleted_root = nil
	self.inserted_root = nil
end

function text_undo_op:set_delete(offset, deleted_len, deleted_root)
	self.kind = "delete"
	self.offset = offset
	self.deleted_len = deleted_len
	self.inserted_len = 0
	self.deleted_root = deleted_root
	self.inserted_root = nil
end

function text_undo_op:set_replace(offset, deleted_len, deleted_root, inserted_len)
	self.kind = "replace"
	self.offset = offset
	self.deleted_len = deleted_len
	self.inserted_len = inserted_len
	self.deleted_root = deleted_root
	self.inserted_root = nil
end

local undo_record = {}
undo_record.__index = undo_record

function undo_record.new()
	return setmetatable({
		ops = {},
		before_cursor_row = 0,
		before_cursor_column = 0,
		before_scroll_row = 0,
		before_scroll_column = 0,
		before_has_selection_anchor = false,
		before_selection_anchor_row = 0,
		before_selection_anchor_column = 0,
		after_cursor_row = 0,
		after_cursor_column = 0,
		after_scroll_row = 0,
		after_scroll_column = 0,
		after_has_selection_anchor = false,
		after_selection_anchor_row = 0,
		after_selection_anchor_column = 0,
	}, undo_record)
end

function undo_record:set_before_state(cursor_row, cursor_column, scroll_row, scroll_column, selection_anchor_row, selection_anchor_column, has_selection_anchor)
	self.before_cursor_row = cursor_row
	self.before_cursor_column = cursor_column
	self.before_scroll_row = scroll_row
	self.before_scroll_column = scroll_column
	self.before_has_selection_anchor = has_selection_anchor
	self.before_selection_anchor_row = selection_anchor_row
	self.before_selection_anchor_column = selection_anchor_column
end

function undo_record:set_after_state(cursor_row, cursor_column, scroll_row, scroll_column, selection_anchor_row, selection_anchor_column, has_selection_anchor)
	self.after_cursor_row = cursor_row
	self.after_cursor_column = cursor_column
	self.after_scroll_row = scroll_row
	self.after_scroll_column = scroll_column
	self.after_has_selection_anchor = has_selection_anchor
	self.after_selection_anchor_row = selection_anchor_row
	self.after_selection_anchor_column = selection_anchor_column
end

undo.text_undo_op = text_undo_op
undo.undo_record = undo_record

return undo
