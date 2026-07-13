local dialogue<const> = {}
require('globals')
local story<const> = require('story')
local texture_residency<const> = require('texture_residency')
local stagger<const> = require('stagger')
local cart_input<const> = require('cartlib/input/player')
local immediate_text_opts<const> = { typed = false, snap = true }

local background_at_or_after<const> = function(node_id)
	local node = story[node_id]
	while node.bg == nil do
		node = story[node.next]
	end
	return node.bg
end
local prompt_skip<const> = { '(B) skip' }
local prompt_next<const> = { '(A) Next' }
local prompt_continue<const> = { '(A) Continue' }
local prompt_ending_next<const> = { '(A) next' }
local prompt_ending_done<const> = { 'EINDE' }
local prompt_select<const> = { '(A) select' }

local dialogue_completion_prompt<const> = function(director)
	return director.page_index < #director.pages and prompt_next or prompt_continue
end

local ending_completion_prompt<const> = function(director)
	return director.page_index < #director.pages and prompt_ending_next or prompt_ending_done
end

function dialogue.register_methods(director)

	function director:show_dialogue_page(typed, prompt_lines)
		local page<const> = self.pages[self.page_index]
		oget(text_choice_id):clear_text()
		oget(text_prompt_id):clear_text()
		stagger.play(self, 'calm', {
			bg = oget(bg_id),
			bg_dim = false,
			text_main = oget(text_main_id),
			text_choice = oget(text_choice_id),
			text_prompt = oget(text_prompt_id),
			text_lines = page,
			text_typed = typed,
			text_prompt_lines = prompt_lines,
		})
	end

	function director:skip_typing()
		if oget(text_main_id):is_typing() then
			oget(text_main_id):reveal_text()
			cart_input.consume(1, 'b')
			return true
		end
		return false
	end

	function director:setup_choice_menu(node)
		local choice_lines<const> = {}
		for i = 1, #node.options do
			choice_lines[i] = node.options[i].label
		end
		stagger.play(self, 'calm', {
			bg = oget(bg_id),
			bg_dim = false,
			text_main = oget(text_main_id),
			text_choice = oget(text_choice_id),
			text_prompt = oget(text_prompt_id),
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
			hide_transition_layers()
			show_background(node.bg)
			local next_background<const> = background_at_or_after(node.next)
			if next_background ~= node.bg then
				texture_residency.preload_background(next_background)
			end
			hide_combat_sprites()
			clear_texts(text_ids_all)
			reset_text_colors()
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
			hide_transition_layers()
			show_background(node.bg)
			if node.kind ~= 'dialogue_inline' then
				local next_background<const> = background_at_or_after(node.next)
				if next_background ~= node.bg then
					texture_residency.preload_background(next_background)
				end
			end
			reset_text_colors()
			if node.kind == 'dialogue_inline' then
				self.pages = self.inline_pages
			else
				self.pages = node.pages
			end
			self.page_index = 1
			oget(text_transition_id):clear_text()
			local prompt_lines<const> = node.typed and prompt_skip or dialogue_completion_prompt(self)
			self:show_dialogue_page(node.typed, prompt_lines)
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end

			local main<const> = oget(text_main_id)
			if main:is_typing() then
				main:type_next()
				if not main:is_typing() then
					oget(text_prompt_id):set_text(dialogue_completion_prompt(self), immediate_text_opts)
				end
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					if self:skip_typing() then
						oget(text_prompt_id):set_text(dialogue_completion_prompt(self), immediate_text_opts)
					end
				end
			},
			['a[jp]'] = {
					go = function(self)
						if self.stagger_blocked then return end
						if oget(text_main_id):is_typing() then return end

						if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node<const> = story[self.node_id]
						local prompt_lines<const> = node.typed and prompt_skip or dialogue_completion_prompt(self)
						self:show_dialogue_page(node.typed, prompt_lines)
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
			hide_transition_layers()
			show_background(node.bg)
			reset_text_colors()
			oget(text_transition_id):clear_text()
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
			local prompt_lines
			if not node.typed then
				prompt_lines = ending_completion_prompt(self)
			end
			self:show_dialogue_page(node.typed, prompt_lines)
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end
			local main<const> = oget(text_main_id)
			if main:is_typing() then
				main:type_next()
				if not main:is_typing() then
					oget(text_prompt_id):set_text(ending_completion_prompt(self), immediate_text_opts)
				end
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					if self:skip_typing() then
						oget(text_prompt_id):set_text(ending_completion_prompt(self), immediate_text_opts)
					end
				end
			},
			['a[jp]'] = {
					go = function(self)
						if self.stagger_blocked then return end
						if oget(text_main_id):is_typing() then return end
						if self.page_index < #self.pages then
						self.page_index = self.page_index + 1
						local node<const> = story[self.node_id]
						local prompt_lines
						if not node.typed then
							prompt_lines = ending_completion_prompt(self)
						end
						self:show_dialogue_page(node.typed, prompt_lines)
						return
					end
				end,
			},
		},
	}

	states.choice = {
		entering_state = function(self)
			local node<const> = story[self.node_id]
			hide_transition_layers()
			show_background(node.bg)
			reset_text_colors()
			oget(text_prompt_id):clear_text()
			self:setup_choice_menu(node)
		end,
		update = function(self)
			if self.stagger_blocked then
				return
			end
			local main<const> = oget(text_main_id)
			local choice_text<const> = oget(text_choice_id)
			if main:is_typing() then
				main:type_next()
				if not main:is_typing() then
					oget(text_prompt_id):set_text(prompt_select, immediate_text_opts)
					choice_text:set_highlighted_line(self.choice_index - 1)
				end
			end
		end,
		input_eval = 'first',
		input_event_handlers = {
			['up[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					self.choice_index = math.max(1, self.choice_index - 1)
					if not oget(text_main_id):is_typing() then
						oget(text_choice_id):set_highlighted_line(self.choice_index - 1)
					end
				end,
			},
			['down[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					local node<const> = story[self.node_id]
					self.choice_index = math.min(#node.options, self.choice_index + 1)
					if not oget(text_main_id):is_typing() then
						oget(text_choice_id):set_highlighted_line(self.choice_index - 1)
					end
				end,
			},
			['b[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					if self:skip_typing() then
						oget(text_prompt_id):set_text(prompt_select, immediate_text_opts)
						oget(text_choice_id):set_highlighted_line(self.choice_index - 1)
					end
				end
			},
			['a[jp]'] = {
				go = function(self)
					if self.stagger_blocked then return end
					if oget(text_main_id):is_typing() then return end
					local node<const> = story[self.node_id]
					local option<const> = node.options[self.choice_index]
					local next_background<const> = background_at_or_after(option.next)
					if next_background ~= node.bg then
						texture_residency.preload_background(next_background)
					end
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
