-- Combat depth is a screen-space presentation effect, not another actor pose.
-- The animation sample supplies its full geometry origin and scale. Momentum's
-- depth weight scales that geometry from its authored origin and offsets it vertically;
-- exactly one affine is committed over the immutable authored attachment.
local combat_pose<const> = {}

function combat_pose.write(visual, x, y, scale_x, scale_y, weight, camera_y)
	local depth_scale<const> = 1 + combat_parallax_scale_delta * math.abs(weight)
	visual:set_presentation_affine(scale_x * depth_scale, 0, 0, scale_y * depth_scale,
		x - visual.attachment_ox,
		y - visual.attachment_oy + camera_y * weight)
end

return combat_pose
