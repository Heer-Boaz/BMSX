local draw_charge_flash<const> = function(component, draw)
	local owner<const> = component.parent
	if owner.flash_visible then
		owner.flash_sources[owner.flash_frame]:blit(
			draw,
			owner.x + owner.flash_offset_x,
			owner.y + owner.flash_offset_y
		)
	end
end

return draw_charge_flash
