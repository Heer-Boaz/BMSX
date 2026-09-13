/** Authored through Save/Reboot. Actual cartlib registration, component and rebind code execute. */
export const RUNTIME_INSPECTION_CART_SOURCE = `module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local clock<const> = require('cartlib/clock')
local registry<const> = require('cartlib/registry')
local effects<const> = require('cartlib/actioneffects')
local component<const> = require('cartlib/actioneffects/actioneffect_component')
display.reset_256x192()
clock.configure_tick_intervals(1, 1)
inspection_init_count = 0
inspection_callback_count = 0
inspection_tick = 0
local function configure<init>()
	inspection_init_count = inspection_init_count + 1
	effects.register_effect('pulse', {
		period_ms = (inspection_init_count + 1) * 10,
		initial_cooldown_ms = 7,
		handler = function() inspection_callback_count = inspection_callback_count + 1 end,
	})
end
configure()
effects.register_effect('ungranted', { period_ms = 777 })
inspection_first = component.new({ parent = { id = 'first_actor', world = { gameplay_time_ms = 100 } } })
inspection_first.id = 'inspection.first'
registry:register(inspection_first)
registry:index(inspection_first, component)
inspection_first:grant_effect('pulse')
inspection_first:activate('pulse')
inspection_second = component.new({ parent = { id = 'second_actor', world = { gameplay_time_ms = 200 } } })
inspection_second.id = 'inspection.second'
registry:register(inspection_second)
registry:index(inspection_second, component)
inspection_second:grant_effect('pulse')
inspection_effect = inspection_first.effects.pulse
inspection_other = inspection_second.effects.pulse

-- Written registration candidates are not a loaded-definition catalog.
function inspection_never_registered()
	effects.register_effect('pulse', { period_ms = 999 })
end
-- A source inspection reads paths, never runs this function or its callbacks.
function inspection_values()
	return inspection_effect.definition.period_ms,
		inspection_effect.cooldown_until_ms,
		inspection_effect.active_count,
		inspection_other.definition.period_ms,
		inspection_other.cooldown_until_ms,
		inspection_tick
end
while true do
	inspection_tick = inspection_tick + 1
	vblank.wait()
end
`;
