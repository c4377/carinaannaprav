# Quiz → ActiveCampaign (Netlify) — Setup

## Dateien
- `quiz.html` — das Quiz (in dein Design integriert)
- `netlify/functions/subscribe.js` — schickt die Daten serverseitig an ActiveCampaign
- `netlify.toml` — Netlify-Konfiguration

## 1. In ActiveCampaign anlegen
1. **Liste** erstellen, z.B. „Quiz / Freebie".
   ID findest du unter *Contacts → Lists* → Liste anklicken → die Zahl in der URL (`…/list/overview/XX`).
2. **Custom Field** erstellen: *Settings → Fields* → neues Feld „Angebots-Typ" (Typ: Text).
   Die **Field-ID** findest du, wenn du das Feld bearbeitest → in der URL, oder über die API.
3. **API-Zugang**: *Settings → Developer* → dort stehen **API URL** und **API Key**.

## 2. In Netlify eintragen
*Site settings → Environment variables* → diese vier anlegen:

| Variable     | Wert (Beispiel)                          |
|--------------|------------------------------------------|
| `AC_API_URL` | `https://deinaccount.api-us1.com`        |
| `AC_API_KEY` | dein API Key                             |
| `AC_LIST_ID` | `5`                                      |
| `AC_FIELD_ID`| `12`                                     |
| `AC_ANGEBOT_FIELD_ID` | `13` (optional — Feld „Angebot (Text)") |
| `ANTHROPIC_API_KEY` | dein Anthropic API Key (für die Live-Analyse im Quiz) |

> Die Secrets stehen NICHT im Code — nur hier. Das Quiz ruft die Function auf,
> die Function spricht mit ActiveCampaign.

## 3. Deploy
- Ordner `site/` zu Netlify pushen (Git oder Drag-and-drop).
- Quiz liegt dann unter `https://deine-domain/quiz.html`.

## Was passiert beim Absenden
1. Kontakt wird angelegt/aktualisiert (Vorname + E-Mail).
2. Custom Field „Angebots-Typ" wird gesetzt (Wert unsichtbar / Ansprache unscharf / Preis ohne Fundament / Kein Kaufanlass).
3. Optional: Custom Field „Angebot (Text)" speichert, wie sie ihr Angebot selbst beschrieben hat — Gold fürs Erstgespräch.
4. Kontakt kommt in die Liste.
5. Tags `quiz-lead` und `quiz-<typ>` werden gesetzt → praktisch für Automationen.

## Live-Analyse im Quiz (Claude)
Das Quiz schickt den beschriebenen Angebots-Text an `netlify/functions/analyze.js`,
die ihn von Claude analysieren lässt und eine individuelle Auswertung zurückgibt
(blinder Fleck + erster Hebel, in deinem Ton).

- Dafür `ANTHROPIC_API_KEY` als Env-Variable setzen (console.anthropic.com).
- **Kosten:** ein paar Cent pro Analyse. In der Anthropic-Console ein
  Ausgabenlimit setzen, dann gibt es keine Überraschungen.
- **Schutz:** Die Funktion begrenzt Textlänge und Anfragen pro Besucher.
- **Fallback:** Antwortet die API nicht (oder kein Key gesetzt), fällt das Quiz
  automatisch auf eine der vier Standard-Auswertungen zurück — es bricht nie.

## Checkliste per Mail verschicken
Die Checkliste wird im Quiz direkt angezeigt. Für den Versand per Mail:
Lege in ActiveCampaign eine **Automation** an: Trigger „Tag `quiz-lead` hinzugefügt"
→ E-Mail mit der Checkliste (oder PDF-Link) senden. So bekommt jede Quiz-Teilnehmerin
die Checkliste automatisch ins Postfach.
