module<const>

struct game_text_record
	story_1_text: string
	story_2_text: string
	story_3_text: string
	story_4_text: string
	story_5_text: string
	story_6_text: string
	story_piet_text: string
	story_7_text: string
	story_8_text: string
	story_9_text: string
	end_demo_sint_text: string
	end_demo_boaz_text: string
end

rodata game_text: game_text_record = {
	story_1_text = '    DR.PIETON, DE NASA-PIET,\n'
		.. '    HEEFT EEN POGING GEDAAN\n'
		.. '  OM EEN COUP D\'ETAT TE PLEGEN\n'
		.. '      TEGEN SINTERKLAAS.',
	story_2_text = '  DE COUP MISLUKTE. DR.PIETON\n'
		.. '   WERD IN DE ZAK GESTOPT EN \n'
		.. '     GEVANGEN GEZET IN DE\n'
		.. '  CATACOMBEN VAN HET KASTEEL\n'
		.. '        VAN SINTERKLAAS.',
	story_3_text = '   ECHTER, EEN JAAR LATER WEET\n'
		.. '   DR.PIETON UIT DE CATACOMBEN\n'
		.. '     TE BREKEN EN VLUCHT\n'
		.. '         HET LAND UIT.',
	story_4_text = '    HIJ WORDT NIET GEVONDEN,\n'
		.. '  ONDANKS EEN GROOTSE ZOEKTOCHT\n'
		.. '         VAN DE SINT.',
	story_5_text = ' PLOTS IS ER GEEN ENKEL CONTACT\n'
		.. '    MEER MET DE INWONERS VAN\n'
		.. '   STADSBURG. DE STAD BLIJKT\n'
		.. '    TE ZIJN BINNENGEVALLEN...',
	story_6_text = '  DR.PIETON IS DE BOOSDOENER.',
	story_piet_text = '\n'
		.. ' DR.PIETON IS STADSBURG BINNEN-\n'
		.. ' GEVALLEN EN HEEFT HET VERBOUWD\n'
		.. '  TOT EEN FORT OM TE STRIJDEN\n'
		.. '         TEGEN DE SINT.',
	story_7_text = '  DAT KAN NATUURLIJK NIET!!!1\n'
		.. '    DE SINT HEEFT DAAROM DE \n'
		.. '   OPDRACHT GEGEVEN AAN ZIJN \n'
		.. ' PIETEN OM DR.PIETON EEN SLAG\n'
		.. '    MET DE ROE TE GEVEN EN \n'
		.. '   STADSBURG TE BEVRIJDEN...',
	story_8_text = '   GELUKKIG KRIJGEN ZE HULP--\n'
		.. '   DE SURPRISE-PIETEN HEBBEN\n'
		.. '    DE KARTONION ONTWIKKELD.\n'
		.. ' EEN HYPERMODERNE SURPRISE DIE\n'
		.. '     DR.PIETON ZAL VERASSEN!',
	story_9_text = '     DE PILOOTPIET ZAL DE\n'
		.. '      KARTONION BESTUREN.\n'
		.. '\n'
		.. '  GOED, DEZE INTRODUCTIE HEEFT\n'
		.. '  LANG GENOEG GEDUURD, DUS WE\n'
		.. ' GAAN DE MUZIEK NIET AFWACHTEN.',
	end_demo_sint_text = 'REDELIJK WERK,\n'
		.. 'PILOOTPIET!!\n'
		.. '\n'
		.. 'DR.PIETON IS\n'
		.. 'VERSLAGEN EN\n'
		.. 'STADSBURG IS\n'
		.. 'WEER VEILIG.\n'
		.. '\n'
		.. 'DR.PIETON ZAL\n'
		.. 'IN DE ZAK\n'
		.. 'MEEKOMEN NAAR\n'
		.. 'SPANJE OM DAAR\n'
		.. 'MIJN KASTEEL\n'
		.. 'OP TE RUIMEN..\n'
		.. '\n'
		.. 'HIJ ZAL NA DAT\n'
		.. 'KARWEITJE WEL\n'
		.. 'TWEE KEER DEN-\n'
		.. 'KEN VOOR HIJ\n'
		.. 'ME OPNIEUW ZAL\n'
		.. 'VERRADEN...',
	end_demo_boaz_text = 'ZO, DAT WAS HET\n'
		.. 'DAN ALWEER!\n'
		.. '\n'
		.. 'SINTERKLAAS EN\n'
		.. 'ZIJN PIETEN \n'
		.. 'HEBBEN VEEL TIJD\n'
		.. 'EN ENERGIE\n'
		.. 'GESTOPT IN HET\n'
		.. 'MAKEN VAN DEZE\n'
		.. 'KLASSIEKER.\n'
		.. '\n'
		.. 'UITERAARD HEBBEN\n'
		.. 'JULLIE ERVAN\n'
		.. 'GENOTEN EN WAREN\n'
		.. 'JULLIE DIEP\n'
		.. 'ONDER DE INDRUK.',
}

return {
	game_text = game_text,
}
