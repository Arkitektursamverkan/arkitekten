# Innehållspaket

Ett innehållspaket är en installations innehåll i Arkitekten som filer:
processerna med hela sin historik, visualiseringarna och symbolstilarna. Med
ett paket flyttas innehåll mellan installationer, läggs ett exempel in i en ny
installation eller sparas innehållet i ett eget repo. Formen följer portalens
innehållspaket.

```
pack.json          { "format": "arkitekten.innehallspaket", "version": 1, "namn": "…", "beskrivning": "…" }
flows/<id>.json    processer
ramar/<id>.json    visualiseringar
stilar/<id>.json   symbolstilar (docs/affarsprocess.md)
```

En katalog som saknas betyder att paketet inte har den sortens innehåll.

## Importen skriver aldrig över

Finns en process, en visualisering eller en stil med samma id redan i
installationen rörs den inte – en befintlig version får aldrig skrivas över
(invariant 11). Importen säger vad som lades in, vad som redan fanns likadant
och vad som fanns med annat innehåll. Varje fil prövas först: ett trasigt
dokument, ett id som inte stämmer med filnamnet eller en stil med otillåtna
värden läggs inte in. Valet av symbolstil följer aldrig med ett paket.

## Exempelpaket

Med produkten följer `innehallspaket/exempel/`: en affärsprocess och en
systemprocess. En administratör lägger in det under **Inställningar →
Exempelinnehåll**, eller i containern:

```sh
docker compose exec -u node arkitekten node_modules/.bin/tsx server/innehallspaket.mts list
docker compose exec -u node arkitekten node_modules/.bin/tsx server/innehallspaket.mts import exempel
```

Paketet byggs av `scripts/bygg-exempelpaket.mts` ur text som regelmotorn
tolkar – kör skriptet igen när mellanlagret ändras.

## Exportera och importera

```sh
# Exportera (utan användarnas egna processer):
docker compose exec -u node arkitekten node_modules/.bin/tsx server/innehallspaket.mts export /data/export --namn min-organisation --utan-egna
docker compose cp arkitekten:/data/export ./paket

# Importera – pröva först:
docker compose cp ./paket arkitekten:/data/import
docker compose exec -u node arkitekten node_modules/.bin/tsx server/innehallspaket.mts import /data/import --torrkorning
docker compose exec -u node arkitekten node_modules/.bin/tsx server/innehallspaket.mts import /data/import
```

## Säkerhetskopiering

`scripts/sakerhetskopiera-innehall.sh` versionerar innehållet i ett lokalt
git-repo utan fjärr (push spärrad). Det läser samma kataloger som servern
(`FLOWS_DIR`, `RAMAR_DIR`, `STILAR_DIR`) och körs varje natt av installationen.
Innehållspaketen ersätter det inte: paketet är ett sätt att flytta innehåll,
säkerhetskopian ett sätt att aldrig förlora det.
