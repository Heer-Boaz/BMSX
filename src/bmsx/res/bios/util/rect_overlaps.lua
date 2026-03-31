local rect_overlaps<const> = function(ax, ay, aw, ah, bx, by, bw, bh)
	return ax < (bx + bw) and (ax + aw) > bx and ay < (by + bh) and (ay + ah) > by
end

return rect_overlaps
