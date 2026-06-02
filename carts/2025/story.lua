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

	-- =====================
	-- MONDAY
	-- =====================
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
			{ 'Later deze week is er een ubertoets.', 'Je moet goed voorbereid zijn!' },
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
					{ 'Je "vriendin" zucht.', 'Gelukkig bestaat ze niet echt.' },
					{ 'Planning -1', 'Rust +1' },
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
		next = 'to_igor',
	},
	to_igor = {
		kind = 'fade',
		next = 'igor',
	},

	igor = {
		kind = 'dialogue',
		bg = 'igor',
		typed = true,
		pages = {
			{ 'Een mysterieus figuur verschijnt.', 'Hij noemt zichzelf "Sintigor".' },
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
					{ 'Sintigor lacht.', 'Hij weet wat jou te wachten staat.', 'Opdekin +1' },
				},
				next = 'overgang_tuesday_morning',
			},
			{
				label = 'Nogal verontrustend dat Sinterklaas in de dromen van kinderen verschijnt.',
				effects = { { stat = 'makeup', add = 1 } },
				result_pages = {
					{ 'Sintigor: "Ik ben Sintigor, niet Sinterklaas."', 'Maar jouw opmerking is scherp.', 'Make-up +1' },
				},
				next = 'overgang_tuesday_morning',
			},
		},
	},

	-- =====================
	-- TUESDAY – WEKKER
	-- =====================
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
			{ '"Gelukkig hebben ze daarom snooze uitgevonden."', 'Maar is dat wel verstandig met een ubertoets op komst?' },
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
			{ 'De wekker is verslagen...', 'maar de dag is nog lang niet gedaan.' },
			{ 'Eerst school.', 'Vanavond pas weer drama.' },
		},
		next = 'overgang_tuesday_afternoon',
	},

	overgang_tuesday_afternoon = {
		kind = 'transition',
		label = 'TUESDAY AFTERNOON',
		next = 'tuesday_schoolday',
	},

	tuesday_schoolday = {
		kind = 'dialogue',
		bg = 'klas_dinsdag',
		typed = true,
		pages = {
			{ 'Maya zit in de klas.', 'Ze probeert echt te volgen.' },
			{ 'De mist fluistert: "Later is ook een plan..."', 'Maar Maya schrijft tóch dingen op.' },
			{ 'School voelt ineens als een quest.', 'Geen cutscene. Geen skip.' },
		},
		next = 'overgang_tuesday_evening',
	},

	overgang_tuesday_evening = {
		kind = 'transition',
		label = 'TUESDAY EVENING',
		next = 'tuesday_evening_choice',
	},

	tuesday_evening_choice = {
		kind = 'choice',
		bg = 'kamer_avond',
		prompt = { 'Dinsdagavond.', 'Wat doe je?' },
		options = {
			{
				label = '\"Ik studeer. Met timer. Ik ben volwassen.\"',
				effects = {
					{ stat = 'planning', add = 2 },
					{ stat = 'opdekin', add = 1 },
					{ stat = 'rust', add = 1 },
				},
				result_pages = {
					{ 'Je zet een timer.', '45 minuten.', 'Niet meer, niet minder.' },
					{ 'Maya:', '"Oké. School eerst."', '"Ik neem het op de kin."' },
					{ 'Planning +2', 'Opdekin +1', 'Rust +1' },
				},
				next = 'tuesday_evening_study',
			},
			{
				label = '\"Ik ga even Persona 4 spelen. Dat is ook sociale vorming.\"',
				effects = {
					{ stat = 'rust', add = 2 },
					{ stat = 'planning', add = -1 },
					{ stat = 'opdekin', add = -1 },
				},
				result_pages = {
					{ 'Je start Persona 4 op.', 'De stress smelt weg...' },
					{ '...en de planning ook.', 'Maar ja.', 'Prioriteiten.' },
					{ 'Rust +2', 'Planning -1', 'Opdekin -1' },
				},
				next = 'tuesday_evening_gamen',
			},
			{
				label = '\"Ik optimaliseer mijn make-up. Getimed. Geen twijfel-lus.\"',
				effects = {
					{ stat = 'makeup', add = 1 },
					{ stat = 'planning', add = 1 },
					{ stat = 'rust', add = 1 },
				},
				result_pages = {
					{ 'Je legt alles klaar.', 'Timer aan.', 'Geen "nog even".' },
					{ 'Maya:', '"Glow, maar getimed."', '"Ik ben geen spiegel-slachtoffer."' },
					{ 'Make-up +1', 'Planning +1', 'Rust +1' },
				},
				next = 'tuesday_evening_makeup',
			},
		},
	},

	tuesday_evening_study = {
		kind = 'dialogue',
		bg = 'huiswerk',
		typed = true,
		pages = {
			{ 'Je kijkt naar je planning.', 'Het is saai.', 'Dat is het punt.' },
			{ 'Je doet een paar oefeningen.', 'Niet perfect.', 'Wel gedaan.' },
			{ 'Maya:', '"Awel."', '"Dat was eigenlijk... oké."' },
		},
		next = 'overgang_tuesday_night',
	},

	tuesday_evening_gamen = {
		kind = 'dialogue',
		bg = 'gamen',
		typed = true,
		pages = {
			{ 'Je gamet.', 'Het is heerlijk.' },
			{ 'Je brein:', '"Nog één dungeon."', 'Jij:', '"Nog één dungeon."' },
			{ 'Dan kijk je op de klok.', 'Oei.' },
		},
		next = 'overgang_tuesday_night',
	},

	tuesday_evening_makeup = {
		kind = 'dialogue',
		bg = 'badkamer_makeup',
		typed = true,
		pages = {
			{ 'Alles ligt klaar.', 'Het voelt bijna professioneel.' },
			{ 'Je doet een routine.', 'Strak.', 'Getimed.' },
			{ 'Geen spiegel-lus.', 'Geen "nog even".', 'Winst.' },
		},
		next = 'overgang_tuesday_night',
	},

	overgang_tuesday_night = {
		kind = 'transition',
		label = 'TUESDAY NIGHT',
		next = 'tuesday_night',
	},

	tuesday_night = {
		kind = 'dialogue',
		bg = 'slaap_n',
		typed = true,
		pages = {
			{ 'Maya ligt te slapen.', 'Lekker te ronken.' },
			{ 'De mist wacht geduldig.', 'Zoals altijd.' },
			{ 'Morgen:', 'de Spiegel.' },
		},
		next = 'overgang_wednesday_morning',
	},

	overgang_wednesday_morning = {
		kind = 'transition',
		label = 'WEDNESDAY MORNING',
		next = 'spiegel',
	},

	spiegel = {
		kind = 'dialogue',
		bg = 'badkamer_makeup',
		typed = true,
		pages = {
			{ 'Nieuwe dag. Nieuwe vijand.' },
			{ 'De dodelijkste strijd gaat beginnen!', 'De Spiegel.' },
			{ 'Doel:', 'er goed uitzien zónder tijd te verliezen.' },
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
		bg = 'badkamer_spiegel',
		typed = true,
		pages = {
			{ 'YES, JE ZIET ER WEER GOED UIT!' },
			{ 'Maar nu:', 'school.', 'En vanavond: ubertoets‑voorbereiding.' },
		},
		next = 'overgang_wednesday_afternoon',
	},

	overgang_wednesday_afternoon = {
		kind = 'transition',
		label = 'WEDNESDAY AFTERNOON',
		next = 'wednesday_schoolday',
	},

	wednesday_schoolday = {
		kind = 'dialogue',
		bg = 'klas_woensdag',
		typed = true,
		pages = {
			{ 'Maya zit in de klas.', 'Ze voelt zich… verrassend aanwezig.' },
			{ 'Oké. Nog steeds duizend gedachten.', 'Maar minder in paniek.' },
			{ 'Morgen is het zover:', 'de ubertoets.' },
		},
		next = 'overgang_wednesday_evening',
	},

	overgang_wednesday_evening = {
		kind = 'transition',
		label = 'WEDNESDAY EVENING',
		next = 'wednesday_evening_choice',
	},

	wednesday_evening_choice = {
		kind = 'choice',
		bg = 'kamer_avond',
		prompt = { 'Laatste avond voor de ubertoets.', 'Wat doe je?' },
		options = {
			{
				label = '\"Microtaken. Checklist. Ik ga full nerd.\"',
				effects = {
					{ stat = 'planning', add = 2 },
					{ stat = 'opdekin', add = 1 },
					{ stat = 'rust', add = 1 },
				},
				result_pages = {
					{ 'Je knipt alles in kleine stukjes.', '10 min dit, 15 min dat.' },
					{ 'Je brein:', '"SAAI!"', 'Jij:', '"NEIN."' },
					{ 'Planning +2', 'Opdekin +1', 'Rust +1' },
				},
				next = 'wednesday_evening_study',
			},
			{
				label = '\"Ik verdien ontspanning. Persona 4, kom mij halen.\"',
				effects = {
					{ stat = 'rust', add = 2 },
					{ stat = 'planning', add = -2 },
					{ stat = 'opdekin', add = -1 },
				},
				result_pages = {
					{ 'Je gaat gamen.', 'Het is heerlijk.' },
					{ 'Tot je denkt:', '"Morgen… is morgen."', 'En morgen is… morgen.' },
					{ 'Rust +2', 'Planning -2', 'Opdekin -1' },
				},
				next = 'wednesday_evening_gamen',
			},
			{
				label = '\"Outfit klaar. Haar oké. Morgen geen spiegel-paniek.\"',
				effects = {
					{ stat = 'makeup', add = 1 },
					{ stat = 'planning', add = 1 },
					{ stat = 'rust', add = 1 },
				},
				result_pages = {
					{ 'Je legt alles klaar.', 'Alsof je morgen-Maya een cadeautje geeft.' },
					{ 'Geen twijfel-lus.', 'Geen kleding-crisis.', 'Geen haar-paniek.' },
					{ 'Make-up +1', 'Planning +1', 'Rust +1' },
				},
				next = 'wednesday_evening_makeup',
			},
		},
	},

	wednesday_evening_study = {
		kind = 'dialogue',
		bg = 'huiswerk',
		typed = true,
		pages = {
			{ 'Je herhaalt nog eens.', 'Niet alles.', 'Maar genoeg.' },
			{ 'Je maakt een mini-plan voor morgen.', 'Vraag 1 eerst.', 'Altijd.' },
			{ 'Maya:', '"Oké."', '"Ik ben klaar. Klaar is klaar."' },
		},
		next = 'overgang_wednesday_night',
	},

	wednesday_evening_gamen = {
		kind = 'dialogue',
		bg = 'gamen',
		typed = true,
		pages = {
			{ 'Je gamet.', 'Het werkt… even.' },
			{ 'Dan komt die gedachte:', '"Morgen is echt."', 'En je voelt het in je maag.' },
			{ 'Je stopt.', 'Te laat.', 'Maar je stopt.' },
		},
		next = 'overgang_wednesday_night',
	},

	wednesday_evening_makeup = {
		kind = 'dialogue',
		bg = 'badkamer_makeup',
		typed = true,
		pages = {
			{ 'Je checkt je outfit.', 'Je checkt je haar.', 'Eén keer.' },
			{ 'Je legt alles klaar.', 'En je spreekt jezelf streng toe:' },
			{ 'Maya:', '"Morgen geen vergelijkings-olympics."', '"Ik ben geen spreadsheet."' },
		},
		next = 'overgang_wednesday_night',
	},

	overgang_wednesday_night = {
		kind = 'transition',
		label = 'WEDNESDAY NIGHT',
		next = 'wednesday_night',
	},

	wednesday_night = {
		kind = 'dialogue',
		bg = 'slaap_n',
		typed = true,
		pages = {
			{ 'Maya slaapt.', 'Dit keer met minder chaos in haar hoofd.' },
			{ 'Maar de mist is niet weg.', 'Die spaart zich op.' },
			{ 'Morgen:', 'de Eindtoets.' },
		},
		next = 'overgang_thursday_morning',
	},

	overgang_thursday_morning = {
		kind = 'transition',
		label = 'THURSDAY MORNING',
		next = 'thursday_morning',
	},

	thursday_morning = {
		kind = 'dialogue',
		bg = 'kamer_ochtend_ubertoets',
		typed = true,
		pages = {
			{ 'Ubertoets-dag.', 'Maya staat op.' },
			{ 'Tas: check.', 'Notities: check.', 'Rust: ongeveer.' },
			{ 'Make-up: buff.', 'Planning: weapon.', 'Opdekin: armor.' },
			{ 'Tijd om naar school te gaan.' },
		},
		next = 'schoolpoort',
	},

	schoolpoort = {
		kind = 'dialogue',
		bg = 'schoolpoort_klok',
		typed = true,
		pages = {
			{ 'Voor de schoolpoort hangen er allemaal klokken.',},
			{ 'En het zijn geen kerkklokken!' },
			{ 'Het lijkt meer symbolisch,', 'alsof je wordt veroordeelt!' },
			{ 'Papier ritselt in de lucht.', 'Alsof de toets al bestaat vóór je binnen bent.' },
			{ 'Een stem:', '"Welkom, Maya."'},
			{ '"Ik ben Heer Later..."', '"En ik BEN de Eindtoets!!"' },
		},
		next = 'combat_heer_later',
	},

	combat_heer_later = {
		kind = 'combat',
		monster_imgid = 'monster_heer_later',
		rounds = {
			{
				prompt = { 'EINDTOETS MODE.', 'Je ziet ALLE vragen ineens.', 'Je brein wil alles tegelijk lezen.' },
				options = {
					{ label = '\"Ik scan alles tegelijk. Maya speedrun!\"', outcome = 'dodge', points = 0 },
					{ label = '\"Vraag 1. Gewoon. Alsof ik normaal ben.\"', outcome = 'hit', points = 1 },
				},
			},
			{
				prompt = { 'Vragen RNG!!', 'Vraag 12 kijkt je aan.', 'Vraag 2 lacht: "Ik ben easy..."' },
				options = {
					{ label = '\"Easy eerst. Ik maak cirkels. Ik ben slim.\"', outcome = 'hit', points = 1 },
					{ label = '\"Ik spring random. YOLO.\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'Twijfel-aanval!', '"Maar thuis deed ik dit anders..."', 'Je gum-hand jeukt.' },
				options = {
					{ label = '\"NEIN! Ik vertrouw mijn huiswerk.\"', outcome = 'hit', points = 1 },
					{ label = '\"Ik gum tot het papier boos is.\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { '"Zit mijn haar wel goed?!"', 'Iedereen ziet er ineens beter uit. (NEE...)' },
				options = {
					{ label = '\"Das weise ich innerlich komplett zuruck.\"', outcome = 'hit', points = 1 },
					{ label = '\"Even mijn haar checken in het raam.\"', outcome = 'dodge', points = 0 },
				},
			},
			{
				prompt = { 'TIK TOK.', 'Nog 5 minuten.', 'Heer Later fluistert: "Je hebt toch al een onvoldoende..."' },
				options = {
					{ label = '\"Ik accepteer dat het leven een hel is.\"', outcome = 'dodge', points = 0 },
					{ label = '\"En dan gezeik van mijn moeder?! AFMAKEN.\"', outcome = 'hit', points = 1 },
				},
			},
		},
		rewards = {
			-- 0 punten
			{ { stat = 'planning', add = -1 }, { stat = 'rust', add = -1 } },
			-- 1 punt
			{ { stat = 'opdekin', add = 1 } },
			-- 2 punten
			{ { stat = 'planning', add = 1 }, { stat = 'rust', add = 1 } },
			-- 3 punten
			{ { stat = 'planning', add = 2 }, { stat = 'opdekin', add = 1 } },
			-- 4 punten
			{ { stat = 'planning', add = 2 }, { stat = 'rust', add = 2 }, { stat = 'makeup', add = 1 } },
			-- 5 punten
			{ { stat = 'planning', add = 3 }, { stat = 'rust', add = 2 }, { stat = 'opdekin', add = 2 }, { stat = 'makeup', add = 1 } },
		},
		next = 'after_combat_heer_later',
	},

	after_combat_heer_later = {
		kind = 'dialogue',
		bg = 'schoolpoort_klok',
		typed = true,
		pages = {
			{ 'Heer Later wankelt.', 'De klokken vallen op de grond.' },
			{ 'Maya:', '"Awel."', '"Dat was dus de toets."' },
			{ 'Ze levert in.', 'Met trillende hand, maar ze levert in.' },
			{ 'En nu wachten op de...' },
		},
		next = 'overgang_ordeel_des_sints',
	},

	-- =====================
	-- ENDING
	-- =====================
	overgang_ordeel_des_sints = {
		kind = 'transition',
		label = 'ORDEEL DES SINTS',
		transition_style = 'ending',
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
		next = 'theend',
	},

	theend = {
		kind = 'ending',
		bg = 'sint_blij',
		typed = false,
		pages = nil,
		next = nil,
	},

	__inline_dialogue = {
		kind = 'dialogue_inline',
		typed = true,
	},
}

return story
