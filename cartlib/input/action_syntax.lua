local action_syntax<const> = {}

action_syntax.modifier_kind = {
	pressed = 1,
	released = 2,
	just_pressed = 3,
	all_just_pressed = 4,
	just_released = 5,
	all_just_released = 6,
	guarded_just_pressed = 7,
	repeat_pressed = 8,
	consumed = 9,
	held = 10,
	within_press = 11,
	within_release = 12,
	press_time = 13,
	repeat_count = 14,
}

action_syntax.node_kind = {
	action = 1,
	logical_not = 2,
	logical_and = 3,
	logical_or = 4,
	function_call = 5,
}

action_syntax.function_kind = {
	all = 1,
	any = 2,
	any_just_pressed = 3,
	all_just_pressed = 4,
	any_just_released = 5,
	all_just_released = 6,
	any_guarded_just_pressed = 7,
	all_guarded_just_pressed = 8,
	any_repeat_pressed = 9,
	all_repeat_pressed = 10,
	any_within_press = 11,
	all_within_press = 12,
	any_within_release = 13,
	all_within_release = 14,
}

action_syntax.compare_operator = {
	less_than = 1,
	greater_than = 2,
	less_equal = 3,
	greater_equal = 4,
	equal = 5,
	not_equal = 6,
}

action_syntax.edge = {
	just_pressed = 0x01,
	just_released = 0x02,
	within_press = 0x04,
	within_release = 0x08,
	guarded_just_pressed = 0x10,
	repeat_pressed = 0x20,
}

return action_syntax
