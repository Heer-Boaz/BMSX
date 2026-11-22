import { WORLD_ACTOR_FIXTURE } from './world_actor_fixture';

export const PRELOAD_TRACE_CHANNELS = ['bt.compile.begin', 'bt.compile.node', 'bt.compile.end', 'bt.bind.complete'];
export const PRELOAD_SOURCE_MODULES = [
	{ path: 'observation', source: `local recorder<const> = require('testlib/behaviour_tree/compile_recorder')
return recorder.new()
` },
	{ path: 'game', source: `local library<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
${WORLD_ACTOR_FIXTURE}
local result<const> = require('cartlib/behaviour_tree/result')
local game<const> = { registrations = 0, ticks = 0, packet = string.char(0, 255, 192, 128, 65) }
local task<const> = { execute = function(target) target.executions = target.executions + 1; return result.success end }
local function configure<init>()
	game.registrations = game.registrations + 1
	library.register('preload.tree', { root = { type = 'sequence', children = {
		{ type = 'task', task = task },
	} } })
end
configure()
fixture_spawn('fixture_actor', { id = 'fixture_actor', executions = 0 }, {
	function(target)
		game.actor = component.new(target, 'preload.tree')
		game.actor.id = 'fixture.tree'
		return game.actor
	end,
})
function game.update()
	game.ticks = game.ticks + 1
	blua32.trace(game, 'fixture.tick', game.ticks)
	local actor<const> = game.actor
	actor.evaluate(actor.owner, actor, actor.operand)
end
return game
` },
	{ path: 'cart', source: `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local game<const> = require('game')
display.reset_256x192()
while true do
	game.update()
	vblank.wait()
end
` },
] as const;
