// Host-side boundary check: IDE-only state and BIOS boot primitives never become guest globals.

await t.waitForCart();

const runtime = t.runtime();
const cpu = runtime.machine.cpu;
const names = [
	'devtools',
	'cart_project_root_path',
	'__bmsx_next',
	'__bmsx_type',
	'__bmsx_string_byte',
	'__bmsx_error',
	'require',
	'load',
	'loadstring',
	'cart_manifest',
	'machine_manifest',
	'sys_boot_cart',
	'sys_vdp_screen_wh',
	'sys_img_ctrl',
	'img_ctrl_start',
];
for (const name of names) {
	const value = cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern(name)));
	t.assert(value === null, `${name} must not be a guest CPU global`);
}
