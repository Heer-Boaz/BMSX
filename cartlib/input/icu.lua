module<const>

-- Raw input-controller register contract. PlayerInput resolves bindings to
-- these word addresses once; frame sampling then reads the retained addresses
-- directly without a device facade or per-sample address decoding.
return {
	control_address = 0x08000064,
	sample_next_vblank = 0x00000001,
	keyboard_bitmap_address = 0x0800006c,
	pointer_buttons_address = 0x0800008c,
	pointer_x_q16_address = 0x08000090,
	pointer_y_q16_address = 0x08000094,
	pointer_wheel_q16_address = 0x08000098,
	gamepad_base_address = 0x0800009c,
	gamepad_stride = 0x0000001c,
	gamepad_buttons_offset = 0x00000000,
	gamepad_left_x_q16_offset = 0x00000004,
	gamepad_left_y_q16_offset = 0x00000008,
	gamepad_right_x_q16_offset = 0x0000000c,
	gamepad_right_y_q16_offset = 0x00000010,
	gamepad_left_trigger_q16_offset = 0x00000014,
	gamepad_right_trigger_q16_offset = 0x00000018,
}
