local start<const> = require('bmsx/startup')
local heap<const> = require('kernel/heap_bootstrap')
local diagnostics<const> = require('kernel/boot_diagnostics')
local image_bind<const> = require('kernel/system_image_bind')
local root_inputs<const> = require('kernel/gc_root_inputs')
local thread<const> = require('kernel/thread_create')
local root<const> = require('kernel/root_activation')
local retirement<const> = require('kernel/thread_retire')
local bindings<const> = require('kernel/warm_bindings')
local allocator<const> = require('kernel/dlmalloc')
local heap_floor<const> = require('kernel/heap_floor').internal
local stopped_roots<const> = require('kernel/gc_stopped_roots')
local gc<const> = require('kernel/gc_control').internal
local layout<const> = require('kernel/gc_runtime_layout')

local ram_base<const> = 0x08000000
local static_base<const> = 0x08040000
local management<const> = 0x003fc000
local installed<const> = ram_base + management + layout.installed_image_bindings_offset
local system_bank<const> = ram_base + management + layout.system_global_bank_offset
local ordinary_bank<const> = system_bank + sizeof(namespace_bank)
local arena<const> = management + 0x400
local system_fit<const>: *u32 = 0x080101f4
local cart0_fit<const>: *u32 = 0x080101f8
local boot_image_address<const>: *addr = 32
local sys_control<const>: *u32 = 0x0801034c

struct boot_image
	before_constants: u32[5]
	constants: addr
	constant_count: u32
	before_directory: u32[4]
	buckets: addr
	bucket_count: u32
	before_sections: u32[2]
	data_source: addr
	data_size: u32
	data_target: addr
	bss_target: addr
	bss_size: u32
end

local inhibit_reset<const> = 0x100
local stop_reset<const> = function()
	-- Refusal completes the protected operation. Release reset before
	-- SYSTEM takes the CPU into the non-resumable supervisor state.
	cop0.status = cop0.status & ~inhibit_reset
	*sys_control = 8
	while true do halt_until_irq end
end

cop0.status = cop0.status | inhibit_reset
local head<const>: *root_head_input = ram_base + management + layout.remark_head_offset
head.string_index_tag = 0 -- T:5325 C:3220; retire the old binding before stopped collection
head.string_index_word = 0 -- T:5326 C:3221
local header<const> = *boot_image_address
local image<const>: *boot_image = header
local data_end<const>, bss_end<const> = image.data_target + image.data_size, image.bss_target + image.bss_size
local static_end = data_end > bss_end and data_end or bss_end
if static_end < static_base then static_end = static_base end
local floor<const> = ((static_end - ram_base + 4095) & ~4095)
local address = cop0.context
if address == 0 then
	heap.initialize_heap(management, floor)
	local records<const>: *u32 = installed
	for word = 0, ((ordinary_bank + sizeof(namespace_bank) - installed) >> 2) - 1 do records[word] = 0 end
	if diagnostics.initialize_diagnostics(management, image.constants) ~= 0 then stop_reset() end
	local thread_offset<const> = thread.create_thread(management, 0)
	if thread_offset == 0 then stop_reset() end
	address = ram_base + thread_offset
else
	retirement.retire_threads(management, address, cop0.previous_active)
	bindings.retire_namespaces(management, system_bank, ordinary_bank)
	-- The old bindings are still roots until the new physical floor has
	-- been accepted. An initial refusal can run the same stopped collector.
	if allocator.bmsx_dlmalloc_set_floor(arena, floor) == 0 then
		local control<const> = management + layout.control_offset
		local epochs<const> = gc.active(control) and 2 or 1
		stopped_roots.publish(management, address)
		heap_floor.collect_for_floor(management, control, epochs)
		root_inputs.release_string_work(management)
		if allocator.bmsx_dlmalloc_set_floor(arena, floor) == 0 then
			-- The refused floor is stable and the old image remains installed.
			stop_reset()
		end
	end
	bindings.retire_images(management, installed)
end
cop0.ram_end = ram_base + floor
heap.publish_system_directory(management, image.buckets, image.bucket_count)
if image_bind.bind_initial_image(management, header, ordinary_bank, system_bank, installed, *system_fit, *cart0_fit, address) ~= 0 then stop_reset() end
root.publish_system_root(address, start.prepared_entry)
cop0.context = address
