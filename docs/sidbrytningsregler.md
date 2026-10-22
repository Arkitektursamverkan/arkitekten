# Regelverk för sidbrytning av flödesscheman

Ett flöde delas i flera delar (sidor/figurer) BARA när det inte ryms på
bredden. Delningen ska aldrig göra flödet svårare att följa än nödvändigt.
Varje regel nedan är **mätbar**: granskaren i
`src/tools/flowchart/layout/page-rules.ts` räknar på den färdiga layouten och
rapporterar PASS/FAIL med detaljer. Testerna i `page-rules.test.ts` kör
granskaren på exempelflödet och alla sparade flöden – bryts en regel blir
bygget rött.

Kör granskningen själv:

```
npx tsx scripts/granska-sidor.mts
```

---

## R1 – Nödvändighet: dela bara när bredden kräver det

Ett flöde delas aldrig i fler delar än vad innehållets bredd kräver.

**Mått:** `antal delar ≤ ⌈total kolumnbredd / innehållsbredd⌉ + antal
snittflyttar som R3 tvingat fram`. Ett flöde som ryms på en del får aldrig
delas. Dessutom: **ingen del får vara tom.** Delarna planeras ur kolumn-
geometrin, före pinnarna – pinnar användaren bort det enda som låg på en del
(R4:s undantag) tas den delen bort och de kvarvarande numreras om.

## R2 – Packning: varje del ska vara välfylld

Objekt flyttas inte till nästa del i onödan. En del (utom den sista) avslutas
bara när nästa kolumngrupp inte ryms i det som är kvar av bredden.

**Mått:** för varje del utom den sista gäller att NÄSTA dels första
kolumngrupp inte hade fått plats i delens återstående bredd. Ingen del utom
den sista får ha fyllnadsgrad under **55 %** av innehållsbredden, om inte R3
är orsaken.

## R3 – Sammanhang: en gateway skiljs inte från sin gren

Ett beslut och dess NÄRMASTE grenhuvud (det första steget i den gren som
ritas direkt intill gatewayen) hör ihop – snittet får inte gå mellan dem.
Nej-vägen/senare grenar FÅR fortsätta på nästa del: det är naturlig läsning,
förutsatt att hänvisningen bär grenetiketten (R5).

**Mått:** för varje beslut: gatewayn och grenmål i kolumnen direkt intill
ligger på samma del, ELLER paret ryms inte på en del (då är delning
oundviklig och tillåten), ELLER användaren har själv pinnat någon av
parterna till en annan del (ett medvetet delbyte är användarens val och
döms inte som motorfel – samma princip som R6:s undantag).

## R4 – Riktning: flödet läser alltid framåt

Läsaren följer delarna i nummerordning. En koppling får aldrig peka bakåt
till en tidigare del ("till del 2" från del 3 är förbjudet). Manuellt flyttade
objekt byter ALDRIG del – deltillhörighet avgörs av flödesordningen
(kolumnen), inte av var objektet råkar ha dragits.

**Mått:** varje koppling som korsar ett snitt går från del N till del M där
M > N. Enda undantaget: en koppling vars ände användaren själv pinnat till
en annan del – motorn ändrar aldrig deltillhörighet av ett drag, men ett
medvetet delbyte får peka dit användaren vill.

## R5 – Läsbar skarv: hänvisningsmärken kolliderar inte

Märkena ("Ja · till del 3", "från del 2") är skarvens enda ledtråd och måste
gå att läsa. De får inte ligga ovanpå noder eller ovanpå varandra. Bär
kopplingen en grenetikett (Ja/Nej) står etiketten PÅ märket – informationen
får aldrig försvinna i skarven.

**Mått:** inga två märken på samma del överlappar varandra; inget märke
överlappar en nod. Varje kapad kant med etikett har etiketten i sitt märke.

## R6 – Vertikal ärlighet: ingen tom luft

En banas höjd på en del bestäms av innehållet på DEN delen. En bana utan
innehåll på delen faller ihop till sin rubrikrad. En manuellt dragen banhöjd
gäller dock alla delar (det är ett medvetet val).

**Mått:** för varje bana på varje del (utan manuell höjd): banans höjd ≤
innehållets underkant + marginal. Tom bana = exakt rubrikhöjd.

## R7 – Determinism: samma indata, samma delning

Samma modell och samma sidformat ger exakt samma delning, varje gång.

**Mått:** två på varandra följande layouter av samma modell är identiska.

---

## Prioritetsordning vid konflikt

1. R4 (riktning) – får aldrig brytas.
2. R3 (sammanhang) – bryts bara när gruppen inte ryms på en egen del.
3. R2 (packning) – får ge vika för R3 (en del får avslutas tidigt för att
   hålla ihop en gateway-grupp, och det räknas inte som packningsbrott).
4. R1 följer av R2+R3.

## Kända begränsningar

- Datalager följer sin skrivande aktivitets del.
- Mottagarpooler (svarta lådor) ritas bara på delar där ett meddelandeflöde
  faktiskt utgår.
