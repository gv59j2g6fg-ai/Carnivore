
/* Carnivore Tracker v19
   - Daily reset for drink units + today's log
   - Local-only storage
*/

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "carnivore_v19_state";

const defaultFoods = [
  { id: cryptoId(), name: "Ribeye", proteinPer100g: 24.0 },
  { id: cryptoId(), name: "Scotch fillet", proteinPer100g: 24.0 },
  { id: cryptoId(), name: "T-bone", proteinPer100g: 24.0 },
  { id: cryptoId(), name: "Minced beef", proteinPer100g: 20.0 },
  { id: cryptoId(), name: "Eggs (whole)", proteinPer100g: 13.0 },
  { id: cryptoId(), name: "Salmon", proteinPer100g: 20.0 },
];

function cryptoId(){
  // reasonably unique id without dependencies
  return (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2,10)));
}

function todayKey(){
  // local date key (YYYY-MM-DD)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function fmtTime(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}

function round1(n){ return Math.round(n*10)/10; }

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn(e);
    return null;
  }
}

function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureToday(state){
  const tk = todayKey();
  if(state.todayKey !== tk){
    state.todayKey = tk;
    state.todaysLog = [];        // daily reset
    state.drinkUnitsToday = 0;   // daily reset
  }
  return state;
}

function defaultState(){
  const tk = todayKey();
  return {
    version: 19,
    todayKey: tk,
    profile: {
      name: "",
      weightKg: "",
      proteinTargetG: "",
      proteinAuto: true,
    },
    foods: defaultFoods,
    todaysLog: [],
    drinkUnitsToday: 0,
    proteinTotalToday: 0,
  };
}

function computeProteinForFood(food, grams){
  const per100 = Number(food.proteinPer100g || 0);
  return (per100 * Number(grams || 0))/100;
}

function status(msg){
  $("statusText").textContent = msg;
}

function setTodayLabel(){
  const d = new Date();
  $("todayLabel").textContent = d.toLocaleDateString([], {weekday:"long", year:"numeric", month:"short", day:"numeric"});
}

function renderFoodsSelect(state){
  const sel = $("foodSelect");
  sel.innerHTML = "";
  state.foods.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.proteinPer100g}g/100g)`;
    sel.appendChild(opt);
  });
}

function renderFoodsManager(state){
  const wrap = $("foodsList");
  wrap.innerHTML = "";
  if(state.foods.length === 0){
    wrap.innerHTML = `<div class="small">No foods yet.</div>`;
    return;
  }
  state.foods.forEach(f => {
    const row = document.createElement("div");
    row.className = "foodRow";
    row.innerHTML = `
      <div style="flex:1; min-width:220px;">
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="meta">${round1(Number(f.proteinPer100g||0))} g protein per 100g</div>
      </div>
      <button class="iconBtn" data-act="edit" data-id="${f.id}">Edit</button>
      <button class="iconBtn" data-act="del" data-id="${f.id}">Delete</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      if(act === "del"){
        if(!confirm("Delete this food from the list?")) return;
        state.foods = state.foods.filter(x => x.id !== id);
        saveState(state);
        renderFoodsSelect(state);
        renderFoodsManager(state);
        status("Food deleted");
      }else if(act === "edit"){
        const f = state.foods.find(x => x.id === id);
        if(!f) return;
        const newName = prompt("Food name", f.name);
        if(newName === null) return;
        const newProt = prompt("Protein per 100g", String(f.proteinPer100g));
        if(newProt === null) return;
        f.name = newName.trim() || f.name;
        const pn = Number(newProt);
        if(Number.isFinite(pn) && pn >= 0) f.proteinPer100g = round1(pn);
        saveState(state);
        renderFoodsSelect(state);
        renderFoodsManager(state);
        status("Food updated");
      }
    });
  });
}

function renderTotals(state){
  const proteinTarget = Number(state.profile.proteinTargetG || 0);
  $("proteinTotal").textContent = round1(state.proteinTotalToday || 0);
  $("proteinTargetLabel").textContent = round1(proteinTarget);
  $("drinkUnitsTotal").textContent = round1(state.drinkUnitsToday || 0);
}

function renderLog(state){
  const body = $("logBody");
  body.innerHTML = "";
  if(state.todaysLog.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="small">No entries yet.</td>`;
    body.appendChild(tr);
    return;
  }

  state.todaysLog
    .slice()
    .sort((a,b)=>b.ts-a.ts)
    .forEach(entry => {
      const tr = document.createElement("tr");
      const amount = entry.type === "food" ? `${entry.grams} g` : `${round1(entry.units)} u`;
      const prot = entry.type === "food" ? round1(entry.proteinG) : "";
      tr.innerHTML = `
        <td>${fmtTime(entry.ts)}</td>
        <td><span class="pill">${entry.type === "food" ? "Food" : "Drink"}</span></td>
        <td>${escapeHtml(entry.item)}</td>
        <td class="right">${amount}</td>
        <td class="right">${prot}</td>
        <td class="right"><button class="iconBtn" data-del="${entry.id}">Remove</button></td>
      `;
      body.appendChild(tr);
    });

  body.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      state.todaysLog = state.todaysLog.filter(x => x.id !== id);
      recomputeDay(state);
      saveState(state);
      renderTotals(state);
      renderLog(state);
      status("Entry removed");
    });
  });
}

function recomputeDay(state){
  let protein = 0;
  let units = 0;
  state.todaysLog.forEach(e => {
    if(e.type === "food") protein += Number(e.proteinG || 0);
    if(e.type === "drink") units += Number(e.units || 0);
  });
  state.proteinTotalToday = round1(protein);
  state.drinkUnitsToday = round1(units);
}

function hydrateProfile(state){
  $("nameInput").value = state.profile.name || "";
  $("weightInput").value = state.profile.weightKg || "";
  $("proteinTarget").value = state.profile.proteinTargetG || "";
}

function computeProteinTargetFromWeight(weightKg){
  const w = Number(weightKg);
  if(!Number.isFinite(w) || w <= 0) return "";
  return String(Math.round(w * 2.0)); // 2.0 g/kg
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// Install prompt (PWA)
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").hidden = false;
});

$("installBtn").addEventListener("click", async () => {
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("installBtn").hidden = true;
});

// Main
(function init(){
  setTodayLabel();

  let state = loadState() || defaultState();
  state = ensureToday(state);

  // profile
  hydrateProfile(state);

  // if protein target empty, auto-calc
  if(!state.profile.proteinTargetG && state.profile.weightKg){
    state.profile.proteinTargetG = computeProteinTargetFromWeight(state.profile.weightKg);
    state.profile.proteinAuto = true;
  }

  // foods + log
  renderFoodsSelect(state);
  recomputeDay(state);
  renderTotals(state);
  renderLog(state);

  // weight change => auto protein target (unless user overrides)
  $("weightInput").addEventListener("input", () => {
    const w = $("weightInput").value;
    // only auto if they haven't manually typed a target (proteinAuto true)
    if(state.profile.proteinAuto){
      $("proteinTarget").value = computeProteinTargetFromWeight(w);
    }
  });

  $("proteinTarget").addEventListener("input", () => {
    // any manual edit disables auto
    state.profile.proteinAuto = false;
  });

  $("saveProfileBtn").addEventListener("click", () => {
    state.profile.name = $("nameInput").value.trim();
    state.profile.weightKg = $("weightInput").value;
    state.profile.proteinTargetG = $("proteinTarget").value;
    saveState(state);
    status("Saved");
  });

  $("resetTodayBtn").addEventListener("click", () => {
    if(!confirm("Reset today's log and drink units?")) return;
    state.todaysLog = [];
    state.drinkUnitsToday = 0;
    state.proteinTotalToday = 0;
    saveState(state);
    renderTotals(state);
    renderLog(state);
    status("Today's data reset");
  });

  // Add food entry
  $("addFoodBtn").addEventListener("click", () => {
    const foodId = $("foodSelect").value;
    const grams = Math.round(Number($("foodQty").value || 0));
    const food = state.foods.find(f => f.id === foodId);
    if(!food){
      alert("Pick a food first.");
      return;
    }
    if(!Number.isFinite(grams) || grams <= 0){
      alert("Enter grams (e.g. 200).");
      return;
    }
    const proteinG = round1(computeProteinForFood(food, grams));
    state.todaysLog.push({
      id: cryptoId(),
      ts: Date.now(),
      type: "food",
      item: food.name,
      grams,
      proteinG
    });
    recomputeDay(state);
    saveState(state);
    renderTotals(state);
    renderLog(state);
    status("Food added");
  });

  // Add drink entry (units)
  $("addDrinkBtn").addEventListener("click", () => {
    const name = $("drinkName").value.trim() || "Drink";
    const units = Number($("drinkUnits").value || 0);
    if(!Number.isFinite(units) || units <= 0){
      alert("Enter units (e.g. 1).");
      return;
    }
    state.todaysLog.push({
      id: cryptoId(),
      ts: Date.now(),
      type: "drink",
      item: name,
      units: round1(units)
    });
    $("drinkName").value = "";
    $("drinkUnits").value = "1";
    recomputeDay(state);
    saveState(state);
    renderTotals(state);
    renderLog(state);
    status("Drink added");
  });

  // Foods modal
  const modal = $("foodsModal");
  $("manageFoodsBtn").addEventListener("click", () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    renderFoodsManager(state);
  });
  $("closeFoodsBtn").addEventListener("click", () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden","true");
  });

  $("addFoodDefBtn").addEventListener("click", () => {
    const name = $("newFoodName").value.trim();
    const prot = Number($("newFoodProtein").value);
    if(!name){
      alert("Enter a food name.");
      return;
    }
    if(!Number.isFinite(prot) || prot < 0){
      alert("Enter protein per 100g (e.g. 24).");
      return;
    }
    state.foods.push({ id: cryptoId(), name, proteinPer100g: round1(prot) });
    $("newFoodName").value = "";
    $("newFoodProtein").value = "";
    saveState(state);
    renderFoodsSelect(state);
    renderFoodsManager(state);
    status("Food added");
  });

  // Service worker
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  // Save on visibility change (also ensures daily reset when returning)
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState === "visible"){
      state = ensureToday(state);
      recomputeDay(state);
      saveState(state);
      setTodayLabel();
      renderTotals(state);
      renderLog(state);
    }
  });

  status("Ready");
})();
