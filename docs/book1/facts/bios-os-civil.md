# Frozen shared civil formula facts

Root extraction 2026-10-18, baseline b23de821f. Read only actual
machine/bios/os.lua:63-122 and already independently frozen date packet.
These are literal Number formulas, not proof of exact unbounded calendar
arithmetic at every accepted timestamp or all-optimizer parity. No runtime,
architecture document, foreign library or historical PDF is a source.

1. Forward D(year, month, day): if month <=2 subtract1 from year. Then
   era=year//400; year_of_era=year-era*400;
   month_prime=month+(month>2 ? -3 : 9);
   day_of_year=((153*month_prime+2)//5)+day-1;
   day_of_era=year_of_era*365+year_of_era//4-year_of_era//100+day_of_year;
   return era*146097+day_of_era-719468.
   Source machine/bios/os.lua:63-73.
2. Inverse C(days): shifted=days+719468; era=shifted//146097;
   day_of_era=shifted-era*146097;
   year_of_era=(day_of_era-day_of_era//1460+day_of_era//36524-day_of_era//146096)//365;
   year=year_of_era+era*400;
   day_of_year=day_of_era-(365*year_of_era+year_of_era//4-year_of_era//100);
   month_prime=(5*day_of_year+2)//153;
   day=day_of_year-((153*month_prime+2)//5)+1;
   month=month_prime+(month_prime<10 ? 3 : -9);
   if month<=2 add1 to year; return year,month,day.
   Source machine/bios/os.lua:75-89.
3. For os.time input, before D: month_index=month-1;
   year_offset=month_index//12; normalized_year=year+year_offset;
   normalized_month=month_index-year_offset*12+1;
   timestamp=D(normalized_year,normalized_month,day)*86400+hour*3600+min*60+sec;
   then ordinary time-value checker. Source machine/bios/os.lua:116-122.
4. Shared decomposition: days=timestamp//86400;
   seconds_of_day=timestamp-days*86400; (year,month,day)=C(days);
   hour=seconds_of_day//3600;
   min=(seconds_of_day-hour*3600)//60;
   sec=seconds_of_day-hour*3600-min*60;
   yday=days-D(year,1,1)+1; wday=((days+4)%7)+1.
   Source machine/bios/os.lua:91-100.
5. All // and % are ordinary Number operations, not word arithmetic.
   Paired Number equations are already independently checked in
   /tmp/bmsx-bios-os-time-facts.md B12-B15; no new arithmetic rule is needed.

Author task: one compact shared-calendar subsection, explanatory formulas
explicitly NOT literal BLua or a requested cartridge encoder. Define D/C once
for later date/week rules. Keep lines print-readable (split long equation
through named intermediate). No source paths or implementation narration in
public prose. No new imported calendar/UTC/epoch behavior or examples.
