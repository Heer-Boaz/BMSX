return define_component_preset({
	id = 'overlap_trigger',
	build = function(params)
		local id_local = params.id_local or 'overlap_trigger'
		local is_trigger = params.isTrigger
		if is_trigger == nil then
			is_trigger = true
		end
		local generate_events = params.generateOverlapEvents
		if generate_events == nil then
			generate_events = true
		end
		return {{
			class = 'Collider2DComponent',
			id_local = id_local,
			isTrigger = is_trigger,
			generateOverlapEvents = generate_events,
			spaceEvents = params.spaceEvents,
		}}
	end,
})
