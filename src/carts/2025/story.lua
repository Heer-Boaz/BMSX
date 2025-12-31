story = {
	title = {
		kind = 'bg_only',
		bg = 'titel',
		typed = false,
		pages = nil,
		next = 'intro',
	},
	intro = {
		kind = 'fade',
		next = 'overgang_monday',
	},
	overgang_monday = {
		kind = 'transition',
		label = 'MONDAY',
		next = 'klas',
	},
	klas = {
		kind = 'dialogue',
		bg = 'klas1',
		typed = true,
		pages = {
			{ 'Het is een dag zoals andere dagen.', 'Gehaast en gestrest naar school.' },
			{ 'En na verveelt te zijn op school,', 'Ook nog een bak huiswerk mee naar huis.' },
		},
		next = 'overgang_monday_middag',
	},
	overgang_monday_middag = {
		kind = 'transition',
		label = 'MONDAY AFTERNOON',
		next = 'schoolplein',
	},
	schoolplein = {
		kind = 'dialogue',
		bg = 'vriendin',
		typed = true,
		pages = {
			{ 'Op het schoolplein spreek je met je vriendin.', 'Ze lijkt bezorgd.' },
			{ 'Morgen is er een belangrijkte toets.', 'Je moet goed voorbereid zijn.' },
		},
		next = 'vriendin_choice',
	},
	vriendin_choice = {
		kind = 'choice',
		bg = 'vriendin',
		prompt = { 'Wat zeg je?' },
		options = {
			{
				label = '\"Ik ga vanavond eerst Persona 4 spelen.\"',
				effects = { { stat = 'rust', add = 1 }, { stat = 'planning', add = -1 } },
				result_pages = {
					{ 'Je "vriendin" zucht.', 'Gelukkig bestaat ze niet echt.', 'Planning -1', 'Rust +1' },
				},
				next = 'overgang_monday_evening',
			},
			{
				label = '\"Ik ben echt gestrest.\"',
				effects = { { stat = 'rust', add = 1 } },
				result_pages = {
					{ 'Je vriendin stelt je gerust.', 'Rust +1' },
				},
				next = 'overgang_monday_evening',
			},
		},
	},
	overgang_monday_evening = {
		kind = 'transition',
		label = 'MONDAY EVENING',
		next = 'monday_evening',
	},
	monday_evening = {
		kind = 'dialogue',
		bg = 'gamen',
		typed = true,
		pages = {
			{ 'Maya besluit thuis lekker Persona 4 te spelen.' },
			{ 'Het is toch ook een vorm van sociale vorming!' },
			{ 'En huiswerk is toch stom.' },
			{ 'Awel, het wordt toch tijd om te gaan slapen.' },
		},
		next = 'overgang_monday_night',
	},
	overgang_monday_night = {
		kind = 'transition',
		label = 'MONDAY NIGHT',
		next = 'monday_night',
	},
	monday_night = {
		kind = 'dialogue',
		bg = 'slaap_n',
		typed = true,
		pages = {
			{ 'Maya ligt s\'avonds lekker te ronken.', },
			{ 'De problemen van morgen zijn', 'voor de Maya van morgen.' },
			{ 'Die laten we voor morgen.' },
			{ 'Maar...', 'Dan wordt ze "wakker" in een droom...' },
		},
		next = 'igor',
	},
	igor = {
		kind = 'dialogue',
		bg = 'igor',
		typed = true,
		pages = {
			{ 'Een mysterieuze figuur verschijnt.', 'Hij noemt zichzelf Sintigor.' },
			{ 'Sintigor: "Welkom Maya.', 'Ik zie dat je houdt van goede spellen."' },
			{ 'Sintigor: "Maar je zal moeten beseffen dat"', 'je keuzes gevolgen hebben."' },
			{ 'Maya: "Wat bedoel je?"' },
		},
		next = 'igor_choice',
	},
	igor_choice = {
		kind = 'choice',
		bg = 'igor',
		prompt = { 'Sintigor: "Je zult het snel genoeg ontdekken."',},
		options = {
			{
				label = 'Uh ja, whatever.',
				effects = { { stat = 'opdekin', add = 1 } },
				result_pages = {
					{ 'Sintigor lacht. Hij wat jou te wachten staat.', 'Opdekin +1' },
				},
				next = 'overgang_tuesday_morning',
			},
			{
				label = 'Nogal verontrustend dat Sinterklaas in de dromen van kinderen verschijnt.',
				effects = { { stat = 'makeup', add = 1 } },
				result_pages = {
					{ 'Sintigor: "Ik ben Sintigor, niet Sinterklaas. Jouw opmerking is wel scherp en laat je er beter uit zien."', 'Make-up +1' },
				},
				next = 'overgang_tuesday_morning',
			},
		},
	},
	overgang_tuesday_morning = {
		kind = 'transition',
		label = 'TUESDAY MORNING',
		next = 'ochtendpijn',
	},
	ochtendpijn = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		typed = true,
		pages = {
			{ 'De wekker gaat af.', 'Maya wordt semi-wakker.' },
			{ '"Die rotwekker ook!" denkt ze bij zichzelf.' },
			{ '"Gelukkig hebben ze daarom snooze uitgevonden."', 'Maar is dat wel verstandig met een toets vandaag?' },
			{ '"Kan Maya weerstand bieden aan de verleiding?"' },
		},
		next = 'combat_wekker',
	},
	combat_wekker = {
		kind = 'combat',
		monster_imgid = 'monster_snoozer',
		rounds = {
			{
				prompt = { 'De wekker gaat af.', 'Tijd voor een snooze?' },
				options = {
					{ label = '\"Nog eventjes dan.\"', outcome = 'dodge', points = 0 },
					{ label = '\"Neen! Ik ga opstaan!\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'De oogjes worden zwaar.', 'Meer snoozen?' },
				options = {
					{ label = '\"Snoozen is goed voor de huid!\"', outcome = 'dodge', points = 0 },
					{ label = '\"NEIN!\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'Het wordt lichter en de ogen frisser.', },
				options = {
					{ label = '\"Ik wordt wekker van de wakker!\"', outcome = 'hit', points = 1 },
					{ label = '\"School is stom.\"', outcome = 'dodge', points = 0 },
				},
			},
		},
		rewards = {
			{ { stat = 'makeup', add = 2 } },
			{ { stat = 'rust', add = 1 }, { stat = 'planning', add = 1 }, { stat = 'makeup', add = 1 } },
			{ { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 }, { stat = 'opdekin', add = 1 } },
			{ { stat = 'planning', add = 2 }, { stat = 'rust', add = 2 }, { stat = 'opdekin', add = 2 } },
		},
		next = 'after_combat_wekker',
	},
	after_combat_wekker = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		typed = true,
		pages = {
			{ 'De wekker is verslagen... Tijd voor de volgende uitdaging.', },
		},
		next = 'spiegel',
	},
	spiegel = {
		kind = 'dialogue',
		bg = 'ochtendpijn',
		typed = true,
		pages = {
			{ 'De dodelijkste strijd gaat beginnen!' },
			{ 'Het allerbelangrijkste wat er moet gebeuren...' },
			{ 'Het opmaken voor de toets!' },
		},
		next = 'combat_spiegel',
	},
	combat_spiegel = {
		kind = 'combat',
		monster_imgid = 'monster_spiegel',
		rounds = {
			{
				prompt = { 'Wat wordt het vandaag?', 'Extra eyeliner of lipstick?' },
				options = {
					{ label = '\"Extra eyeliner.\"', outcome = 'dodge', points = 0 },
					{ label = '\"Extra lipstick.\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'Oei, een puistje!', 'Meer make-up?' },
				options = {
					{ label = '\"Boeuh!\"', outcome = 'hit', points = 1 },
					{ label = '\"Ubermakeup!\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'Je mag jezelf nu wel vertonen op school.', 'Maar het is nog niet genoeg!' },
				options = {
					{ label = '\"MEER MAKEUP!\"', outcome = 'dodge', points = 0 },
					{ label = '\"Ik luister naar mijn moeder.\"', outcome = 'hit', points = 1 },
				},
			},
		},
		rewards = {
			{ { stat = 'makeup', add = 3 } },
			{ { stat = 'makeup', add = 3 } },
			{ { stat = 'makeup', add = 3 }, { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 } },
		},
		next = 'after_combat_spiegel',
	},
	after_combat_spiegel = {
		kind = 'dialogue',
		bg = 'maya_b',
		typed = true,
		pages = {
			{ 'YES, JE ZIET ER WEER GOED UIT!', },
			{ 'Nu voorbereiden op de toets!', },
		},
		next = 'overgang_huiswerk',
	},
	overgang_huiswerk = {
		kind = 'fade',
		next = 'huiswerk',
	},
	huiswerk = {
		kind = 'dialogue',
		bg = 'huiswerk',
		typed = true,
		pages = {
			{ 'Nadat Maya dapper heeft gestreden tegen haar wekker en spiegel...' },
			{ 'Besluit Maya verstandig haar voorbereiding te doen voor de toets!' },
			{ 'Nu tijd voor school.' },
		},
		next = 'overgang_tuesday_afternoon',
	},
	overgang_tuesday_afternoon = {
		kind = 'transition',
		label = 'TUESDAY AFTERNOON',
		next = 'toets',
	},
	toets = {
		kind = 'dialogue',
		bg = 'klas1',
		typed = true,
		pages = {
			{ 'Maya zit in de klas, klaar voor de toets.', },
			{ 'Ze voelt zich goed voorbereid.', },
			{ 'De toets begint...' },
			{ 'Nu tijd voor combat...' },
			{ 'Maar de Sint faalt met goede voorbereiding en skipt dit gedeelte van het spel...' },
		},
		next = 'overgang_tuesday_afternoon',
	},
	overgang_tuesday_afternoon = {
		kind = 'transition',
		label = 'ORDEEL DES SINTS',
		next = 'ending',
	},
	ending = {
		kind = 'dialogue',
		bg = 'sint_blij',
		typed = true,
		pages = {
			{ 'Maya, dat heb je toch weer redelijk gedaan!' },
			{ 'Je hebt dapper gestreden tegen twee verschrikkelijke verleidingen:' },
			{ 'De gruwelijke snooze', 'En de afgrijselijke make-up spiegel!' },
			{ 'Ik ben trots op je!', 'Dit zal jouw toekomst zeker ten goede komen.' },
		},
	},
	__inline_dialogue = {
		kind = 'dialogue_inline',
		typed = true,
	},
}

return story
