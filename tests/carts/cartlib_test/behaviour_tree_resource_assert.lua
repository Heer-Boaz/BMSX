__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	assert(
		cartlib_test_behaviour_tree_resource_ready == true,
		'cooked Behavior Tree resource did not execute through cartlib admission'
	)
end

function __bmsx_host_test.update(_frame)
	return true
end
