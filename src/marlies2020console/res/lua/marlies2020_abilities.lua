local playerAbilityIds = {
	fire = 'marlies2020.player.fire',
	interact = 'marlies2020.player.interact',
	move_horizontal = 'marlies2020.player.move_horizontal',
	move_horizontal_stop = 'marlies2020.player.move_horizontal_stop',
	move_vertical = 'marlies2020.player.move_vertical',
	move_vertical_stop = 'marlies2020.player.move_vertical_stop',
	hurt = 'marlies2020.player.hurt',
}

local playerInputProgram = {
	schema = 1,
	bindings = {{
		name = 'move_left',
		priority = 10,
		on = {
			hold = 'move_left[h]',
			release = 'move_left[jr]',
		},
		['do'] = {
			hold = {{
				['ability.request'] = {
					id = playerAbilityIds.move_horizontal,
					payload = {
						direction = 'left',
					},
				},
			}, {
				['input.consume'] = 'move_left',
			}},
			release = {{
				['ability.request'] = {
					id = playerAbilityIds.move_horizontal_stop,
				},
			}, {
				['input.consume'] = 'move_left',
			}},
		},
	}, {
		name = 'move_right',
		priority = 10,
		on = {
			hold = 'move_right[h]',
			release = 'move_right[jr]',
		},
		['do'] = {
			hold = {{
				['ability.request'] = {
					id = playerAbilityIds.move_horizontal,
					payload = {
						direction = 'right',
					},
				},
			}, {
				['input.consume'] = 'move_right',
			}},
			release = {{
				['ability.request'] = {
					id = playerAbilityIds.move_horizontal_stop,
				},
			}, {
				['input.consume'] = 'move_right',
			}},
		},
	}, {
		name = 'move_up',
		priority = 9,
		on = {
			hold = 'move_up[h]',
			release = 'move_up[jr]',
		},
		['do'] = {
			hold = {{
				['ability.request'] = {
					id = playerAbilityIds.move_vertical,
					payload = {
						direction = 'up',
					},
				},
			}, {
				['input.consume'] = 'move_up',
			}},
			release = {{
				['ability.request'] = {
					id = playerAbilityIds.move_vertical_stop,
				},
			}, {
				['input.consume'] = 'move_up',
			}},
		},
	}, {
		name = 'move_down',
		priority = 9,
		on = {
			hold = 'move_down[h]',
			release = 'move_down[jr]',
		},
		['do'] = {
			hold = {{
				['ability.request'] = {
					id = playerAbilityIds.move_vertical,
					payload = {
						direction = 'down',
					},
				},
			}, {
				['input.consume'] = 'move_down',
			}},
			release = {{
				['ability.request'] = {
					id = playerAbilityIds.move_vertical_stop,
				},
			}, {
				['input.consume'] = 'move_down',
			}},
		},
	}, {
		name = 'fire',
		priority = 8,
		on = {
			press = 'fire[j]',
		},
		['do'] = {
			press = {{
				['ability.request'] = {
					id = playerAbilityIds.fire,
				},
			}, {
				['input.consume'] = 'fire',
			}},
		},
	}, {
		name = 'interact',
		priority = 8,
		on = {
			press = 'interact[j]',
		},
		['do'] = {
			press = {{
				['ability.request'] = {
					id = playerAbilityIds.interact,
				},
			}, {
				['input.consume'] = 'interact',
			}},
		},
	}},
}

local playerAbilityOrder = {
	playerAbilityIds.fire,
	playerAbilityIds.interact,
	playerAbilityIds.move_horizontal,
	playerAbilityIds.move_horizontal_stop,
	playerAbilityIds.move_vertical,
	playerAbilityIds.move_vertical_stop,
	playerAbilityIds.hurt,
}

return {
	abilityIds = playerAbilityIds,
	inputProgram = playerInputProgram,
	abilityOrder = playerAbilityOrder,
}
