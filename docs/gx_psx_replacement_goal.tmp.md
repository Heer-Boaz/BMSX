  Werk in /home/boaz/BMSX.

  Lees eerst AGENTS.md en docs/gx_psx_replacement_workplan.tmp.md. Behandel
  docs/gx_psx_replacement_workplan.tmp.md als de actuele goal/checklist voor de
  GX/PSX graphics replacement; docs/goal.md is hiervoor niet de bron van waarheid.

  Doel: voer één substantiële verticale GX/PSX replacement slice uit die merkbaar
  dichter bij echte PSX-GPU/GTE parity en VDP/RPU-vervanging brengt. Geen mini-fix
  van 10 regels tenzij die aantoonbaar een harde blocker oplost. Werk door totdat
  de gekozen slice functioneel compleet is, getest is, en gecommit kan worden.

  Constraints:
  - Geen save-state wijzigingen.
  - Geen cart-migratie zolang PSX-GPU/GTE incompleet is.
  - Geen require/ensure/fallback/provider/adapter/injection patterns.
  - Geen legacy/profile/fallback ABI.
  - WebGL2/GLES2/future WebGPU moeten host-GPU accelerated blijven.
  - TS/C++ software/headless is een serieuze backend en moet voor render-visible
    changes meegenomen worden.
  - Gebruik serieuze PSX-referenties voordat je PSX-gedrag implementeert.
  - Houd TS/C++ parity waar relevant.
  - Commit pas na passende validatie.

  Begin met git status, git log --oneline -5, en kies daarna een substantiële
  volgende slice uit docs/gx_psx_replacement_workplan.tmp.md. Als je op GPUREAD /
  VRAM-to-CPU, origin-regels, of host-GPU acceleration-conflict stuit: stop en vraag
  mij om een ontwerpbeslissing voordat je code schrijft.

  Vermijd micro-commits. Een acceptabele slice raakt bij voorkeur de volledige
  verticale keten: machine contract + TS/C++ parity + relevante backend(s) + tests,
  of legt expliciet uit waarom dat voor deze slice niet klopt.
