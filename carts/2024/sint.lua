local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local quiz<const> = require('quiz')

local sint<const> = {}
local portrait<const> = {}
portrait.__index = portrait

local portrait_def_id<const> = 'sint'
local portrait_instance_id<const> = 'sint'
local portrait_fsm_id<const> = 'sint'
local screen_width<const> = 256
local screen_height<const> = 192

function portrait:set_image(imgid)
	self:set_imgid(imgid)
	self.x = screen_width - self.sx
	self.y = screen_height - self.sy
end

local define_fsm<const> = function()
	local scoped_question_event<const> = {
		emitter = quiz.controller_instance_id,
		go = function(self, _state, question)
			self:set_image(question.imgid or 'hmm')
			return '/question'
		end,
	}

	fsm_library.register(portrait_fsm_id, {
		initial = 'intro',
		on = {
			[quiz.intro_presented_event] = {
				emitter = quiz.controller_instance_id,
				go = '/intro',
			},
			[quiz.question_presented_event] = scoped_question_event,
			[quiz.answer_presented_event] = {
				emitter = quiz.controller_instance_id,
				go = '/answer',
			},
			[quiz.completed_event] = {
				emitter = quiz.controller_instance_id,
				go = '/complete',
			},
		},
		states = {
			intro = {
				entering_state = function(self)
					self:set_image('quiz')
				end,
			},
			question = {
				on = {
					[quiz.question_presented_event] = {
						emitter = quiz.controller_instance_id,
						go = function(self, _state, question)
							if question.imgid ~= nil then
								self:set_image(question.imgid)
							end
						end,
					},
				},
			},
			answer = {
				entering_state = function(self)
					self:set_image('goed')
				end,
			},
			complete = {
				entering_state = function(self)
					self:set_image('klaar')
				end,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = portrait_def_id,
		class = portrait,
		base = sprite_object,
		components = {
			fsm_component.factory({ portrait_fsm_id }),
		},
	})
end

sint.portrait_def_id = portrait_def_id
sint.portrait_instance_id = portrait_instance_id
sint.define_fsm = define_fsm
sint.register_definition = register_definition

return sint
