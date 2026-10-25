# Oppsett av Fælleskassen

Med en gratis Firebase-database og gratis nettvert får dere en egen app på Hjem-skjermen som deler utgiftene mellom to iPhoner. Regn med 30 minutter. Du trenger ikke betalingskort.

## Slik henger det sammen

- **Nettvert (GitHub Pages)** legger appfilene ut på en adresse. Det er det som gjør at iPhone kan legge appen på Hjem-skjermen og åpne den uten nett etter første besøk.
- **Firebase Firestore** er databasen. Her ligger utgiftene, og herfra synkroniseres de mellom dere.
- **Delekoden** er et langt passord på 20 tegn. Den kobler de to telefonene til samme regnskap.

## Før du starter

- En Google-konto til Firebase og en GitHub-konto til nettverten.
- Mappen `faelleskassen` fra zip-filen, utpakket på datamaskinen.
- Et vanlig tekstprogram (Notisblokk eller TextEdit i ren tekst-modus) til ett lite redigeringssteg.

## Steg 1: Lag Firebase-prosjekt og database

1. Gå til console.firebase.google.com og logg inn med Google-kontoen.
2. Velg å opprette et nytt prosjekt. Kall det for eksempel `faelleskassen`. Slå av Google Analytics, den trengs ikke.
3. Bli på gratisplanen Spark. Hvis Firebase ber om betalingskort, stopp og ikke legg inn noe.
4. I menyen til venstre: **Build**, deretter **Firestore Database**, deretter **Create database**.
5. Velg **Standard edition** og la database-ID stå som `(default)`.
6. Velg en europeisk plassering, for eksempel `eur3`. Plasseringen kan ikke endres senere.
7. Velg **Production mode** og trykk **Enable**.

Menynavnene i Firebase kan være litt annerledes enn her. Se etter Firestore Database under Build.

## Steg 2: Lim inn sikkerhetsreglene

1. I Firestore Database, åpne fanen **Rules**.
2. Slett alt som står der, og lim inn dette (det samme ligger i filen `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{hid}/{document=**} {
      allow read, write: if hid.size() >= 20;
    }
  }
}
```

3. Trykk **Publish**.

Reglene betyr at alt ligger under en delekode på minst 20 tegn. Uten koden finnes det ingen vei inn, og ingen kan liste opp andres regnskap.

## Steg 3: Hent konfigurasjonen og legg den i appen

1. I Firebase, trykk på tannhjulet ved siden av Project Overview, og velg **Project settings**.
2. Under **Your apps**, trykk på web-ikonet `</>`.
3. Gi appen et navn, for eksempel `faelleskassen`. Ikke huk av for Firebase Hosting. Trykk **Register app**.
4. Du får en blokk som heter `firebaseConfig`. Kopier verdiene for `apiKey`, `authDomain`, `projectId` og `appId`.
5. Åpne filen `firebase-config.js` i mappen med et tekstprogram. Lim hver verdi inn mellom anførselstegnene, og lagre.

Disse verdiene er ikke hemmelige. De sier bare hvilket prosjekt appen skal snakke med.

## Steg 4: Legg appen på nett gratis

1. Opprett en konto på github.com.
2. Trykk **New repository**. Kall det `faelleskassen`, velg **Public** og opprett det.
3. Trykk **uploading an existing file**. Dra alle filene og mappen `icons` fra `faelleskassen` inn i nettleservinduet, og trykk **Commit changes**.
4. Gå til **Settings**, deretter **Pages**. Under Source velger du **Deploy from a branch**, branch `main` og mappen `/ (root)`, og trykker **Save**.
5. Vent et par minutter. Adressen blir `https://<brukernavn>.github.io/faelleskassen/`.

Netlify og Cloudflare Pages fungerer også, hvis du heller vil dra mappen rett inn i nettleseren.

## Steg 5: Legg appen på Hjem-skjermen og start regnskapet

1. Åpne adressen i Safari på iPhone.
2. Trykk på Del-ikonet, velg **Legg til på Hjem-skjerm** og trykk **Legg til**.
3. Åpne appen fra Hjem-skjermen, ikke fra Safari. Safari og Hjem-skjerm-appen har hver sin lagring.
4. Trykk **Start et nytt regnskap**, skriv inn navnene på dere to, og velg hvem du er.
5. Appen viser delekoden. Den kommer du alltid til under navnet ditt øverst, og deretter **Innstillinger**.

## Steg 6: Inviter den andre

1. I appen, åpne **Innstillinger** og trykk **Del invitasjon**. Send den til den andre, for eksempel i Meldinger.
2. Den andre åpner adressen i Safari og legger appen på Hjem-skjermen på samme måte.
3. Hen åpner appen fra Hjem-skjermen, limer inn delekoden under **Eller bli med med delekode**, og velger hvem hen er.

Etter dette ser dere samme utgifter og samme oppgjør, og endringer dukker opp hos begge.

## Gratisgrenser og sikkerhet

- Gratisplanen Spark gir 1 GiB lagring, 50 000 lesinger og 20 000 skrivinger per dag. Et regnskap for to bruker en liten brøkdel av det. Hvis grensen likevel nås, stenges tjenesten for resten av måneden, og du blir ikke belastet.
- Delekoden fungerer som et passord. Alle som har den kan se og endre regnskapet. Ikke legg den ut på nett.
- Appen har ingen innlogging. Det betyr at noen som kjenner prosjektets konfigurasjon i teorien kan skrive søppel under egne koder og bruke opp dagskvoten. Risikoen er liten for en privat adresse.
- Firestore har ingen gratis automatisk sikkerhetskopi. Ta et skjermbilde av oppgjøret hver måned hvis du vil ha et spor.

Kilder: Firebase sine sider om prisplaner og Firestore sin prisside.

## Hvis noe ikke virker

- **«Appen er ikke koblet til en database ennå»:** `firebase-config.js` er tom eller ikke lastet opp. Fyll inn verdiene, last filen opp til GitHub på nytt og vent et par minutter.
- **«Databasen avviste tilgangen»:** reglene er ikke publisert. Gjør steg 2 på nytt.
- **«Kunne ikke laste databasen»:** du har ikke nett første gang du åpner appen, eller verdiene i `firebase-config.js` er feil.
- **Den andre ser ikke endringene:** sjekk at begge bruker samme delekode under Innstillinger.
- **Appen viser gammel versjon etter at du har endret filer:** lukk appen helt ved å sveipe den bort, og åpne den to ganger.
- **Appen på Hjem-skjermen er tom:** det er normalt for en ny installasjon. Velg **Bli med** og skriv inn delekoden. Utgiftene ligger i databasen.
