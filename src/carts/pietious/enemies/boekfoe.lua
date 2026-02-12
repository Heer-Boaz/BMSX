local constants = require('constants')
local behaviourtree = require('behaviourtree')

local boekfoe = {}

function boekfoe.configure(self, def)
	self.width = def.w or 21
	self.height = def.h or 24
	self.max_health = def.health or 6
	self.health = self.max_health
	self.damage = def.damage or 4
	self.boek_state = 'closed'
	self:set_body_hit_area(0, 0, 21, 24)
end

function boekfoe.sync_components(self)
	local imgid = 'boekfoe_closed'
	if self.boek_state == 'open' then
		imgid = 'boekfoe_open'
	end
	self:set_body_sprite(imgid, self.direction == 'left', false)
end

function boekfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata

	if self.boek_state == 'closed' then
		local closed_ticks = node.boek_state_ticks
		if closed_ticks == nil then
			closed_ticks = constants.enemy.boek_wait_open_steps
		end
		closed_ticks = closed_ticks - 1
		if closed_ticks > 0 then
			node.boek_state_ticks = closed_ticks
			return behaviourtree.running
		end
		self.boek_state = 'open'
		node.boek_state_ticks = constants.enemy.boek_wait_close_steps
		node.boek_spawn_ticks = constants.enemy.boek_spawn_paper_steps
		return behaviourtree.running
	end

	local open_ticks = node.boek_state_ticks
	if open_ticks == nil then
		open_ticks = constants.enemy.boek_wait_close_steps
	end
	open_ticks = open_ticks - 1

	local spawn_ticks = node.boek_spawn_ticks
	if spawn_ticks == nil then
		spawn_ticks = constants.enemy.boek_spawn_paper_steps
	end
	spawn_ticks = spawn_ticks - 1

	if spawn_ticks <= 0 then
		local y_speed_num = math.random(-5, 4)
		self:spawn_child_enemy('paperfoe', self.x, self.y, {
			direction = self.direction == 'left' and 'left' or 'right',
			speedx = (self.direction == 'left' and -constants.enemy.paper_speed_x or constants.enemy.paper_speed_x) * 5,
			speedy = y_speed_num,
			speedden = 5,
		})
		spawn_ticks = constants.enemy.boek_spawn_paper_steps
	end

	if open_ticks <= 0 then
		self.boek_state = 'closed'
		node.boek_state_ticks = constants.enemy.boek_wait_open_steps
		node.boek_spawn_ticks = nil
		return behaviourtree.running
	end

	node.boek_state_ticks = open_ticks
	node.boek_spawn_ticks = spawn_ticks
	return behaviourtree.running
end

function boekfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return boekfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function boekfoe.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.boek_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.boek_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return boekfoe
