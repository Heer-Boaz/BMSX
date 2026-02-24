local dialogue = {}
local stagger = require('stagger')

function dialogue.register_methods(director)

	function director:show_dialogue_page(typed)
		local page = self.pages[self.page_index]
		clear_text(text_choice_id)
		stagger.play(self, 'calm', {
			bg = object(bg_id),
			bg_dim = false,
			text_main = object(text_main_id),
			text_choice = object(text_choice_id),
			text_prompt = object(text_prompt_id),
			text_lines = page,
			text_typed = typed,
		})
	end

	function director:skip_typing()
		if object(text_main_id).is_typing then
			finish_text(text_main_id)
			self:update_dialogue_prompt()
			consume_action('b')
			return true
		end
		return false
	end

	function director:update_dialogue_prompt()
		local main = object(text_main_id)
		if main.is_typing then
			set_prompt_line('(B) skip')
			return
		end
		if self.page_index < #self.pages then
			set_prompt_line('(A) Next')
			return
		end
		set_prompt_line('(A) Continue')
	end

	function director:setup_choice_menu(node)
		local choice_lines = {}
		for i = 1, #node.options do
			choice_lines[i] = node.options[i].label
		end
		stagger.play(self, 'calm', {
			bg = object(bg_id),
			bg_dim = false,
			text_main = object(text_main_id),
			text_choice = object(text_choice_id),
			text_prompt = object(text_prompt_id),
			text_lines = node.prompt,
			text_choice_lines = choice_lines,
			text_typed = true,
		})
		self.choice_index = 1
	end
end

function dialogue.register_states(states)

	states.bg_only = {
		entering_state = function(self)
			local node = story[self.node_id]
			apply_background(node.bg)
			local bg = object(bg_id)
			bg.visible = true
			bg.sprite_component.colorize = { r = 1, g = 1, b = 1, a = 1 }
			hide_combat_sprites()
			clear_texts(text_ids_all)
			reset_text_colors()
		end,
		input_eval = 'first',
		input_event_handlers = {
			['a[jp]'] = {
				go = function(self)
					local node = story[self.node_id]
					self.node_id = node.next
					return '/run_node'
				end,
			},
		},
	}

	states.dialogue = {
		entering_state = function(self)
			local node = story[self.node_id]
			apply_background(node.bg)
			object(bg_id).visible = true
			reset_text_colors()
			if node.kind == 'dialogue_inline' then
				self.pages = self.inline_pages
			else
				self.pages = node.pages
			end
			self.page_index = 1
			clear_text(text_transition_id)
			self:show_dialogue_page(node.typed)
			self:update_dialogue_prompt()
		end,
		tick = function(self)
			if self.stagger_blocked then
				return
			end

			local main = object(text_main_id)
			if main.is_typing then
				main:type_next()
			end
			self:update_dialogue_prompt()
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self:skip_typing()
				end
			},
			['a[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
						if object(text_main_id).is_typing then return end

					if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node = story[self.node_id]
						self:show_dialogue_page(node.typed)
						self:update_dialogue_prompt()
						return
					end
					local node = story[self.node_id]
					if node.kind == 'dialogue_inline' then
						self.node_id = self.inline_next
						self.inline_pages = {}
						self.inline_next = ''
					else
						self.node_id = node.next
					end
					return '/run_node'
				end,
			},
		},
	}

	states.ending = {
		entering_state = function(self)
			local node = story[self.node_id]
			apply_background(node.bg)
			object(bg_id).visible = true
			reset_text_colors()
			clear_text(text_transition_id)
			clear_text(text_choice_id)
			clear_text(text_prompt_id)
			local total = self.stats.planning + self.stats.opdekin + self.stats.rust + self.stats.makeup
			local title = ''
			local total_line = ''
			local line1 = ''
			local line2 = ''
			if total <= 1 then
				title = 'Ending C - Bijna, maar net niet'
				total_line = 'Totaal <= 1 (' .. total .. ')'
				line1 = 'Verslag wordt op het nippertje (of net te laat) ingeleverd.'
				line2 = 'Maya leert: zonder voorbereiding wint de mist.'
			elseif total <= 5 then
				title = 'Ending B - School op de rails'
				total_line = 'Totaal 2-5 (' .. total .. ')'
				line1 = 'Maya levert op tijd in en is redelijk rustig.'
				line2 = 'Make-up is "goed genoeg" en geen tijddief meer.'
			else
				title = 'Ending A - Klokmeester: Stijlvol en Stabiel'
				total_line = 'Totaal >= 6 (' .. total .. ')'
				line1 = 'Maya is op tijd, voorbereid, en straalt zonder stress.'
				line2 = 'School is leidend, en extras passen er naast.'
			end
			self.pages = {
				{ title, total_line },
				{ line1, line2 },
				{
					'Planning: ' .. self.stats.planning,
					'Opdekin: ' .. self.stats.opdekin,
					'Rust: ' .. self.stats.rust,
					'Make-up: ' .. self.stats.makeup,
				},
			}
			self.page_index = 1
			self:show_dialogue_page(node.typed)
		end,
		tick = function(self)
			if self.stagger_blocked then
				return
			end
			local main = object(text_main_id)
			if main.is_typing then
				main:type_next()
				return
			end
			if self.page_index < #self.pages then
				set_prompt_line('(A) next')
				return
			end
			set_prompt_line('EINDE')
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self:skip_typing()
				end
			},
			['a[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
						if object(text_main_id).is_typing then return end
					if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node = story[self.node_id]
						self:show_dialogue_page(node.typed)
						return
					end
				end,
			},
		},
	}

	states.choice = {
		entering_state = function(self)
			local node = story[self.node_id]
			apply_background(node.bg)
			object(bg_id).visible = true
			reset_text_colors()
			self:setup_choice_menu(node)
		end,
		tick = function(self)
			if self.stagger_blocked then
				return
			end
			local main = object(text_main_id)
			local choice_text = object(text_choice_id)
			if main.is_typing then
				main:type_next()
				choice_text.highlighted_line_index = nil
			else
				set_prompt_line('(A) select')
				choice_text.highlighted_line_index = self.choice_index - 1
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			['up[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self.choice_index = math.max(1, self.choice_index - 1)
				end,
			},
			['down[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					local node = story[self.node_id]
					self.choice_index = math.min(#node.options, self.choice_index + 1)
				end,
			},
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self:skip_typing()
				end
			},
			['a[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
						if object(text_main_id).is_typing then return end
					local node = story[self.node_id]
					local option = node.options[self.choice_index]
					self:apply_effects(option.effects)
					self.inline_pages = option.result_pages
					self.inline_next = option.next
					self.node_id = '__inline_dialogue'
					return '/run_node'
				end,
			},
		},
	}
end

return dialogue
