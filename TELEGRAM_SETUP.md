# TidyCal → Telegram Benachrichtigung — Setup

Du bekommst bei jeder Buchung sofort eine Telegram-Nachricht mit Name,
E-Mail, Termin und der Antwort auf deine Buchungsfrage.

## 1. Telegram-Bot anlegen (einmalig, 2 Minuten)
1. In Telegram **@BotFather** öffnen.
2. `/newbot` schreiben, Namen + Benutzernamen vergeben.
3. BotFather gibt dir einen **Token** (lange Zeichenkette wie `12345:ABC…`).
   → das ist dein `TELEGRAM_BOT_TOKEN`.
4. Schreib deinem neuen Bot einmal **irgendeine Nachricht** (z.B. „hi"),
   sonst darf er dir nicht zurückschreiben.

## 2. Deine Chat-ID finden
1. In Telegram **@userinfobot** öffnen und `/start` schreiben.
2. Er zeigt dir deine **Id** (eine Zahl).
   → das ist deine `TELEGRAM_CHAT_ID`.

## 3. In Netlify eintragen
*Site settings → Environment variables*:

| Variable                 | Wert                                  |
|--------------------------|---------------------------------------|
| `TELEGRAM_BOT_TOKEN`     | dein Bot-Token                        |
| `TELEGRAM_CHAT_ID`       | deine Chat-ID                         |
| `TIDYCAL_WEBHOOK_SECRET` | ein selbst gewähltes Passwort (optional, empfohlen) |

Nach dem Eintragen einmal neu deployen (Netlify → Deploys → Trigger deploy).

## 4. Webhook in TidyCal einrichten
Deine Funktion liegt nach dem Deploy unter:

```
https://DEINE-NETLIFY-DOMAIN/.netlify/functions/tidycal-telegram
```

Wenn du ein Secret gesetzt hast, häng es an:

```
https://DEINE-NETLIFY-DOMAIN/.netlify/functions/tidycal-telegram?secret=DEINPASSWORT
```

In TidyCal:
1. **Settings → Integrations → Webhooks** (oder beim Buchungstyp unter den
   erweiterten Einstellungen, je nach TidyCal-Plan).
2. Neuen Webhook anlegen, Event **„Booking created"** wählen.
3. Die obige URL eintragen, speichern.

> Hinweis: Webhooks sind in TidyCal ein Feature des kostenpflichtigen Plans.
> Falls du keinen Webhook findest, nutze stattdessen die Make-Variante unten.

## 5. Testen
Mach eine Test-Buchung auf deiner TidyCal-Seite. Innerhalb weniger Sekunden
sollte die Telegram-Nachricht kommen. Kommt nichts:
- Hast du dem Bot einmal selbst geschrieben? (Schritt 1.4)
- Stimmen Token und Chat-ID?
- In Netlify unter *Functions → tidycal-telegram → Logs* siehst du Fehler.

---

## Alternative ohne Code: Make (Integromat)
Falls dein TidyCal-Plan keine Webhooks erlaubt:
1. In **make.com** ein neues Szenario anlegen.
2. Modul **TidyCal → Watch Bookings** (verbindet sich per Login).
3. Modul **Telegram Bot → Send a Message** anhängen.
4. Felder aus der Buchung in die Nachricht mappen.
Make hat einen Gratis-Tarif, der für gelegentliche Buchungen reicht.
