local dialogue<const> = {}
local globals<const> = require('globals')
local story<const> = require('story')
local stagger<const> = require('stagger')

function dialogue.register_methods(director)

	function director:show_dialogue_page(typed)
		local page<const> = self.pages[self.page_index]
		oget(globals.text_choice_id):clear_text()
		stagger.play(self, 'calm', {
			bg = oget(globals.bg_id),
			bg_dim = false,
			text_main = oget(globals.text_main_id),
			text_choice = oget(globals.text_choice_id),
			text_prompt = oget(globals.text_prompt_id),
			text_lines = page,
			text_typed = typed,
		})
	end

		function director:skip_typing()
			if oget(globals.text_main_id):is_typing() then
				oget(globals.text_main_id):reveal_text()
				self:update_dialogue_prompt()
				mem[sys_inp_consume] = &'b'
			return true
		end
		return false
	end

		function director:update_dialogue_prompt()
			local main<const> = oget(globals.text_main_id)
			if main:is_typing() then
				oget(globals.text_prompt_id):set_text({ '(B) skip' }, { typed = false, snap = true })
				return
			end
		if self.page_index < #self.pages then
			oget(globals.text_prompt_id):set_text({ '(A) Next' }, { typed = false, snap = true })
			return
		end
		oget(globals.text_prompt_id):set_text({ '(A) Continue' }, { typed = false, snap = true })
	end

	function director:setup_choice_menu(node)
		local choice_lines<const> = {}
		for i = 1, #node.options do
			choice_lines[i] = node.options[i].label
		end
		stagger.play(self, 'calm', {
			bg = oget(globals.bg_id),
			bg_dim = false,
			text_main = oget(globals.text_main_id),
			text_choice = oget(globals.text_choice_id),
			text_prompt = oget(globals.text_prompt_id),
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
			local node<const> = story[self.node_id]
			globals.show_background(node.bg)
			globals.hide_combat_sprites()
			globals.clear_texts(globals.text_ids_all)
			globals.reset_text_colors()
		end,
		input_eval = 'first',
		input_event_handlers = {
			['a[jp]'] = {
				go = function(self)
					local node<const> = story[self.node_id]
					self.node_id = node.next
					return '/run_node'
				end,
			},
		},
	}

	states.dialogue = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			globals.show_background(node.bg)
			globals.reset_text_colors()
			if node.kind == 'dialogue_inline' then
				self.pages = self.inline_pages
			else
				self.pages = node.pages
			end
			self.page_index = 1
			oget(globals.text_transition_id):clear_text()
			self:show_dialogue_page(node.typed)
			self:update_dialogue_prompt()
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end

				local main<const> = oget(globals.text_main_id)
				if main:is_typing() then
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
						if oget(globals.text_main_id):is_typing() then return end

						if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node<const> = story[self.node_id]
						self:show_dialogue_page(node.typed)
						self:update_dialogue_prompt()
						return
					end
					local node<const> = story[self.node_id]
					if node.kind == 'dialogue_inline' then
						self.node_id = self.inline_next
						self.inline_pages = {}
						self.inline_next = nil
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
			local node<const> = story[self.node_id]
			globals.show_background(node.bg)
			globals.reset_text_colors()
			oget(globals.text_transition_id):clear_text()
			oget(globals.text_choice_id):clear_text()
			oget(globals.text_prompt_id):clear_text()
			local total<const> = self.stats.planning + self.stats.opdekin + self.stats.rust + self.stats.makeup
			local title = nil
			local total_line = nil
			local line1 = nil
			local line2 = nil
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
		update = function(self)
			if self.stagger_blocked then
				return
			end
				local main<const> = oget(globals.text_main_id)
				if main:is_typing() then
					main:type_next()
					return
				end
			if self.page_index < #self.pages then
				oget(globals.text_prompt_id):set_text({ '(A) next' }, { typed = false, snap = true })
				return
			end
			oget(globals.text_prompt_id):set_text({ 'EINDE' }, { typed = false, snap = true })
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
						if oget(globals.text_main_id):is_typing() then return end
						if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node<const> = story[self.node_id]
						self:show_dialogue_page(node.typed)
						return
					end
				end,
			},
		},
	}

	states.choice = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			globals.show_background(node.bg)
			globals.reset_text_colors()
			self:setup_choice_menu(node)
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end
				local main<const> = oget(globals.text_main_id)
				local choice_text<const> = oget(globals.text_choice_id)
				if main:is_typing() then
					main:type_next()
					choice_text.highlighted_line_index = nil
				else
				oget(globals.text_prompt_id):set_text({ '(A) select' }, { typed = false, snap = true })
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
					local node<const> = story[self.node_id]
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
						if oget(globals.text_main_id):is_typing() then return end
						local node<const> = story[self.node_id]
					local option<const> = node.options[self.choice_index]
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
