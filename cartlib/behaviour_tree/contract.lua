local contract<const> = {}

contract.result = {
	running = 1,
	success = 2,
	failure = 3,
}

contract.node_kind = {
	sequence = 1,
	selector = 2,
	parallel_all = 3,
	parallel_one = 4,
	decorator = 5,
	condition = 6,
	negated_condition = 7,
	composite_condition = 8,
	composite_or_condition = 9,
	random_selector = 10,
	limit = 11,
	wait = 12,
	action = 13,
	composite_action = 14,
	reactive_sequence = 15,
	reactive_selector = 16,
	stateful_action = 17,
	priority_selector = 18,
}

return contract
