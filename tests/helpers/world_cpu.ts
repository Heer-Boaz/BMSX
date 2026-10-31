import { readFileSync } from 'node:fs';
import { GX_DISPLAY_PRESET_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_display_preset_module';
import { GX_REGISTER_MODULE_SOURCE } from '../../toolchain/ts/rompack/gx_register_module';

// Production World and its dependencies. This CPU fixture exercises structural
// ownership without configuring a GPU or substituting a host lifecycle model.
export const WORLD_CPU_MODULES = [
	'cartlib/dma', 'cartlib/irq', 'cartlib/irq/source',
	'cartlib/gx/command_list', 'cartlib/gx/display', 'cartlib/gx/gpu', 'cartlib/gx/gp0', 'cartlib/gx/vram',
	'cartlib/util/shallow_copy', 'cartlib/world/prefab', 'cartlib/world/scene', 'cartlib/world/scene_library',
	'cartlib/world/space', 'cartlib/world/system_manager', 'cartlib/world/system_schedule_syntax',
	'cartlib/world/tick_schedule', 'cartlib/world/scene_plan', 'cartlib/world/world', 'cartlib/world/world_object',
	'cartlib/world/spatial_hierarchy', 'cartlib/math/affine2', 'cartlib/math/affine3',
	'cartlib/component/transform_2d_component', 'cartlib/component/transform_3d_component',
].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') }));
WORLD_CPU_MODULES.push(
	...['gpu/system_vram_region', 'tty/layout'].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: 'bmsx/gx_display_presets', source: GX_DISPLAY_PRESET_MODULE_SOURCE },
	{ path: 'bmsx/gx_registers', source: GX_REGISTER_MODULE_SOURCE },
	{ path: 'bmsx/system_assets', source: `module<const>
rodata texture: word[3] = { 0xa0000000, 0x02d002c0, 0x00fc0140 }
return { bin_gx_system_texture_addr = texture }` },
);

export const WORLD_CPU_SETUP = `
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')
local prefab<const> = require('cartlib/world/prefab')
local scenes<const> = require('cartlib/world/scene_library')
local registry<const> = require('cartlib/registry')
local base_component<const> = require('cartlib/component/base_component')
local transform2<const> = require('cartlib/component/transform_2d_component')
local transform3<const> = require('cartlib/component/transform_3d_component')
local hierarchy<const> = require('cartlib/world/spatial_hierarchy')
world:_add_space('main')
world:_add_space('other')
world._initial_space_id = 'main'
world:set_space('main')
`;
