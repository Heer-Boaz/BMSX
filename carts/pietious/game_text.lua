module<const>

struct game_text_record
	death_screen: string
end

rodata game_text: game_text_record = {
	death_screen = 'PROBEER HET NOG EENS...',
}

return {
	game_text = game_text,
}
