local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')
local prefab<const> = require('cartlib/world/prefab')
local progression<const> = require('cartlib/progression')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
local poses<const> = require('poses')
local milestones<const> = require('milestones')
local sentinel_module<const> = require('sentinel')

local game_module<const> = {}
local collector<const> = {}
local drop_actor<const> = {}
local game<const> = {}

function collector:ctor()
    self.x = 144
    self.y = 208
    self.width = 32
    self.height = 16
    self.bob = 0
    self.opening = 0
    self.recoil = 0
    self.bank = 0
    self.timelines:define('idle', poses.collector_idle)
    self.timelines:define('catch', poses.collector_catch)
    self.timelines:define('hurt', poses.collector_hurt)
    self.timelines:play('idle')
end

function drop_actor:ctor()
    self.x = 0
    self.y = 28
    self.width = 8
    self.height = 8
    self.danger = false
    self.delay = 20
end

function game:ctor()
    self.visible = false
    self.phase = 'ready'
    self.score = 0
    self.lives = 3
    self.wave = 0
    self.flash = 0
    self.frame = 0
    self.blocked = 0
    self.shield_boost = false
    self.player = world:spawn('starcatch.collector', {})
    self.drop = world:spawn('starcatch.drop', {})
    self.sentinel = world:spawn(sentinel_module.prefab_id, { game = self })
    self.event_payload = { score = 0, lives = 3, wave = 0, danger = false }
    self:next_drop()
end

function game:bind()
    self.progress_state = progression.new_state(milestones)
    progression.mount(self, milestones, self.progress_state)
end

function game:unbind()
    progression.unmount(self)
    world_object.unbind(self)
end

function game:start()
    self.phase = 'play'
    world:set_gameplay_clock_running(true)
end

function game:finish(phase)
    self.phase = phase
    self.sentinel.brain:stop()
    self.sentinel:announce_drop(false)
    world:set_gameplay_clock_running(false)
end

function game:next_drop()
    self.wave = self.wave + 1
    local drop<const> = self.drop
    drop.x = 16 + (self.wave * 73 + 75) % 280
    drop.y = 28
    drop.danger = self.wave % 3 == 0
    drop.delay = 20
    self.sentinel:announce_drop(drop.danger)
end

function game:emit(event)
    local payload<const> = self.event_payload
    payload.score = self.score
    payload.lives = self.lives
    payload.wave = self.wave
    payload.danger = self.drop.danger
    self.events:emit(event, payload)
end

function game:finish_drop(caught)
    if self.drop.danger then
        if caught then
            self.lives = self.lives - 1
            self.flash = 15
            self.player.timelines:play('hurt')
            self:emit('starcatch.hurt')
        end
    elseif caught then
        self.score = self.score + 1
        self.player.timelines:play('catch')
        self:emit('starcatch.gold_caught')
    else
        self.lives = self.lives - 1
        self.flash = 15
        self.player.timelines:play('hurt')
        self:emit('starcatch.missed')
    end
    if self.lives == 0 then self:finish('over') end
    if self.phase == 'play' then self:next_drop() end
end

function game:step()
    self.frame = self.frame + 1
    if self.flash > 0 then self.flash = self.flash - 1 end
    if self.phase ~= 'play' then return end

    local player<const> = self.player
    local direction = 0
    if input.is_action_pressed(1, clock.frame, 'left') then direction = direction - 1 end
    if input.is_action_pressed(1, clock.frame, 'right') then direction = direction + 1 end
    player.x = math.max(8, math.min(280, player.x + direction * 4))
    player.bank = direction * 0.16

    local drop<const> = self.drop
    if drop.delay > 0 then
        drop.delay = drop.delay - 1
        return
    end
    drop.y = drop.y + 2 + self.score // 4
    if drop.y + 8 >= 204 and drop.y <= 212
        and drop.x + 8 > player.x and drop.x < player.x + 32 then
        self:finish_drop(true)
    elseif drop.y > 232 then
        self:finish_drop(false)
    end
end

function game:after_world()
    local sentinel<const> = self.sentinel
    if sentinel.intercept_requested then
        sentinel.intercept_requested = false
        self.blocked = self.blocked + 1
        -- Publish the next threat only after the BT evaluator has returned.
        sentinel:announce_drop(false)
        sentinel.timelines:play('sentinel_block')
        self:emit('starcatch.blocked')
        self:next_drop()
    end
end

function game_module.install()
    prefab.define({
        def_id = 'starcatch.collector',
        class = collector,
        components = { timeline_component.new },
    })
    prefab.define({ def_id = 'starcatch.drop', class = drop_actor })
    prefab.define({ def_id = 'starcatch.game', class = game })
    sentinel_module.install()
end

function game_module.new()
    world:clear()
    local match<const> = world:spawn('starcatch.game', {})
    world:set_gameplay_clock_running(false)
    return match
end

return game_module
