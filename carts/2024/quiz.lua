local assets<const> = require('bmsx/assets')
local bin<const> = require('cartlib/bin')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local input<const> = require('cartlib/input/input')
local prefab<const> = require('cartlib/world/prefab')
local text_object<const> = require('cartlib/text/text_object')

local quiz<const> = {}
local controller<const> = {}
controller.__index = controller

local controller_def_id<const> = 'quiz_controller'
local controller_instance_id<const> = 'quiz'
local controller_fsm_id<const> = 'quiz'
local text_def_id<const> = 'quiz_text'
local text_instance_id<const> = 'quiz_text'

local question_presented_event<const> = 'quiz.question_presented'
local answer_presented_event<const> = 'quiz.answer_presented'
local completed_event<const> = 'quiz.completed'

local question_state<const> = 'question'
local answer_state<const> = 'answer'
local complete_state<const> = 'complete'
local answer_actions<const> = { 'a', 'b' }
local source_line_break<const> = '\n'
local rendered_line_break<const> = '\n\n'

-- The historical renderer materialized one empty row for every authored line
-- break. Doubling separators gives the retained text object the same rows and
-- therefore the same typewriter cadence as the original cart.
local preserve_line_spacing<const> = function(text)
	return string.gsub(text, source_line_break, rendered_line_break)
end

local quiz_data<const> = bin.decode(assets.data_quiz_addr, 'quiz')
controller.intro_text = preserve_line_spacing(table.concat(quiz_data.intro, source_line_break))
controller.complete_text = preserve_line_spacing(table.concat(quiz_data.complete, source_line_break))

local questions<const> = quiz_data.questions
local question_count<const> = #questions
local question_texts<const> = {}
local reaction_a_texts<const> = {}
local reaction_b_texts<const> = {}

for index = 1, question_count do
	local question<const> = questions[index]
	question_texts[index] = preserve_line_spacing(
		string.format(quiz_data.question_heading, index, question_count) .. question.question
			.. source_line_break .. question.options[1]
			.. source_line_break .. question.options[2]
	)
	reaction_a_texts[index] = preserve_line_spacing(question.reaction_a)
	reaction_b_texts[index] = preserve_line_spacing(question.reaction_b)
end

function controller:present_question(index)
	self.current_question_index = index
	local question<const> = questions[index]
	self.events:emit(question_presented_event, question)
	self.text:set_text(question_texts[index])
end

local type_next_character<const> = function(self)
	self.text:type_next()
end

local begin_quiz<const> = function(self)
	input.consume(self.player_index, answer_actions)
	return '/' .. question_state
end

local choose_answer_a<const> = function(self)
	input.consume(self.player_index, 'a')
	self.current_answer = 'a'
	return '/' .. answer_state
end

local choose_answer_b<const> = function(self)
	input.consume(self.player_index, 'b')
	self.current_answer = 'b'
	return '/' .. answer_state
end

local previous_question<const> = function(self)
	input.consume(self.player_index, 'left')
	local index<const> = self.current_question_index
	if index > 1 then
		self:present_question(index - 1)
	else
		self:present_question(1)
	end
end

local next_question<const> = function(self)
	input.consume(self.player_index, 'right')
	local index<const> = self.current_question_index
	if index == question_count then
		return '/' .. complete_state
	end
	self:present_question(index + 1)
end

local next_after_answer<const> = function(self)
	input.consume(self.player_index, answer_actions)
	local index<const> = self.current_question_index
	if index == question_count then
		return '/' .. complete_state
	end
	self.current_question_index = index + 1
	return '/' .. question_state
end

local define_fsm<const> = function()
	fsm_library.register(controller_fsm_id, {
		initial = 'intro',
		states = {
			intro = {
				entering_state = function(self)
					self.text:set_text(controller.intro_text)
				end,
				update = type_next_character,
				input_event_handlers = {
					{ pattern = 'a[jp] || b[jp]', go = begin_quiz },
					{ pattern = 'down[jp]', go = '/' .. complete_state },
				},
			},
			[question_state] = {
				entering_state = function(self)
					self:present_question(self.current_question_index)
				end,
				update = type_next_character,
				input_event_handlers = {
					{ pattern = 'a[jp]', go = choose_answer_a },
					{ pattern = 'b[jp]', go = choose_answer_b },
					{ pattern = 'left[jp]', go = previous_question },
					{ pattern = 'right[jp]', go = next_question },
				},
			},
			[answer_state] = {
				entering_state = function(self)
					local index<const> = self.current_question_index
					self.events:emit(answer_presented_event)
					if self.current_answer == 'a' then
						self.text:set_text(reaction_a_texts[index])
					else
						self.text:set_text(reaction_b_texts[index])
					end
				end,
				update = type_next_character,
				input_event_handlers = {
					{ pattern = 'a[jp] || b[jp]', go = next_after_answer },
				},
			},
			[complete_state] = {
				transition_guards = {
					can_exit = function()
						return false
					end,
				},
				entering_state = function(self)
					self.events:emit(completed_event)
					self.text:set_text(controller.complete_text)
				end,
				update = type_next_character,
			},
		},
	})
end

local register_definitions<const> = function()
	prefab.define({
		def_id = text_def_id,
		class = text_object,
		base = text_object,
	})
	prefab.define({
		def_id = controller_def_id,
		class = controller,
		components = {
			fsm_component.factory({ controller_fsm_id }),
		},
		defaults = {
			player_index = 1,
			current_question_index = 1,
			current_answer = 'a',
		},
	})
end

quiz.controller_def_id = controller_def_id
quiz.controller_instance_id = controller_instance_id
quiz.text_def_id = text_def_id
quiz.text_instance_id = text_instance_id
quiz.question_presented_event = question_presented_event
quiz.answer_presented_event = answer_presented_event
quiz.completed_event = completed_event
quiz.define_fsm = define_fsm
quiz.register_definitions = register_definitions

return quiz
