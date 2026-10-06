"""
Elastic Examinator — backend
Webportaal om ECE-oefentaken te beheren, uit te voeren tegen een echt
Elasticsearch-cluster en automatisch feedback te krijgen.
"""

import os
import datetime
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from vragenbank import VOORBEELDVRAGEN

# ---------------------------------------------------------------------------
# Configuratie
# ---------------------------------------------------------------------------

ES_URL = os.getenv("ES_URL", "http://host.docker.internal:9200").rstrip("/")
ES_API_KEY = os.getenv("ES_API_KEY", "").strip()
ES_USER = os.getenv("ES_USER", "").strip()
ES_PASS = os.getenv("ES_PASS", "").strip()
ES_VERIFY_TLS = os.getenv("ES_VERIFY_TLS", "false").lower() in ("1", "true", "yes")

INDEX_VRAGEN = "examinator-vragen"
INDEX_POGINGEN = "examinator-pogingen"

DOMEINEN = [
    "Data Management",
    "Searching Data",
    "Developing Search Applications",
    "Data Processing",
    "Cluster Management",
]

app = FastAPI(title="Elastic Examinator")


def _auth_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if ES_API_KEY:
        headers["Authorization"] = f"ApiKey {ES_API_KEY}"
    return headers


def _auth_basic():
    if not ES_API_KEY and ES_USER:
        return (ES_USER, ES_PASS)
    return None


async def es_request(method: str, path: str, body: Any = None) -> dict:
    """Voer een request uit tegen het Elasticsearch-cluster en geef
    status + (geparste) respons terug. HTTP-fouten van ES worden gewoon
    doorgegeven; verbindingsfouten worden vertaald naar 502."""
    if not path.startswith("/"):
        path = "/" + path
    kwargs: dict = {}
    if isinstance(body, str) and body.strip():
        # NDJSON (bijv. _bulk): als string doorsturen, niet als JSON serialiseren
        kwargs["content"] = body if body.endswith("\n") else body + "\n"
        headers = _auth_headers() | {"Content-Type": "application/x-ndjson"}
    else:
        if body not in (None, ""):
            kwargs["json"] = body
        headers = _auth_headers()
    async with httpx.AsyncClient(verify=ES_VERIFY_TLS, timeout=30.0) as client:
        try:
            resp = await client.request(
                method.upper(),
                ES_URL + path,
                headers=headers,
                auth=_auth_basic(),
                **kwargs,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Geen verbinding met Elasticsearch op {ES_URL}: {exc}",
            )
    try:
        parsed = resp.json()
    except ValueError:
        parsed = resp.text
    return {"status": resp.status_code, "body": parsed}


# ---------------------------------------------------------------------------
# Indexbeheer
# ---------------------------------------------------------------------------

VRAGEN_MAPPING = {
    "mappings": {
        "properties": {
            "titel": {"type": "text"},
            "domein": {"type": "keyword"},
            "opdracht": {"type": "text"},
            "hint": {"type": "text"},
            "modelantwoord": {"type": "text"},
            "checks": {"type": "object", "enabled": False},
            "setup": {"type": "object", "enabled": False},
            "bron": {"type": "keyword"},
            "aangemaakt": {"type": "date"},
        }
    }
}

POGINGEN_MAPPING = {
    "mappings": {
        "properties": {
            "vraag_id": {"type": "keyword"},
            "antwoord": {"type": "text"},
            "geslaagd": {"type": "boolean"},
            "details": {"type": "object", "enabled": False},
            "tijdstip": {"type": "date"},
        }
    }
}


async def ensure_index(naam: str, mapping: dict):
    bestaat = await es_request("HEAD", f"/{naam}")
    if bestaat["status"] == 404:
        await es_request("PUT", f"/{naam}", mapping)


# ---------------------------------------------------------------------------
# Modellen
# ---------------------------------------------------------------------------

class Verwachting(BaseModel):
    # type: "status"  -> alleen HTTP 2xx vereist
    # type: "json"    -> waarde op `pad` in respons vergelijken
    type: str = "status"
    pad: Optional[str] = None          # bijv. "hits.total.value"
    operator: str = "eq"               # eq | gte | lte | contains | exists
    waarde: Optional[Any] = None


class Check(BaseModel):
    naam: str
    methode: str = "GET"
    pad: str
    body: Optional[Any] = None
    verwachting: Verwachting = Field(default_factory=Verwachting)


class SetupStap(BaseModel):
    naam: str = ""
    methode: str = "PUT"
    pad: str
    body: Optional[Any] = None


class Vraag(BaseModel):
    titel: str
    domein: str
    opdracht: str
    hint: str = ""
    modelantwoord: str = ""
    checks: list[Check] = Field(default_factory=list)
    setup: list[SetupStap] = Field(default_factory=list)


class Antwoord(BaseModel):
    antwoord: str = ""


class EsProxyRequest(BaseModel):
    methode: str = "GET"
    pad: str
    body: Optional[Any] = None


# ---------------------------------------------------------------------------
# Hulpmiddelen voor checks
# ---------------------------------------------------------------------------

def json_pad(data: Any, pad: str) -> tuple[bool, Any]:
    """Volg een pad met puntnotatie door een geneste structuur.
    Numerieke segmenten worden als lijstindex gebruikt."""
    huidig = data
    for deel in pad.split("."):
        if isinstance(huidig, dict) and deel in huidig:
            huidig = huidig[deel]
        elif isinstance(huidig, list) and deel.isdigit() and int(deel) < len(huidig):
            huidig = huidig[int(deel)]
        else:
            return False, None
    return True, huidig


def _als_getal(waarde: Any):
    try:
        return float(waarde)
    except (TypeError, ValueError):
        return None


def evalueer(verwachting: Verwachting, resultaat: dict) -> tuple[bool, str]:
    status = resultaat["status"]
    body = resultaat["body"]

    if verwachting.type == "status":
        ok = 200 <= status < 300
        return ok, f"HTTP-status {status}" + ("" if ok else " (verwacht: 2xx)")

    gevonden, werkelijk = json_pad(body, verwachting.pad or "")
    if verwachting.operator == "exists":
        return gevonden, (
            f"Veld '{verwachting.pad}' gevonden (waarde: {werkelijk})"
            if gevonden else f"Veld '{verwachting.pad}' niet gevonden in de respons"
        )
    if not gevonden:
        return False, f"Veld '{verwachting.pad}' niet gevonden in de respons"

    verwacht = verwachting.waarde
    if verwachting.operator == "eq":
        ok = str(werkelijk) == str(verwacht)
    elif verwachting.operator in ("gte", "lte"):
        w, v = _als_getal(werkelijk), _als_getal(verwacht)
        if w is None or v is None:
            return False, f"'{werkelijk}' is geen getal, kan niet vergelijken"
        ok = w >= v if verwachting.operator == "gte" else w <= v
    elif verwachting.operator == "contains":
        ok = str(verwacht).lower() in str(werkelijk).lower()
    else:
        return False, f"Onbekende operator '{verwachting.operator}'"

    symbool = {"eq": "=", "gte": ">=", "lte": "<=", "contains": "bevat"}[verwachting.operator]
    return ok, f"{verwachting.pad}: werkelijk '{werkelijk}', verwacht {symbool} '{verwacht}'"


# ---------------------------------------------------------------------------
# API: cluster
# ---------------------------------------------------------------------------

@app.get("/api/cluster")
async def cluster_status():
    res = await es_request("GET", "/_cluster/health")
    if res["status"] != 200:
        raise HTTPException(status_code=502, detail=res["body"])
    return res["body"]


@app.post("/api/es")
async def es_proxy(req: EsProxyRequest):
    """Vrije console: kijk rechtstreeks mee in het cluster."""
    return await es_request(req.methode, req.pad, req.body)


# ---------------------------------------------------------------------------
# API: vragen
# ---------------------------------------------------------------------------

@app.get("/api/vragen")
async def vragen_lijst():
    await ensure_index(INDEX_VRAGEN, VRAGEN_MAPPING)
    res = await es_request("POST", f"/{INDEX_VRAGEN}/_search", {
        "size": 500,
        "sort": [{"aangemaakt": "asc"}],
        "query": {"match_all": {}},
    })
    if res["status"] != 200:
        raise HTTPException(status_code=502, detail=res["body"])
    hits = res["body"].get("hits", {}).get("hits", [])
    vragen = [{"id": h["_id"], **h["_source"]} for h in hits]

    # Laatste poging per vraag meesturen voor statusbadges
    pog = await es_request("POST", f"/{INDEX_POGINGEN}/_search", {
        "size": 0,
        "aggs": {
            "per_vraag": {
                "terms": {"field": "vraag_id", "size": 500},
                "aggs": {"laatste": {"top_hits": {
                    "size": 1,
                    "sort": [{"tijdstip": "desc"}],
                    "_source": ["geslaagd", "tijdstip"],
                }}},
            }
        },
    })
    status_per_vraag = {}
    if pog["status"] == 200:
        for bucket in pog["body"].get("aggregations", {}).get("per_vraag", {}).get("buckets", []):
            top = bucket["laatste"]["hits"]["hits"]
            if top:
                status_per_vraag[bucket["key"]] = top[0]["_source"]
    for v in vragen:
        v["laatste_poging"] = status_per_vraag.get(v["id"])
    return {"vragen": vragen, "domeinen": DOMEINEN}


@app.post("/api/vragen")
async def vraag_toevoegen(vraag: Vraag):
    await ensure_index(INDEX_VRAGEN, VRAGEN_MAPPING)
    doc = vraag.model_dump()
    doc["aangemaakt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    res = await es_request("POST", f"/{INDEX_VRAGEN}/_doc?refresh=wait_for", doc)
    if res["status"] not in (200, 201):
        raise HTTPException(status_code=502, detail=res["body"])
    return {"id": res["body"]["_id"]}


@app.put("/api/vragen/{vraag_id}")
async def vraag_bijwerken(vraag_id: str, vraag: Vraag):
    bestaand = await es_request("GET", f"/{INDEX_VRAGEN}/_doc/{vraag_id}")
    if bestaand["status"] != 200:
        raise HTTPException(status_code=404, detail="Vraag niet gevonden")
    doc = vraag.model_dump()
    doc["aangemaakt"] = bestaand["body"]["_source"].get("aangemaakt")
    if bestaand["body"]["_source"].get("bron"):
        doc["bron"] = bestaand["body"]["_source"]["bron"]
    res = await es_request("PUT", f"/{INDEX_VRAGEN}/_doc/{vraag_id}?refresh=wait_for", doc)
    if res["status"] not in (200, 201):
        raise HTTPException(status_code=502, detail=res["body"])
    return {"id": vraag_id}


@app.delete("/api/vragen/{vraag_id}")
async def vraag_verwijderen(vraag_id: str):
    res = await es_request("DELETE", f"/{INDEX_VRAGEN}/_doc/{vraag_id}?refresh=wait_for")
    if res["status"] not in (200, 404):
        raise HTTPException(status_code=502, detail=res["body"])
    return {"verwijderd": res["status"] == 200}


# ---------------------------------------------------------------------------
# API: controleren & pogingen
# ---------------------------------------------------------------------------

@app.post("/api/vragen/{vraag_id}/voorbereiden")
async def vraag_voorbereiden(vraag_id: str):
    """Voer de setup-stappen van een vraag uit (testdata klaarzetten)."""
    res = await es_request("GET", f"/{INDEX_VRAGEN}/_doc/{vraag_id}")
    if res["status"] != 200:
        raise HTTPException(status_code=404, detail="Vraag niet gevonden")
    stappen = [SetupStap(**s) for s in res["body"]["_source"].get("setup", [])]
    if not stappen:
        return {"stappen": [], "melding": "Deze vraag heeft geen voorbereiding nodig."}
    resultaten = []
    for stap in stappen:
        try:
            uitkomst = await es_request(stap.methode, stap.pad, stap.body)
            ok = 200 <= uitkomst["status"] < 300
            uitleg = f"HTTP-status {uitkomst['status']}"
        except HTTPException as exc:
            ok, uitleg = False, str(exc.detail)
        resultaten.append({
            "naam": stap.naam or stap.pad,
            "geslaagd": ok,
            "uitleg": uitleg,
            "request": f"{stap.methode.upper()} {stap.pad}",
        })
    return {"stappen": resultaten}


@app.post("/api/vragen/{vraag_id}/controleer")
async def vraag_controleren(vraag_id: str, antwoord: Antwoord):
    res = await es_request("GET", f"/{INDEX_VRAGEN}/_doc/{vraag_id}")
    if res["status"] != 200:
        raise HTTPException(status_code=404, detail="Vraag niet gevonden")
    bron = res["body"]["_source"]
    checks = [Check(**c) for c in bron.get("checks", [])]

    resultaten = []
    alles_ok = True
    for check in checks:
        try:
            uitkomst = await es_request(check.methode, check.pad, check.body)
            ok, uitleg = evalueer(check.verwachting, uitkomst)
        except HTTPException as exc:
            ok, uitleg = False, str(exc.detail)
        alles_ok = alles_ok and ok
        resultaten.append({
            "naam": check.naam,
            "geslaagd": ok,
            "uitleg": uitleg,
            "request": f"{check.methode.upper()} {check.pad}",
        })

    if not checks:
        alles_ok = False
        resultaten.append({
            "naam": "Geen checks gedefinieerd",
            "geslaagd": False,
            "uitleg": "Voeg bij deze vraag minimaal één verificatiecheck toe in Vragen beheren.",
            "request": "—",
        })

    # Poging vastleggen
    await ensure_index(INDEX_POGINGEN, POGINGEN_MAPPING)
    await es_request("POST", f"/{INDEX_POGINGEN}/_doc?refresh=wait_for", {
        "vraag_id": vraag_id,
        "antwoord": antwoord.antwoord,
        "geslaagd": alles_ok,
        "details": resultaten,
        "tijdstip": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    })

    return {"geslaagd": alles_ok, "checks": resultaten}


@app.get("/api/vragen/{vraag_id}/pogingen")
async def pogingen_lijst(vraag_id: str):
    res = await es_request("POST", f"/{INDEX_POGINGEN}/_search", {
        "size": 20,
        "sort": [{"tijdstip": "desc"}],
        "query": {"term": {"vraag_id": vraag_id}},
    })
    if res["status"] != 200:
        return {"pogingen": []}
    hits = res["body"].get("hits", {}).get("hits", [])
    return {"pogingen": [{"id": h["_id"], **h["_source"]} for h in hits]}


# ---------------------------------------------------------------------------
# API: voorbeeldvragen
# ---------------------------------------------------------------------------

async def laad_vragenbank() -> int:
    """Zet de meegeleverde vragenbank in het cluster. Voorbeeldvragen hebben
    vaste id's, dus dit is idempotent: bestaande exemplaren worden ververst,
    eigen vragen (zonder bron=voorbeeld) blijven onaangeroerd."""
    await ensure_index(INDEX_VRAGEN, VRAGEN_MAPPING)
    nu = datetime.datetime.now(datetime.timezone.utc)
    for i, vraag in enumerate(VOORBEELDVRAGEN):
        doc = {k: v for k, v in vraag.items() if k != "id"}
        doc["bron"] = "voorbeeld"
        doc["aangemaakt"] = (nu + datetime.timedelta(seconds=i)).isoformat()
        await es_request("PUT", f"/{INDEX_VRAGEN}/_doc/{vraag['id']}?refresh=wait_for", doc)
    return len(VOORBEELDVRAGEN)


@app.on_event("startup")
async def seed_bij_opstarten():
    """Laad de vragenbank automatisch zodra de container draait, tenzij
    uitgezet via AUTO_SEED=false. Faalt stil als het cluster nog niet
    bereikbaar is, zodat de app altijd opstart."""
    if os.getenv("AUTO_SEED", "true").lower() in ("0", "false", "no"):
        return
    try:
        aantal = await laad_vragenbank()
        print(f"[examinator] Vragenbank automatisch geladen: {aantal} vragen.")
    except Exception as exc:  # cluster nog niet bereikbaar e.d.
        print(f"[examinator] Vragenbank niet geladen bij opstarten ({exc}). "
              f"Lukt later alsnog via de knop 'vragenbank laden'.")


@app.post("/api/seed")
async def seed():
    """Handmatig de vragenbank (her)laden vanuit het portaal."""
    aantal = await laad_vragenbank()
    return {"toegevoegd": aantal}


@app.get("/api/export")
async def export_vragen():
    """Exporteer alle vragen als JSON-array (zonder interne velden), zodat
    ze te downloaden en elders te importeren zijn."""
    await ensure_index(INDEX_VRAGEN, VRAGEN_MAPPING)
    res = await es_request("POST", f"/{INDEX_VRAGEN}/_search", {
        "size": 1000,
        "sort": [{"aangemaakt": "asc"}],
        "query": {"match_all": {}},
    })
    if res["status"] != 200:
        raise HTTPException(status_code=502, detail=res["body"])
    hits = res["body"].get("hits", {}).get("hits", [])
    velden = ("titel", "domein", "opdracht", "hint", "modelantwoord", "checks", "setup")
    vragen = []
    for h in hits:
        bron = h["_source"]
        vragen.append({k: bron[k] for k in velden if k in bron})
    return {"vragen": vragen}


class ImportRequest(BaseModel):
    vragen: list[Vraag]
    vervang_bestaande: bool = False


@app.post("/api/import")
async def import_vragen(req: ImportRequest):
    """Importeer een lijst vragen. Bij vervang_bestaande worden alle huidige
    vragen eerst verwijderd; anders worden de geimporteerde vragen toegevoegd."""
    await ensure_index(INDEX_VRAGEN, VRAGEN_MAPPING)
    if req.vervang_bestaande:
        await es_request("POST", f"/{INDEX_VRAGEN}/_delete_by_query?refresh=true&conflicts=proceed", {
            "query": {"match_all": {}},
        })
    nu = datetime.datetime.now(datetime.timezone.utc)
    aantal = 0
    for i, vraag in enumerate(req.vragen):
        doc = vraag.model_dump()
        doc["bron"] = "import"
        doc["aangemaakt"] = (nu + datetime.timedelta(milliseconds=i)).isoformat()
        res = await es_request("POST", f"/{INDEX_VRAGEN}/_doc?refresh=wait_for", doc)
        if res["status"] in (200, 201):
            aantal += 1
    return {"geimporteerd": aantal}


# Statische frontend (als laatste mounten zodat /api voorrang houdt)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
