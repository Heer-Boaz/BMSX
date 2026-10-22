local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local bt_library<const> = require('cartlib/behaviour_tree/library')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local prefab<const> = require('cartlib/world/prefab')
local poses<const> = require('poses')

local sentinel_module<const> = { prefab_id = 'starcatch.sentinel' }
local sentinel<const> = {}
local danger_key<const> = blackboard.key('danger', false)

local move_to_threat<const> = {
    tick = function(self, _execution)
        self.mode = 'seek'
        local target_x<const> = self.game.drop.x + 4
        local speed = 2.5
        if self.game.shield_boost then speed = 4 end
        if self.x < target_x then
            self.x = math.min(target_x, self.x + speed)
        else
            self.x = math.max(target_x, self.x - speed)
        end
        if math.abs(self.x - target_x) <= 5 then
            self.mode = 'intercept'
            return bt_result.success
        end
        return bt_result.running
    end,
}

local wait_and_intercept<const> = {
    tick = function(self, _execution)
        self.mode = 'intercept'
        local drop<const> = self.game.drop
        local center_y<const> = drop.y + 4
        if center_y > self.y + 12 then return bt_result.failure end
        if center_y >= self.y - 8 and center_y <= self.y + 12
            and math.abs(self.x - (drop.x + 4)) <= 12 then
            -- The game consumes this after the World closes its update barrier.
            self.intercept_requested = true
            self.mode = 'block'
            return bt_result.success
        end
        return bt_result.running
    end,
}

local patrol<const> = {
    tick = function(self, _execution)
        self.mode = 'patrol'
        self.x = self.x + self.patrol_direction * 1.25
        if self.x >= 288 then
            self.x = 288
            self.patrol_direction = -1
        elseif self.x <= 32 then
            self.x = 32
            self.patrol_direction = 1
        end
        return bt_result.running
    end,
}

function sentinel:ctor(options)
    self.game = options.game
    self.x = 160
    self.y = 76
    self.bob = 0
    self.opening = 0
    self.spin = 0
    self.recoil = 0
    self.unlocked = false
    self.visible = false
    self.mode = 'locked'
    self.patrol_direction = 1
    self.intercept_requested = false
    self.brain = self:get_component(bt_component)
    self.brain:stop()
    self.timelines:define('idle', poses.sentinel_idle)
    self.timelines:define('intercept_open', poses.intercept_open)
    self.timelines:define('sentinel_block', poses.sentinel_block)
end

function sentinel:unlock()
    self.unlocked = true
    self.visible = true
    self.mode = 'patrol'
    self.timelines:play('idle')
    self.brain:start()
end

function sentinel:announce_drop(danger)
    if not danger and self.mode ~= 'block' then self.opening = 0 end
    self.brain.blackboard:set(danger_key, danger)
end

function sentinel_module.install()
    bt_library.register('starcatch.sentinel', {
        blackboard = { danger_key },
        root = {
            type = 'selector',
            children = {
                {
                    type = 'sequence',
                    decorators = {{
                        type = 'blackboard',
                        key = danger_key,
                        operation = 'equal',
                        value = true,
                        observer_aborts = 'both',
                    }},
                    children = {
                        { type = 'task', task = move_to_threat },
                        { type = 'timeline', timeline_id = 'intercept_open' },
                        { type = 'task', task = wait_and_intercept },
                    },
                },
                { type = 'task', task = patrol },
            },
        },
    })
    prefab.define({
        def_id = sentinel_module.prefab_id,
        class = sentinel,
        components = {
            timeline_component.new,
            bt_component.factory('starcatch.sentinel'),
        },
    })
end

return sentinel_module
