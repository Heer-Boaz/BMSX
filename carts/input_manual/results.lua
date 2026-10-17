module<const>

struct input_manual_result
	completed_samples: word
	previous_sequence: word
	sample_sequence: word
	key_a: word
	key_pressed: word
	key_released: word
	press_count: word
	release_count: word
	last_press: word
	last_release: word
	keyboard: word[8]
	pointer_buttons: word
	pointer_x: word
	pointer_y: word
	pointer_wheel: word
	pads: word[28]
	rumble_support: word
end

bss result: input_manual_result

return { result = result }
