# Elastic Examinator

Lokaal webportaal om te oefenen voor de Elastic Certified Engineer. Je voegt zelf
opdrachten toe, voert ze uit in je eigen cluster, en de examinator kijkt via de
Elasticsearch-API mee of het resultaat klopt. Vragen en pogingen worden opgeslagen
in je cluster zelf (indices `examinator-vragen` en `examinator-pogingen`).

## Starten

1. Kopieer `.env.example` naar `.env` en vul je cluster-URL en inloggegevens in.
2. `docker compose up --build -d`
3. Open http://localhost:8765
4. De 26 oefenvragen in het Engels over alle vijf de
   automatisch in (elk met hint, modelantwoord en automatische verificatie).
   Wil je dat niet, zet dan `AUTO_SEED=false` in je `.env`. Met de knop
   **vragenbank laden** kun je ze ook handmatig (her)laden; eigen vragen blijven staan.

## Hoe het werkt

- **Examen** - kies een vraag, voer de opdracht uit in je cluster (Dev Tools of de
  Console-tab), noteer je uitwerking en klik *Controleer in cluster* (Cmd+Enter).
  Elke verificatiecheck doet een echte API-call naar je cluster en toont PASS/FAIL
  met de werkelijke waarde. Hint en modelantwoord helpen je verder als het niet lukt.
- **Vragen beheren** - maak eigen opdrachten met een of meer checks. Een check is
  een API-call (methode + pad + optionele body) plus een verwachting: alleen een
  2xx-status, of een waarde in de respons (puntnotatie, bijv. `hits.total.value`
  met operator `gte` en waarde `3`).
- **Console** - vrije mini-Dev-Tools om rechtstreeks in je omgeving mee te kijken.
- **Import / export** - in *Vragen beheren* exporteer je alle vragen als JSON-bestand
  en importeer je ze weer (toevoegen of de hele set vervangen). Handig om je eigen
  vragensets te delen, te back-uppen of tussen omgevingen over te zetten.
- **Testdata** - vragen met een *Testdata klaarzetten*-knop zetten zelf de benodigde
  oefendocumenten in je cluster (bijv. voor reindex- en update_by_query-opdrachten).

## Tips

- Cluster draait niet op je eigen machine? Pas `ES_URL` aan in `.env`.
- Zelf-ondertekend certificaat (https): laat `ES_VERIFY_TLS=false` staan.
- Poort 8765 bezet? Wijzig de eerste poort in `docker-compose.yml`.
