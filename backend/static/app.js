/* Elastic Examinator — frontend */

const api = {
  async vraag(method, pad, body) {
    const res = await fetch(pad, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    return data;
  },
};

const el = (id) => document.getElementById(id);
const state = {
  vragen: [],
  domeinen: [],
  filter: null,
  actieveVraag: null,
  bewerkVraag: null, // null = nieuw
};

/* ---------------- navigatie ---------------- */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("actief", t === tab));
    ["examen", "beheer", "console"].forEach((v) =>
      el("view-" + v).classList.toggle("verborgen", tab.dataset.view !== v)
    );
  });
});

/* ---------------- clusterstatus ---------------- */

async function clusterStatus() {
  const pill = el("cluster-pill");
  try {
    const h = await api.vraag("GET", "/api/cluster");
    pill.className = "pill pill-" + h.status;
    el("cluster-tekst").textContent = `${h.cluster_name} · ${h.status} · ${h.number_of_nodes} node(s)`;
  } catch (e) {
    pill.className = "pill pill-fout";
    el("cluster-tekst").textContent = "geen verbinding";
    pill.title = e.message;
  }
}

/* ---------------- vragen laden ---------------- */

async function laadVragen() {
  try {
    const data = await api.vraag("GET", "/api/vragen");
    state.vragen = data.vragen;
    state.domeinen = data.domeinen;
  } catch (e) {
    state.vragen = [];
    state.domeinen = state.domeinen.length ? state.domeinen : [];
  }
  renderFilters();
  renderLijst();
  renderBeheerLijst();
  vulDomeinSelect();
}

function renderFilters() {
  const div = el("domein-filters");
  div.innerHTML = "";
  const alle = document.createElement("button");
  alle.className = "chip" + (state.filter === null ? " actief" : "");
  alle.textContent = "alle";
  alle.onclick = () => { state.filter = null; renderFilters(); renderLijst(); };
  div.appendChild(alle);
  state.domeinen.forEach((d) => {
    const b = document.createElement("button");
    b.className = "chip" + (state.filter === d ? " actief" : "");
    b.textContent = d.replace("Developing Search Applications", "Search Apps").replace("Data ", "").replace("Cluster ", "Cluster ");
    b.title = d;
    b.onclick = () => { state.filter = d; renderFilters(); renderLijst(); };
    div.appendChild(b);
  });
}

function renderLijst() {
  const ul = el("vragenlijst");
  ul.innerHTML = "";
  const vragen = state.vragen.filter((v) => !state.filter || v.domein === state.filter);
  el("lijst-leeg").classList.toggle("verborgen", vragen.length > 0);
  vragen.forEach((v) => {
    const li = document.createElement("li");
    li.classList.toggle("actief", state.actieveVraag?.id === v.id);
    const dot = document.createElement("span");
    dot.className = "statusdot" +
      (v.laatste_poging ? (v.laatste_poging.geslaagd ? " ok" : " fail") : "");
    dot.title = v.laatste_poging
      ? (v.laatste_poging.geslaagd ? "Laatste poging geslaagd" : "Laatste poging mislukt")
      : "Nog niet geprobeerd";
    const naam = document.createElement("span");
    naam.className = "vraag-naam";
    naam.innerHTML = `${escapeHtml(v.titel)}<span class="vraag-dom">${escapeHtml(v.domein)}</span>`;
    li.append(dot, naam);
    li.onclick = () => kiesVraag(v);
    ul.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function metCode(s) {
  // `tekst` tussen backticks als code weergeven
  return escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/* ---------------- examenflow ---------------- */

function kiesVraag(v) {
  state.actieveVraag = v;
  renderLijst();
  el("vraag-leeg").classList.add("verborgen");
  el("vraagkaart").classList.remove("verborgen");
  el("vraag-domein").textContent = v.domein;
  el("vraag-titel").textContent = v.titel;
  el("vraag-opdracht").innerHTML = metCode(v.opdracht);
  el("antwoord").value = "";
  el("hintvak").classList.add("verborgen");
  el("modelvak").classList.add("verborgen");
  el("feedback").classList.add("verborgen");
  el("setupvak").classList.add("verborgen");
  el("btn-voorbereiden").classList.toggle("verborgen", !(v.setup && v.setup.length));
  const status = el("vraag-status");
  if (v.laatste_poging) {
    status.textContent = v.laatste_poging.geslaagd ? "eerder behaald" : "laatste poging mislukt";
    status.className = "badge " + (v.laatste_poging.geslaagd ? "" : "badge-fout");
  } else {
    status.textContent = "nog niet geprobeerd";
    status.className = "badge badge-stil";
  }
  laadPogingen(v.id);
}

el("btn-hint").onclick = () => {
  const vak = el("hintvak");
  vak.textContent = state.actieveVraag?.hint || "Voor deze vraag is geen hint vastgelegd.";
  vak.classList.toggle("verborgen");
};

el("btn-model").onclick = () => {
  const vak = el("modelvak");
  vak.textContent = state.actieveVraag?.modelantwoord || "Voor deze vraag is geen modelantwoord vastgelegd.";
  vak.classList.toggle("verborgen");
};

el("btn-voorbereiden").onclick = async () => {
  const v = state.actieveVraag;
  if (!v) return;
  const knop = el("btn-voorbereiden");
  knop.disabled = true;
  const vak = el("setupvak");
  try {
    const res = await api.vraag("POST", `/api/vragen/${v.id}/voorbereiden`);
    vak.textContent = res.melding || res.stappen
      .map((s) => `${s.geslaagd ? "OK " : "FOUT"} ${s.naam} (${s.uitleg})`)
      .join("\n");
    vak.classList.remove("verborgen");
  } catch (e) {
    vak.textContent = "Voorbereiden mislukt: " + e.message;
    vak.classList.remove("verborgen");
  } finally {
    knop.disabled = false;
  }
};

el("btn-controleer").onclick = controleer;
el("antwoord").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") controleer();
});

async function controleer() {
  const v = state.actieveVraag;
  if (!v) return;
  const knop = el("btn-controleer");
  knop.disabled = true;
  knop.textContent = "Controleren…";
  try {
    const res = await api.vraag("POST", `/api/vragen/${v.id}/controleer`, {
      antwoord: el("antwoord").value,
    });
    toonFeedback(res);
    await laadVragen();
    state.actieveVraag = state.vragen.find((x) => x.id === v.id) || v;
    renderLijst();
    laadPogingen(v.id);
    const status = el("vraag-status");
    status.textContent = res.geslaagd ? "eerder behaald" : "laatste poging mislukt";
    status.className = "badge " + (res.geslaagd ? "" : "badge-fout");
  } catch (e) {
    toonFeedback({
      geslaagd: false,
      checks: [{ naam: "Controle mislukt", geslaagd: false, uitleg: e.message, request: "—" }],
    });
  } finally {
    knop.disabled = false;
    knop.textContent = "Controleer in cluster";
  }
}

function toonFeedback(res) {
  el("feedback").classList.remove("verborgen");
  const r = el("feedback-resultaat");
  r.textContent = res.geslaagd ? "GESLAAGD ✓" : "NOG NIET ✗";
  r.className = res.geslaagd ? "ok" : "fail";
  const ul = el("feedback-checks");
  ul.innerHTML = "";
  res.checks.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="check-chip ${c.geslaagd ? "ok" : ""}">${c.geslaagd ? "PASS" : "FAIL"}</span>
      <span>
        <span class="check-naam">${escapeHtml(c.naam)}</span>
        <span class="check-uitleg">${escapeHtml(c.uitleg)}</span>
        <span class="check-request">${escapeHtml(c.request)}</span>
      </span>`;
    ul.appendChild(li);
  });
  if (!res.geslaagd && state.actieveVraag?.hint) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="check-chip ok">TIP</span>
      <span><span class="check-uitleg">Loop je vast? Gebruik “Hint tonen” of vergelijk met het modelantwoord.</span></span>`;
    ul.appendChild(li);
  }
}

async function laadPogingen(vraagId) {
  const blok = el("pogingen-blok");
  try {
    const data = await api.vraag("GET", `/api/vragen/${vraagId}/pogingen`);
    const ul = el("pogingenlijst");
    ul.innerHTML = "";
    data.pogingen.forEach((p) => {
      const li = document.createElement("li");
      const tijd = new Date(p.tijdstip).toLocaleString("nl-NL");
      li.textContent = `${tijd} — ${p.geslaagd ? "geslaagd" : "mislukt"}`;
      ul.appendChild(li);
    });
    blok.classList.toggle("verborgen", data.pogingen.length === 0);
  } catch {
    blok.classList.add("verborgen");
  }
}

el("btn-seed").onclick = async () => {
  try {
    const res = await api.vraag("POST", "/api/seed");
    await laadVragen();
    alert(`Vragenbank geladen: ${res.toegevoegd} vragen (eigen vragen blijven staan).`);
  } catch (e) {
    alert("Voorbeelden laden mislukt: " + e.message);
  }
};

/* ---------------- beheer ---------------- */

function vulDomeinSelect() {
  const sel = el("f-domein");
  const huidig = sel.value;
  sel.innerHTML = "";
  state.domeinen.forEach((d) => {
    const o = document.createElement("option");
    o.value = o.textContent = d;
    sel.appendChild(o);
  });
  if (huidig) sel.value = huidig;
}

function renderBeheerLijst() {
  const ul = el("beheerlijst");
  ul.innerHTML = "";
  state.vragen.forEach((v) => {
    const li = document.createElement("li");
    li.classList.toggle("actief", state.bewerkVraag?.id === v.id);
    li.innerHTML = `<span class="vraag-naam">${escapeHtml(v.titel)}<span class="vraag-dom">${escapeHtml(v.domein)} · ${(v.checks || []).length} check(s)</span></span>`;
    li.onclick = () => vulFormulier(v);
    ul.appendChild(li);
  });
}

el("btn-nieuw").onclick = () => vulFormulier(null);

el("btn-export").onclick = async () => {
  try {
    const data = await api.vraag("GET", "/api/export");
    const blob = new Blob([JSON.stringify(data.vragen, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `examinator-vragen-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Exporteren mislukt: " + e.message);
  }
};

el("btn-import").onclick = () => el("import-file").click();

el("import-file").addEventListener("change", async (e) => {
  const bestand = e.target.files[0];
  if (!bestand) return;
  let vragen;
  try {
    const tekst = await bestand.text();
    vragen = JSON.parse(tekst);
    if (!Array.isArray(vragen)) {
      // ook een {"vragen": [...]} export accepteren
      if (Array.isArray(vragen.vragen)) vragen = vragen.vragen;
      else throw new Error("Verwacht een JSON-array van vragen.");
    }
  } catch (err) {
    alert("Kon het bestand niet lezen: " + err.message);
    e.target.value = "";
    return;
  }
  const vervang = confirm(
    `${vragen.length} vraag/vragen gevonden.\n\n` +
    "OK = bestaande vragen vervangen door deze set.\n" +
    "Annuleren = toevoegen aan de bestaande vragen."
  );
  // confirm geeft true (OK = vervangen) of false (toevoegen); beide zijn geldig
  try {
    const res = await api.vraag("POST", "/api/import", { vragen, vervang_bestaande: vervang });
    await laadVragen();
    alert(`${res.geimporteerd} vraag/vragen geimporteerd.`);
  } catch (err) {
    alert("Importeren mislukt: " + err.message);
  } finally {
    e.target.value = "";
  }
});

function vulFormulier(v) {
  state.bewerkVraag = v;
  renderBeheerLijst();
  el("form-titel").textContent = v ? "Vraag bewerken" : "Nieuwe vraag";
  el("f-titel").value = v?.titel || "";
  el("f-domein").value = v?.domein || state.domeinen[0] || "";
  el("f-opdracht").value = v?.opdracht || "";
  el("f-hint").value = v?.hint || "";
  el("f-model").value = v?.modelantwoord || "";
  el("f-setup").value = v?.setup && v.setup.length ? JSON.stringify(v.setup, null, 2) : "";
  el("btn-verwijderen").classList.toggle("verborgen", !v);
  el("form-melding").textContent = "";
  el("checks-container").innerHTML = "";
  (v?.checks || []).forEach(voegCheckblokToe);
  if (!v) voegCheckblokToe();
}

el("btn-check-toevoegen").onclick = () => voegCheckblokToe();

function voegCheckblokToe(check) {
  const c = check || {};
  const verw = c.verwachting || {};
  const div = document.createElement("div");
  div.className = "checkblok";
  div.innerHTML = `
    <button type="button" class="knop knop-klein knop-stil check-verwijderen">verwijder</button>
    <div class="veldrij">
      <div class="veld groei">
        <label class="label">Naam van de check</label>
        <input class="ch-naam" placeholder="Bijv. Index bestaat" value="${escapeHtml(c.naam || "")}">
      </div>
      <div class="veld">
        <label class="label">Methode</label>
        <select class="ch-methode">
          ${["GET", "HEAD", "POST", "PUT"].map((m) => `<option ${c.methode === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="veld">
      <label class="label">API-pad in het cluster</label>
      <input class="ch-pad mono" placeholder="/mijn-index/_settings" value="${escapeHtml(c.pad || "")}">
    </div>
    <div class="veld">
      <label class="label">Request-body (JSON, optioneel)</label>
      <textarea class="ch-body mono" rows="2">${escapeHtml(c.body ? JSON.stringify(c.body, null, 2) : "")}</textarea>
    </div>
    <div class="veldrij">
      <div class="veld">
        <label class="label">Verwachting</label>
        <select class="ch-type">
          <option value="status" ${verw.type !== "json" ? "selected" : ""}>HTTP 2xx volstaat</option>
          <option value="json" ${verw.type === "json" ? "selected" : ""}>waarde in respons</option>
        </select>
      </div>
      <div class="veld groei ch-json">
        <label class="label">Pad in respons (puntnotatie)</label>
        <input class="ch-pad-json mono" placeholder="hits.total.value" value="${escapeHtml(verw.pad || "")}">
      </div>
      <div class="veld ch-json">
        <label class="label">Operator</label>
        <select class="ch-operator">
          ${["eq", "gte", "lte", "contains", "exists"].map((o) => `<option ${verw.operator === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="veld ch-json">
        <label class="label">Waarde</label>
        <input class="ch-waarde mono" value="${escapeHtml(verw.waarde ?? "")}">
      </div>
    </div>`;
  const typeSelect = div.querySelector(".ch-type");
  const toggleJson = () => div.querySelectorAll(".ch-json").forEach((n) =>
    n.classList.toggle("verborgen", typeSelect.value !== "json"));
  typeSelect.onchange = toggleJson;
  toggleJson();
  div.querySelector(".check-verwijderen").onclick = () => div.remove();
  el("checks-container").appendChild(div);
}

function leesChecks() {
  return [...document.querySelectorAll(".checkblok")].map((div) => {
    const pad = div.querySelector(".ch-pad").value.trim();
    if (!pad) return null;
    let body = div.querySelector(".ch-body").value.trim();
    if (body) {
      try { body = JSON.parse(body); }
      catch { throw new Error(`Body van check "${div.querySelector(".ch-naam").value}" is geen geldige JSON.`); }
    } else body = null;
    const type = div.querySelector(".ch-type").value;
    const waardeRuw = div.querySelector(".ch-waarde").value;
    const waarde = waardeRuw !== "" && !isNaN(waardeRuw) ? Number(waardeRuw) : waardeRuw;
    return {
      naam: div.querySelector(".ch-naam").value.trim() || pad,
      methode: div.querySelector(".ch-methode").value,
      pad,
      body,
      verwachting: type === "json"
        ? { type, pad: div.querySelector(".ch-pad-json").value.trim(), operator: div.querySelector(".ch-operator").value, waarde }
        : { type: "status" },
    };
  }).filter(Boolean);
}

function leesSetup() {
  const ruw = el("f-setup").value.trim();
  if (!ruw) return [];
  let stappen;
  try { stappen = JSON.parse(ruw); }
  catch { throw new Error("Setup-stappen zijn geen geldige JSON."); }
  if (!Array.isArray(stappen)) throw new Error("Setup-stappen moeten een JSON-array zijn.");
  return stappen;
}

el("vraagform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const melding = el("form-melding");
  melding.className = "melding";
  try {
    const vraag = {
      titel: el("f-titel").value.trim(),
      domein: el("f-domein").value,
      opdracht: el("f-opdracht").value.trim(),
      hint: el("f-hint").value.trim(),
      modelantwoord: el("f-model").value,
      checks: leesChecks(),
      setup: leesSetup(),
    };
    if (state.bewerkVraag) {
      await api.vraag("PUT", `/api/vragen/${state.bewerkVraag.id}`, vraag);
      melding.textContent = "Vraag bijgewerkt.";
    } else {
      await api.vraag("POST", "/api/vragen", vraag);
      melding.textContent = "Vraag opgeslagen.";
      vulFormulier(null);
    }
    await laadVragen();
  } catch (err) {
    melding.textContent = err.message;
    melding.className = "melding fout";
  }
});

el("btn-verwijderen").onclick = async () => {
  if (!state.bewerkVraag) return;
  if (!confirm(`Vraag "${state.bewerkVraag.titel}" verwijderen?`)) return;
  await api.vraag("DELETE", `/api/vragen/${state.bewerkVraag.id}`);
  if (state.actieveVraag?.id === state.bewerkVraag.id) {
    state.actieveVraag = null;
    el("vraagkaart").classList.add("verborgen");
    el("vraag-leeg").classList.remove("verborgen");
  }
  vulFormulier(null);
  await laadVragen();
};

/* ---------------- console ---------------- */

el("btn-uitvoeren").onclick = voerUit;
el("c-pad").addEventListener("keydown", (e) => { if (e.key === "Enter") voerUit(); });
document.querySelectorAll("[data-snel]").forEach((b) => {
  b.onclick = () => { el("c-pad").value = b.dataset.snel; el("c-methode").value = "GET"; el("c-body").value = ""; voerUit(); };
});

async function voerUit() {
  const status = el("c-status");
  const uit = el("c-respons");
  let body = el("c-body").value.trim();
  if (body) {
    try { body = JSON.parse(body); }
    catch { uit.textContent = "Request-body is geen geldige JSON."; return; }
  } else body = null;
  status.textContent = "…";
  try {
    const res = await api.vraag("POST", "/api/es", {
      methode: el("c-methode").value,
      pad: el("c-pad").value.trim(),
      body,
    });
    status.textContent = "HTTP " + res.status;
    status.className = "badge " + (res.status < 300 ? "" : "badge-fout");
    uit.textContent = typeof res.body === "string" ? (res.body || "(lege respons)") : JSON.stringify(res.body, null, 2);
  } catch (e) {
    status.textContent = "fout";
    status.className = "badge badge-fout";
    uit.textContent = e.message;
  }
}

/* ---------------- start ---------------- */

clusterStatus();
setInterval(clusterStatus, 30000);
laadVragen().then(() => vulFormulier(null));
