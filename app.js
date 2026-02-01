/* Carnivore Tracker — iPad keyboard-safe (no input-based rerenders)
   - Recalc happens on CHANGE/BLUR only
   - Rows are created once; we do not rebuild the entire table while typing
*/

const LS = {
  FOODS: "ct_foods_v1",
  DRINKS: "ct_drinks_v1",
  TARGETS: "ct_targets_v1",
  DAY_DRAFT: "ct_day_draft_v1",
  HISTORY: "ct_history_v1"
};

const $ = (id) => document.getElementById(id);

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const round0 = (n) => Math.round(Number(n) || 0);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const nameKey = (s) => (s || "").trim();
const nameSorter = (a, b) => nameKey(a?.name).localeCompare(nameKey(b?.name), undefined, { sensitivity: "base" });

function groupLetter(name) {
  const ch = (nameKey(name)[0] || "#").toUpperCase();
  return (ch >= "A" && ch <= "Z") ? ch : "#";
}


function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

const DRINK_UNITS = [
  { key: "ml", label: "mL", mlPer: 1 },
  { key: "schooner", label: "Schooner (425mL)", mlPer: 425 },
  { key: "bottle", label: "Bottle (375mL)", mlPer: 375 }
];

function drinkMlFromRow(r) {
  // Backward compatible: legacy rows used r.ml
  if (r && typeof r.ml !== "undefined" && typeof r.amount === "undefined") {
    return Number(r.ml) || 0;
  }
  const unitKey = (r && r.unit) ? r.unit : "ml";
  const amt = Number(r && r.amount) || 0;
  const u = DRINK_UNITS.find(x => x.key === unitKey) || DRINK_UNITS[0];
  return amt * (u.mlPer || 1);
}

function normalizeDrinkRow(r) {
  if (!r) return { drink: "", unit: "ml", amount: 0 };
  if (typeof r.amount === "undefined" && typeof r.ml !== "undefined") {
    return { drink: r.drink || "", unit: "ml", amount: Number(r.ml) || 0 };
  }
  return { drink: r.drink || "", unit: (r.unit || "ml"), amount: Number(r.amount) || 0 };
}


function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- Defaults ---------- */

function defaultFoods() {
  // per 100g
  return [
    { name: "Scotch fillet", kcal: 291, p: 19.8, f: 23.1, c: 0 },
    { name: "T-bone steak", kcal: 247, p: 20.5, f: 17.4, c: 0 },
    { name: "80/20 mince", kcal: 254, p: 17.2, f: 20.0, c: 0 },
    { name: "75/10/10/5 mince (organ)", kcal: 230, p: 18.0, f: 17.0, c: 0 },
    { name: "Clean sausage", kcal: 280, p: 16.0, f: 24.0, c: 1.0 },
    { name: "Lamb loin chops", kcal: 282, p: 18.0, f: 23.0, c: 0 },
    { name: "Beef burger patty", kcal: 250, p: 17.0, f: 20.0, c: 0 },
    { name: "Eggs", kcal: 143, p: 12.6, f: 9.5, c: 0.7 },
    { name: "Salmon (skin on)", kcal: 208, p: 20.0, f: 13.0, c: 0 },
    { name: "Butter", kcal: 717, p: 0.9, f: 81.0, c: 0.1 },
    { name: "Tallow", kcal: 902, p: 0, f: 100.0, c: 0 }
  ];
}

function defaultDrinks() {
  // per 100mL (approx)
  return [
    { name: "Better Beer", kcal: 35, c: 1.0 },
    { name: "Whisky (40%)", kcal: 222, c: 0 },
    { name: "Beer (regular)", kcal: 43, c: 3.5 }
  ];
}

function defaultTargets() {
  return { bw: 98, bwUnit: "kg", pgkg: 2.0, tcal: 2200, tcarb: 0 };
}

/* ---------- State ---------- */

let foods = loadJSON(LS.FOODS, null) || defaultFoods();
foods.sort(nameSorter);
let foodEditIndex = -1;
let drinks = loadJSON(LS.DRINKS, null) || defaultDrinks();
drinks.sort(nameSorter);
let drinkEditIndex = -1;
let targets = loadJSON(LS.TARGETS, null) || defaultTargets();

let dayDraft = loadJSON(LS.DAY_DRAFT, null) || {
  date: todayISO(),
  foodRows: [],
  drinkRows: []
};

// Open each new day as CLEAN (no yesterday rows)
if (!dayDraft.date || dayDraft.date !== todayISO()) {
  dayDraft = { date: todayISO(), foodRows: [], drinkRows: [] };
  saveJSON(LS.DAY_DRAFT, dayDraft);
} else {
  dayDraft.drinkRows = (dayDraft.drinkRows || []).map(normalizeDrinkRow);
}


let history = loadJSON(LS.HISTORY, null) || {}; // keyed by date

/* ---------- Init ---------- */

document.addEventListener("DOMContentLoaded", () => {
  // Register SW
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Date
  $("date").value = dayDraft.date || todayISO();
  $("date").addEventListener("change", () => {
    dayDraft.date = $("date").value || todayISO();
    persistDraft();
  });

  // Targets fill
  applyTargetsToUI();

  // Targets events (CHANGE/BLUR only)
  ["bw", "pgkg", "tcal", "tcarb"].forEach((id) => {
    const el = $(id);
    el.addEventListener("change", computeTargetsAndUpdateUI);
    el.addEventListener("blur", computeTargetsAndUpdateUI);
  });
  $("bwUnit").addEventListener("change", computeTargetsAndUpdateUI);

  $("saveTargets").addEventListener("click", () => {
    targets = readTargetsFromUI();
    saveJSON(LS.TARGETS, targets);
    computeTargetsAndUpdateUI();
    toast("Targets saved");
  });

  $("resetTargets").addEventListener("click", () => {
    targets = defaultTargets();
    saveJSON(LS.TARGETS, targets);
    applyTargetsToUI();
    computeTargetsAndUpdateUI();
    toast("Targets reset");
  });

  // Food rows
  $("addFoodRow").addEventListener("click", () => addFoodRow());
  $("clearRows").addEventListener("click", () => {
    dayDraft.foodRows = [];
    renderFoodRows();
    persistDraft();
    recalcTotals();
  });

  // Drink rows
  $("addDrinkRow").addEventListener("click", () => addDrinkRow());
  $("clearDrinks").addEventListener("click", () => {
    dayDraft.drinkRows = [];
    renderDrinkRows();
    persistDraft();
    recalcTotals();
  });

  // Save day
  $("saveDay").addEventListener("click", saveCurrentDay);

  // Weekly
  $("showWeekly").addEventListener("click", showWeeklyReport);

  // Export JSON
  $("exportJson").addEventListener("click", exportHistoryJSON);
  $("importJson").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    importFromFile(f);
  });

  // Manage foods
  $("addFoodBtn").addEventListener("click", addFoodToList);
  $("resetFoods").addEventListener("click", () => {
    foods = defaultFoods();
    saveJSON(LS.FOODS, foods);
    renderFoodManager();
    refreshFoodSelects();
    recalcTotals();
    toast("Foods reset");
  });

  // Manage drinks
  $("addDrinkBtn").addEventListener("click", addDrinkToList);
  $("resetDrinks").addEventListener("click", () => {
    drinks = defaultDrinks();
    saveJSON(LS.DRINKS, drinks);
    renderDrinkManager();
    refreshDrinkSelects();
    recalcTotals();
    toast("Drinks reset");
  });


  // Quick links
  $("jumpFoodManage").addEventListener("click", () => {
    document.getElementById("foodListManage")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("jumpDrinkManage").addEventListener("click", () => {
    document.getElementById("drinkListManage")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Show build tag
  const bt = document.getElementById("buildTag");
  if (bt) bt.textContent = BUILD;

  // Force refresh (clears caches + unregisters service worker)
  const fu = document.getElementById("forceUpdate");
  if (fu) fu.addEventListener("click", async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      toast("Refreshing…");
      setTimeout(() => location.reload(true), 350);
    } catch (e) {
      console.error(e);
      toast("Could not refresh (try clearing Website Data)");
    }
  });


  // Render initial UI
  renderFoodRows();
  renderDrinkRows();
  renderFoodManager();
  renderDrinkManager();
  renderHistory();
  computeTargetsAndUpdateUI();
  recalcTotals();
  installHint();

  // Online/offline pill
  const pill = $("offlinePill");
  const updatePill = () => {
    if (navigator.onLine) {
      pill.textContent = "Online";
      pill.style.background = "rgba(42,140,255,.18)";
      pill.style.borderColor = "rgba(42,140,255,.35)";
    } else {
      pill.textContent = "Offline";
      pill.style.background = "rgba(0,255,140,.12)";
      pill.style.borderColor = "rgba(0,255,140,.25)";
    }
  };
  window.addEventListener("online", updatePill);
  window.addEventListener("offline", updatePill);
  updatePill();

  // Ensure at least one row each for convenience
  if (!dayDraft.foodRows.length) addFoodRow();
  if (!dayDraft.drinkRows.length) addDrinkRow();
});

/* ---------- Draft + History ---------- */

function persistDraft() {
  saveJSON(LS.DAY_DRAFT, dayDraft);
}

function saveCurrentDay() {
  const d = $("date").value || todayISO();
  dayDraft.date = d;

  // Normalize rows (strip UI-only)
  const payload = {
    date: d,
    foodRows: dayDraft.foodRows.map(r => ({ food: r.food || "", grams: Number(r.grams) || 0 })),
    drinkRows: dayDraft.drinkRows.map(r => ({ drink: r.drink || "", ml: Number(r.ml) || 0 })),
    targets: readComputedTargets()
  };

  history[d] = payload;
  saveJSON(LS.HISTORY, history);
  persistDraft();
  renderHistory();
  toast("Day saved");
}

function renderHistory() {
  const wrap = $("historyList");
  wrap.innerHTML = "";

  const dates = Object.keys(history).sort((a,b) => b.localeCompare(a));
  if (!dates.length) {
    wrap.innerHTML = `<div class="muted">No saved days yet.</div>`;
    return;
  }

  dates.forEach(date => {
    const item = history[date];
    const sums = computeSumsForDay(item);

    const div = document.createElement("div");
    div.className = "hitem";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="d">${date}</div>
      <div class="s">${round0(sums.foodKcal)} kcal • P ${round0(sums.p)} • F ${round0(sums.f)} • C ${round0(sums.c)} • Alc ${round0(sums.alcKcal)} kcal</div>
    `;

    const actions = document.createElement("div");
    actions.className = "hactions";

    const loadBtn = document.createElement("button");
    loadBtn.className = "btn";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => {
      loadDay(date);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      delete history[date];
      saveJSON(LS.HISTORY, history);
      renderHistory();
      toast("Deleted");
    });

    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);

    div.appendChild(meta);
    div.appendChild(actions);
    wrap.appendChild(div);
  });
}

function loadDay(date) {
  const item = history[date];
  if (!item) return;

  dayDraft = {
    date: item.date,
    foodRows: (item.foodRows || []).map(r => ({ food: r.food || "", grams: Number(r.grams) || 0 })),
    drinkRows: (item.drinkRows || []).map(r => ({ drink: r.drink || "", ml: Number(r.ml) || 0 }))
  };

  $("date").value = dayDraft.date;
  renderFoodRows();
  renderDrinkRows();
  persistDraft();
  recalcTotals();
  toast("Loaded");
}

/* ---------- Foods & Drinks lists ---------- */


function renameFoodEverywhere(oldName, newName){
  if(!oldName || !newName || oldName===newName) return;
  dayDraft.foodRows.forEach(r => { if(r.food===oldName) r.food = newName; });
  Object.keys(history || {}).forEach(d => {
    const day = history[d];
    if(!day || !Array.isArray(day.foodRows)) return;
    day.foodRows.forEach(r => { if(r.food===oldName) r.food = newName; });
  });
}

function renameDrinkEverywhere(oldName, newName){
  if(!oldName || !newName || oldName===newName) return;
  dayDraft.drinkRows.forEach(r => { if(r.drink===oldName) r.drink = newName; });
  Object.keys(history || {}).forEach(d => {
    const day = history[d];
    if(!day || !Array.isArray(day.drinkRows)) return;
    day.drinkRows.forEach(r => { if(r.drink===oldName) r.drink = newName; });
  });
}

function addFoodToList() {
  const name = ($("newFoodName").value || "").trim();
  if (!name) return toast("Food name required");

  const kcal = Number($("newFoodKcal").value);
  const p = Number($("newFoodP").value);
  const f = Number($("newFoodF").value);
  const c = Number($("newFoodC").value);

  if (!isFinite(kcal) || !isFinite(p) || !isFinite(f) || !isFinite(c)) return toast("Enter valid numbers");

  // prevent duplicates by name (case-insensitive)
  if (foods.some(x => x.name.toLowerCase() === name.toLowerCase())) return toast("Food already exists");

  foods.push({ name, kcal, p, f, c });
  foods.sort(nameSorter);
  saveJSON(LS.FOODS, foods);

  $("newFoodName").value = "";
  $("newFoodKcal").value = "";
  $("newFoodP").value = "";
  $("newFoodF").value = "";
  $("newFoodC").value = "";

  renderFoodManager();
  refreshFoodSelects();
  recalcTotals();
  toast("Food added");
}


function renderFoodManager() {
  const wrap = $("foodListManage");
  wrap.innerHTML = "";

  let currentGroup = "";
  foods.forEach((f, idx) => {
    const g = groupLetter(f.name);
    if (g !== currentGroup) {
      currentGroup = g;
      const gh = document.createElement("div");
      gh.className = "groupHead";
      gh.textContent = currentGroup;
      wrap.appendChild(gh);
    }
    const div = document.createElement("div");
    div.className = "litem";

    const isEditing = (foodEditIndex === idx);

    const header = document.createElement("div");
    header.innerHTML = `
      <div>
        <div><b>${escapeHTML(f.name)}</b></div>
        <div class="muted">${round0(f.kcal)} kcal • P ${round1(f.p)} • F ${round1(f.f)} • C ${round1(f.c)} (per 100g)</div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "lactions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.textContent = isEditing ? "Cancel" : "Edit";
    editBtn.addEventListener("click", () => {
      foodEditIndex = isEditing ? -1 : idx;
      renderFoodManager();
    });

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const name = foods[idx].name;
      foods.splice(idx, 1);
      saveJSON(LS.FOODS, foods);

      // clear any selected rows that used this food
      dayDraft.foodRows.forEach(r => { if (r.food === name) r.food = ""; });
      Object.keys(history || {}).forEach(d => {
        const day = history[d];
        if (!day || !Array.isArray(day.foodRows)) return;
        day.foodRows.forEach(r => { if (r.food === name) r.food = ""; });
      });

      foodEditIndex = -1;
      renderFoodManager();
      refreshFoodSelects();
      renderFoodRows(); // safe: only called on delete/edit (not typing)
      persistDraft();
      recalcTotals();
      toast("Deleted");
    });

    actions.appendChild(editBtn);
    actions.appendChild(del);

    div.appendChild(header);
    div.appendChild(actions);

    if (isEditing) {
      const row = document.createElement("div");
      row.className = "editrow";
      row.innerHTML = `
        <input id="fe_name_${idx}" value="${escapeAttr(f.name)}" />
        <input id="fe_kcal_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(f.kcal))}" placeholder="kcal/100g" />
        <input id="fe_p_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(f.p))}" placeholder="P/100g" />
        <input id="fe_f_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(f.f))}" placeholder="F/100g" />
        <input id="fe_c_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(f.c))}" placeholder="C/100g" />
        <button id="fe_save_${idx}" class="btn primary">Save</button>
      `;
      div.appendChild(row);

      row.querySelector(`#fe_save_${idx}`).addEventListener("click", () => {
        const newName = (row.querySelector(`#fe_name_${idx}`).value || "").trim();
        const kcal = Number(row.querySelector(`#fe_kcal_${idx}`).value);
        const p = Number(row.querySelector(`#fe_p_${idx}`).value);
        const fat = Number(row.querySelector(`#fe_f_${idx}`).value);
        const c = Number(row.querySelector(`#fe_c_${idx}`).value);

        if (!newName) return toast("Name required");
        if (![kcal,p,fat,c].every(isFinite)) return toast("Enter valid numbers");

        // unique name check (case-insensitive) if changed
        const oldName = foods[idx].name;
        if (newName.toLowerCase() !== oldName.toLowerCase()) {
          if (foods.some((x,i) => i!==idx && x.name.toLowerCase()===newName.toLowerCase())) {
            return toast("That name already exists");
          }
        }

        foods[idx] = { name: newName, kcal, p, f: fat, c };
        foods.sort(nameSorter);
        saveJSON(LS.FOODS, foods);

        // update existing logs so your past entries show the new name
        renameFoodEverywhere(oldName, newName);
        saveJSON(LS.HISTORY, history);
        persistDraft();

        foodEditIndex = -1;
        renderFoodManager();
        refreshFoodSelects();
        renderFoodRows(); // reflect rename in dropdown rows
        renderHistory();
        recalcTotals();
        toast("Saved");
      });
    }

    wrap.appendChild(div);
  });
}

function addDrinkToList() {
  const name = ($("newDrinkName").value || "").trim();
  if (!name) return toast("Drink name required");

  const kcal = Number($("newDrinkKcal").value);
  const c = Number($("newDrinkC").value);

  if (!isFinite(kcal) || !isFinite(c)) return toast("Enter valid numbers");

  if (drinks.some(x => x.name.toLowerCase() === name.toLowerCase())) return toast("Drink already exists");

  drinks.push({ name, kcal, c });
  drinks.sort(nameSorter);
  saveJSON(LS.DRINKS, drinks);

  $("newDrinkName").value = "";
  $("newDrinkKcal").value = "";
  $("newDrinkC").value = "";

  renderDrinkManager();
  refreshDrinkSelects();
  recalcTotals();
  toast("Drink added");
}


function renderDrinkManager() {
  const wrap = $("drinkListManage");
  wrap.innerHTML = "";

  let currentGroup = "";
  drinks.forEach((d, idx) => {
    const g = groupLetter(d.name);
    if (g !== currentGroup) {
      currentGroup = g;
      const gh = document.createElement("div");
      gh.className = "groupHead";
      gh.textContent = currentGroup;
      wrap.appendChild(gh);
    }
    const div = document.createElement("div");
    div.className = "litem";

    const isEditing = (drinkEditIndex === idx);

    const header = document.createElement("div");
    header.innerHTML = `
      <div>
        <div><b>${escapeHTML(d.name)}</b></div>
        <div class="muted">${round0(d.kcal)} kcal • C ${round1(d.c)} (per 100mL)</div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "lactions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn";
    editBtn.textContent = isEditing ? "Cancel" : "Edit";
    editBtn.addEventListener("click", () => {
      drinkEditIndex = isEditing ? -1 : idx;
      renderDrinkManager();
    });

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      const name = drinks[idx].name;
      drinks.splice(idx, 1);
      saveJSON(LS.DRINKS, drinks);

      dayDraft.drinkRows.forEach(r => { if (r.drink === name) r.drink = ""; });
      Object.keys(history || {}).forEach(dt => {
        const day = history[dt];
        if (!day || !Array.isArray(day.drinkRows)) return;
        day.drinkRows.forEach(r => { if (r.drink === name) r.drink = ""; });
      });

      drinkEditIndex = -1;
      renderDrinkManager();
      refreshDrinkSelects();
      renderDrinkRows();
      persistDraft();
      recalcTotals();
      toast("Deleted");
    });

    actions.appendChild(editBtn);
    actions.appendChild(del);

    div.appendChild(header);
    div.appendChild(actions);

    if (isEditing) {
      const row = document.createElement("div");
      row.className = "editrow";
      row.innerHTML = `
        <input id="de_name_${idx}" value="${escapeAttr(d.name)}" />
        <input id="de_kcal_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(d.kcal))}" placeholder="kcal/100mL" />
        <input id="de_c_${idx}" type="number" inputmode="decimal" value="${escapeAttr(String(d.c))}" placeholder="carbs/100mL" />
        <button id="de_save_${idx}" class="btn primary">Save</button>
      `;
      div.appendChild(row);

      row.querySelector(`#de_save_${idx}`).addEventListener("click", () => {
        const newName = (row.querySelector(`#de_name_${idx}`).value || "").trim();
        const kcal = Number(row.querySelector(`#de_kcal_${idx}`).value);
        const c = Number(row.querySelector(`#de_c_${idx}`).value);

        if (!newName) return toast("Name required");
        if (![kcal,c].every(isFinite)) return toast("Enter valid numbers");

        const oldName = drinks[idx].name;
        if (newName.toLowerCase() !== oldName.toLowerCase()) {
          if (drinks.some((x,i)=> i!==idx && x.name.toLowerCase()===newName.toLowerCase())) {
            return toast("That name already exists");
          }
        }

        drinks[idx] = { name: newName, kcal, c };
        drinks.sort(nameSorter);
        saveJSON(LS.DRINKS, drinks);

        renameDrinkEverywhere(oldName, newName);
        saveJSON(LS.HISTORY, history);
        persistDraft();

        drinkEditIndex = -1;
        renderDrinkManager();
        refreshDrinkSelects();
        renderDrinkRows();
        renderHistory();
        recalcTotals();
        toast("Saved");
      });
    }

    wrap.appendChild(div);
  });
}

/* ---------- Rows rendering (no typing rerender) ---------- */

function addFoodRow() {
  dayDraft.foodRows.push({ food: foods[0]?.name || "", grams: 0 });
  renderFoodRows();        // safe (button click)
  persistDraft();
  recalcTotals();
}

function addDrinkRow() {
  dayDraft.drinkRows = (dayDraft.drinkRows || []).map(normalizeDrinkRow);
  dayDraft.drinkRows.push({ drink: drinks[0]?.name || "", unit: "ml", amount: 0 });
  renderDrinkRows();
  persistDraft();
  updateRowOutputs();
  recalcTotals();
}

function renderFoodRows() {
  const wrap = $("foodRows");
  wrap.innerHTML = "";

  dayDraft.foodRows.forEach((row, idx) => {
    const tr = document.createElement("div");
    tr.className = "trow";

    const sel = document.createElement("select");
    sel.dataset.kind = "food";
    sel.dataset.idx = String(idx);
    fillFoodSelect(sel, row.food);

    const grams = document.createElement("input");
    grams.type = "number";
    grams.inputMode = "decimal";
    grams.step = "1";
    grams.placeholder = "g";
    grams.value = row.grams ? String(row.grams) : "";
    grams.dataset.kind = "grams";
    grams.dataset.idx = String(idx);

    // IMPORTANT: change/blur only (keyboard-safe)
    grams.addEventListener("change", onFoodRowChanged);
    grams.addEventListener("blur", onFoodRowChanged);
    sel.addEventListener("change", onFoodRowChanged);

    const kcal = document.createElement("div"); kcal.className = "cell right"; kcal.id = `fk_${idx}`;
    const p = document.createElement("div"); p.className = "cell right"; p.id = `fp_${idx}`;
    const f = document.createElement("div"); f.className = "cell right"; f.id = `ff_${idx}`;
    const c = document.createElement("div"); c.className = "cell right"; c.id = `fc_${idx}`;

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.textContent = "✕";
    del.title = "Delete row";
    del.addEventListener("click", () => {
      dayDraft.foodRows.splice(idx, 1);
      renderFoodRows(); // safe: button click
      persistDraft();
      recalcTotals();
    });

    tr.appendChild(wrapCell(sel));
    tr.appendChild(wrapCell(grams));
    tr.appendChild(kcal);
    tr.appendChild(p);
    tr.appendChild(f);
    tr.appendChild(c);
    tr.appendChild(wrapCell(del));
    wrap.appendChild(tr);
  });

  updateRowOutputs();
}

function renderDrinkRows() {
  const wrap = $("drinkRows");
  wrap.innerHTML = "";

  dayDraft.drinkRows = (dayDraft.drinkRows || []).map(normalizeDrinkRow);

  dayDraft.drinkRows.forEach((row, idx) => {
    const tr = document.createElement("div");
    tr.className = "trow";
    tr.style.gridTemplateColumns = "1.6fr .9fr .9fr .7fr .7fr .35fr";

    const sel = document.createElement("select");
    sel.dataset.kind = "drink";
    sel.dataset.idx = String(idx);
    fillDrinkSelect(sel, row.drink);

    const unit = document.createElement("select");
    unit.dataset.kind = "unit";
    unit.dataset.idx = String(idx);
    DRINK_UNITS.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.key;
      opt.textContent = u.label;
      unit.appendChild(opt);
    });
    unit.value = row.unit || "ml";

    const amt = document.createElement("input");
    amt.type = "number";
    amt.inputMode = "decimal";
    // user request: step 1 (not 0.5) for schooner/bottle
    amt.step = unit.value === "ml" ? "10" : "1";
    amt.placeholder = unit.value === "ml" ? "mL" : "Qty";
    amt.value = row.amount ? String(row.amount) : "";
    amt.dataset.kind = "amount";
    amt.dataset.idx = String(idx);

    const kcal = document.createElement("div");
    kcal.className = "cell right";
    kcal.id = `dk_${idx}`;

    const carb = document.createElement("div");
    carb.className = "cell right";
    carb.id = `dc_${idx}`;

    const del = document.createElement("button");
    del.className = "btn icon";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      dayDraft.drinkRows.splice(idx, 1);
      renderDrinkRows();
      persistDraft();
      updateRowOutputs();
      recalcTotals();
    });

    const syncAmtUI = () => {
      amt.step = unit.value === "ml" ? "10" : "1";
      amt.placeholder = unit.value === "ml" ? "mL" : "Qty";
    };

    sel.addEventListener("change", onDrinkRowChanged);
    unit.addEventListener("change", () => { syncAmtUI(); onDrinkRowChanged({ target: unit }); });
    amt.addEventListener("change", onDrinkRowChanged);
    amt.addEventListener("blur", onDrinkRowChanged);

    tr.appendChild(wrapCell(sel));
    tr.appendChild(wrapCell(unit));
    tr.appendChild(wrapCell(amt));
    tr.appendChild(kcal);
    tr.appendChild(carb);
    tr.appendChild(wrapCell(del));

    wrap.appendChild(tr);
  });

  updateRowOutputs();
}


function wrapCell(el) {
  const d = document.createElement("div");
  d.className = "cell";
  d.appendChild(el);
  return d;
}

function fillFoodSelect(sel, selectedName) {
  sel.innerHTML = "";
  foods.forEach(f => {
    const o = document.createElement("option");
    o.value = f.name;
    o.textContent = f.name;
    sel.appendChild(o);
  });
  if (selectedName && foods.some(f => f.name === selectedName)) {
    sel.value = selectedName;
  }
}

function fillDrinkSelect(sel, selectedName) {
  sel.innerHTML = "";
  drinks.forEach(d => {
    const o = document.createElement("option");
    o.value = d.name;
    o.textContent = d.name;
    sel.appendChild(o);
  });
  if (selectedName && drinks.some(d => d.name === selectedName)) {
    sel.value = selectedName;
  }
}

function refreshFoodSelects() {
  // update existing selects without rerendering while typing
  document.querySelectorAll('select[data-kind="food"]').forEach(sel => {
    const idx = Number(sel.dataset.idx);
    const cur = dayDraft.foodRows[idx]?.food || "";
    fillFoodSelect(sel, cur);
  });
}

function refreshDrinkSelects() {
  document.querySelectorAll('select[data-kind="drink"]').forEach(sel => {
    const idx = Number(sel.dataset.idx);
    const cur = dayDraft.drinkRows[idx]?.drink || "";
    fillDrinkSelect(sel, cur);
  });
}

function onFoodRowChanged(e) {
  const idx = Number(e.target.dataset.idx);
  const row = dayDraft.foodRows[idx];
  if (!row) return;

  const parent = e.target;

  // Read current values from DOM row (safe)
  const tr = parent.closest(".trow");
  const sel = tr.querySelector('select[data-kind="food"]');
  const grams = tr.querySelector('input[data-kind="grams"]');

  row.food = sel?.value || "";
  row.grams = Number(grams?.value) || 0;

  persistDraft();
  updateRowOutputs();
  recalcTotals();
}

function onDrinkRowChanged(e) {
  const idx = Number(e.target.dataset.idx);
  const row = dayDraft.drinkRows[idx];
  if (!row) return;

  const tr = e.target.closest(".trow");
  const sel = tr.querySelector('select[data-kind="drink"]');
  const unit = tr.querySelector('select[data-kind="unit"]');
  const amt = tr.querySelector('input[data-kind="amount"]');

  row.drink = sel?.value || "";
  row.unit = unit?.value || "ml";
  row.amount = Number(amt?.value) || 0;

  persistDraft();
  updateRowOutputs();
  recalcTotals();
}

function updateRowOutputs() {
  // update only numbers (no rerender)
  dayDraft.foodRows.forEach((r, i) => {
    const f = foods.find(x => x.name === r.food);
    const g = Number(r.grams) || 0;
    const mult = g / 100;

    const kcal = f ? f.kcal * mult : 0;
    const p = f ? f.p * mult : 0;
    const fat = f ? f.f * mult : 0;
    const c = f ? f.c * mult : 0;

    setText(`fk_${i}`, round0(kcal));
    setText(`fp_${i}`, round1(p));
    setText(`ff_${i}`, round1(fat));
    setText(`fc_${i}`, round1(c));
  });

  dayDraft.drinkRows.forEach((r, i) => {
    const d = drinks.find(x => x.name === r.drink);
    const ml = Number(r.ml) || 0;
    const mult = ml / 100;

    const kcal = d ? d.kcal * mult : 0;
    const c = d ? d.c * mult : 0;

    setText(`dk_${i}`, round0(kcal));
    setText(`dc_${i}`, round1(c));
  });
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

/* ---------- Totals + Progress ---------- */

function computeSumsForDay(day) {
  const sums = { foodKcal: 0, p: 0, f: 0, c: 0, alcKcal: 0, alcC: 0 };

  (day.foodRows || []).forEach(r => {
    const f = foods.find(x => x.name === r.food);
    const g = Number(r.grams) || 0;
    const mult = g / 100;
    if (!f) return;
    sums.foodKcal += f.kcal * mult;
    sums.p += f.p * mult;
    sums.f += f.f * mult;
    sums.c += f.c * mult;
  });

  (day.drinkRows || []).map(normalizeDrinkRow).forEach(r => {
    const d = drinks.find(x => x.name === r.drink);
    const ml = drinkMlFromRow(r);
    const mult = ml / 100;
    if (!d) return;
    sums.alcKcal += d.kcal * mult;
    sums.alcC += d.c * mult;
  });

  return sums;
}

function recalcTotals() {
  const sums = computeSumsForDay(dayDraft);

  $("tFoodKcal").textContent = String(round0(sums.foodKcal));
  $("tP").textContent = String(round0(sums.p));
  $("tF").textContent = String(round0(sums.f));
  $("tC").textContent = String(round0(sums.c));
  $("tAlcKcal").textContent = String(round0(sums.alcKcal));
  $("tAlcC").textContent = String(round0(sums.alcC));

  // progress bars use computed targets
  const ct = readComputedTargets();
  const calPct = ct.kcal > 0 ? (sums.foodKcal / ct.kcal) * 100 : 0;
  const pPct = ct.p > 0 ? (sums.p / ct.p) * 100 : 0;
  const fPct = ct.f > 0 ? (sums.f / ct.f) * 100 : 0;
  const cPct = ct.c > 0 ? (sums.c / ct.c) * 100 : 0;

  setBar("pCal", "pCalTxt", calPct);
  setBar("pP", "pPTxt", pPct);
  setBar("pF", "pFTxt", fPct);
  setBar("pC", "pCTxt", cPct);
}

function setBar(barId, txtId, pct) {
  const p = clamp(pct, 0, 200); // allow over 100
  $(barId).style.width = `${clamp(p, 0, 100)}%`;
  $(txtId).textContent = `${round0(p)}%`;
}

/* ---------- Targets ---------- */

function applyTargetsToUI() {
  $("bw").value = String(targets.bw ?? 98);
  $("bwUnit").value = targets.bwUnit ?? "kg";
  $("pgkg").value = String(targets.pgkg ?? 2.0);
  $("tcal").value = String(targets.tcal ?? 2200);
  $("tcarb").value = String(targets.tcarb ?? 0);
}

function readTargetsFromUI() {
  return {
    bw: Number($("bw").value) || 0,
    bwUnit: $("bwUnit").value || "kg",
    pgkg: Number($("pgkg").value) || 0,
    tcal: Number($("tcal").value) || 0,
    tcarb: Number($("tcarb").value) || 0
  };
}

let computedTargets = { kcal: 0, p: 0, f: 0, c: 0 };

function computeTargetsAndUpdateUI() {
  targets = readTargetsFromUI();

  // Convert to kg if lb
  const bwKg = targets.bwUnit === "lb" ? targets.bw * 0.45359237 : targets.bw;

  const p = bwKg * (Number(targets.pgkg) || 0);
  const c = Number(targets.tcarb) || 0;
  const kcal = Number(targets.tcal) || 0;

  // calories left for fat after protein + carbs
  const proteinKcal = p * 4;
  const carbKcal = c * 4;
  const fatKcal = Math.max(0, kcal - proteinKcal - carbKcal);
  const f = fatKcal / 9;

  computedTargets = { kcal: round0(kcal), p: round0(p), f: round0(f), c: round0(c) };

  $("ctKcal").textContent = String(computedTargets.kcal);
  $("ctP").textContent = String(computedTargets.p);
  $("ctF").textContent = String(computedTargets.f);
  $("ctC").textContent = String(computedTargets.c);

  // don’t save while typing, only on explicit Save Targets
  recalcTotals();
}

function readComputedTargets() {
  return computedTargets;
}

/* ---------- Weekly report ---------- */

function showWeeklyReport() {
  const dates = Object.keys(history).sort(); // ascending
  if (!dates.length) return toast("No history yet");

  // last 7 saved days
  const last = dates.slice(-7);
  let totalKcal = 0, totalP = 0, totalF = 0, totalC = 0, totalAlc = 0;

  last.forEach(d => {
    const sums = computeSumsForDay(history[d]);
    totalKcal += sums.foodKcal;
    totalP += sums.p;
    totalF += sums.f;
    totalC += sums.c;
    totalAlc += sums.alcKcal;
  });

  const n = last.length;
  alert(
    `Weekly (last ${n} saved days)\n\n` +
    `Avg Food kcal: ${round0(totalKcal/n)}\n` +
    `Avg Protein: ${round0(totalP/n)} g\n` +
    `Avg Fat: ${round0(totalF/n)} g\n` +
    `Avg Carbs: ${round0(totalC/n)} g\n` +
    `Avg Alcohol kcal: ${round0(totalAlc/n)}\n\n` +
    `Days included:\n${last.join(", ")}`
  );
}

/* ---------- Export ---------- */

function exportHistoryJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    targets,
    foods,
    drinks,
    history
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "carnivore-tracker-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importFromFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(String(reader.result||""));
      const ok = confirm("Import will REPLACE your current data on this device. Continue?");
      if(!ok) return;

      // Accept either full export object or a raw history object
      let nextTargets = null, nextFoods = null, nextDrinks = null, nextHistory = null;

      if(parsed && typeof parsed === "object" && !Array.isArray(parsed)){
        if(parsed.targets) nextTargets = parsed.targets;
        if(Array.isArray(parsed.foods)) nextFoods = parsed.foods;
        if(Array.isArray(parsed.drinks)) nextDrinks = parsed.drinks;
        if(parsed.history && typeof parsed.history === "object") nextHistory = parsed.history;

        // If it looks like a raw history map (dates -> payload), accept it
        const keys = Object.keys(parsed);
        const looksLikeHistoryMap = keys.some(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
        if(!nextHistory && looksLikeHistoryMap) nextHistory = parsed;
      }

      // Minimal validation + fallbacks
      if(nextFoods) foods = nextFoods;
      if(nextDrinks) drinks = nextDrinks;
      if(nextTargets) targets = nextTargets;
      if(nextHistory) history = nextHistory;

      // Persist
      saveJSON(LS.FOODS, foods);
      saveJSON(LS.DRINKS, drinks);
      saveJSON(LS.TARGETS, targets);
      saveJSON(LS.HISTORY, history);

      // Refresh UI
      foodEditIndex = -1; drinkEditIndex = -1;
      renderFoodManager();
      renderDrinkManager();
      refreshFoodSelects();
      refreshDrinkSelects();
      renderFoodRows();
      renderDrinkRows();
      renderHistory();
      recalcTotals();
      toast("Import complete");
    } catch(e){
      console.error(e);
      toast("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

/* ---------- Helpers ---------- */

function toast(msg) {
  // simple toast via the installHint area
  const el = $("installHint");
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.opacity = "0.8"; }, 1600);
}

function installHint() {
  const el = $("installHint");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone) {
    el.textContent = "Installed: runs like an app.";
  } else {
    el.textContent = "Tip: Use Share → Add to Home Screen (Safari) to install.";
  }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

function escapeAttr(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
