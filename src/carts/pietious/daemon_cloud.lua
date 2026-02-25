local daemon_cloud = {}
daemon_cloud.__index = daemon_cloud

function daemon_cloud:ctor()
	self.collider.enabled = false
	self:gfx('daemon_smoke_small')
	self.visible = false
end

local function define_daemon_cloud_fsm()
	define_fsm('daemon_cloud', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_daemon_cloud_definition()
	define_prefab({
		def_id = 'daemon_cloud',
		class = daemon_cloud,
		type = 'sprite',
		fsms = { 'daemon_cloud' },
		defaults = {
			tick_enabled = false,
		},
	})
end

return {
	define_daemon_cloud_fsm = define_daemon_cloud_fsm,
	register_daemon_cloud_definition = register_daemon_cloud_definition,
}
