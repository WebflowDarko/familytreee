/* =========================
   CLOUDINARY CONFIG
========================= */
const CLOUD_NAME    = "da95wtjhp";
const UPLOAD_PRESET = "wizard_unsigned";
const ROOT_FOLDER   = "wizard_uploads";

/* =========================
   SHEETS ENDPOINT
========================= */
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbwtGRjTuwN93-XqNWTGAdcQYgfl8VEeU4SN4uX4YN38NR-jEX33-Fj8u0Zg4ghVW7H0/exec";

/* =========================
   GLOBAL STATE
========================= */
window.wizardState = window.wizardState || {};
window.wizardState.sessionId  = window.wizardState.sessionId || (crypto?.randomUUID?.() || String(Date.now()));
window.wizardState.uploadUrls = window.wizardState.uploadUrls || {};
window.wizardState.clientName = window.wizardState.clientName || "";

/* =========================
   HELPERS: CLIENT NAME SYNC
========================= */
function readClientNameFromDOM() {
  const el =
    document.getElementById("client-name") ||
    document.querySelector('input[name="client_name"]') ||
    document.querySelector('input[name="clientName"]') ||
    document.querySelector('input[name="name"]');

  const val = (el?.value || "").trim();
  return val;
}

function syncClientNameToState() {
  const v = readClientNameFromDOM();
  if (v) window.wizardState.clientName = v;
}

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t) return;
  if (
    t.id === "client-name" ||
    t.name === "client_name" ||
    t.name === "clientName" ||
    t.name === "name"
  ) {
    syncClientNameToState();
  }
});

/* =========================
   CLOUDINARY HELPER
========================= */
async function uploadServicePhoto(file, serviceId, sessionId) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("folder", `${ROOT_FOLDER}/${sessionId}/${serviceId}`);
  fd.append("tags", `wizard,service:${serviceId},session:${sessionId}`);
  fd.append("context", `service=${serviceId}|session=${sessionId}`);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: fd
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Cloudinary upload failed: " + t);
  }
  return res.json();
}

/* =========================
   SHEET HELPERS
========================= */
async function sendLineToSheet(opts) {
  const {
    serviceName = "",
    itemId,
    qty = 1,
    clientName = "Test User",
    description = ""
  } = opts || {};

  if (!itemId) {
    console.warn("[Sheet] Missing itemId, skip.");
    return false;
  }

  const params = new URLSearchParams();
  params.append("clientName", clientName);
  params.append("sessionId", window.wizardState?.sessionId || "wizard-session");
  params.append("serviceName", serviceName);
  params.append("carpetItemId", itemId);
  params.append("carpetQty", String(qty));
  params.append("description", description);

  const res = await fetch(SHEET_ENDPOINT, {
    method: "POST",
    body: params
  });

  const text = await res.text().catch(() => "");
  console.log("[Sheet] Response", { status: res.status, body: text });

  return res.ok;
}

/* =========================
   DESCRIPTION BUILDERS
========================= */
function buildSubDescriptionForParent(parentItemId) {
  const subs = document.querySelectorAll(
    `input[type="checkbox"][data-parent-item="${parentItemId}"]:checked`
  );

  const parts = [];
  subs.forEach(sub => {
    const label =
      (sub.dataset.desc || "").trim() ||
      (sub.closest("label")?.innerText || "").trim();

    const key = (sub.dataset.subKey || "").trim();
    let extra = "";

    if (key) {
      const input = document.querySelector(
        `input[data-parent-item="${parentItemId}"][data-sub-key="${key}"], textarea[data-parent-item="${parentItemId}"][data-sub-key="${key}"], select[data-parent-item="${parentItemId}"][data-sub-key="${key}"]`
      );

      if (input) {
        const v = (input.value || "").trim();
        if (v) {
          const lbl = (input.dataset.field || input.dataset.label || input.placeholder || "").trim();
          extra = lbl ? ` (${lbl}: ${v})` : ` (${v})`;
        }
      }
    }

    parts.push(label + extra);
  });

  return parts.join(", ");
}

function buildInputsDescriptionForParent(parentItemId) {
  const nodes = Array.from(
    document.querySelectorAll(`[data-parent-item="${parentItemId}"]`)
  );

  const inputs = nodes.filter(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el.type || "").toLowerCase();
      return t !== "checkbox" && t !== "radio";
    }
    return tag === "textarea" || tag === "select";
  });

  const parts = [];
  inputs.forEach(el => {
    const val = (el.value || "").trim();
    if (!val) return;

    const label = (el.dataset.field || el.placeholder || el.name || "Field").trim();
    parts.push(`${label}: ${val}`);
  });

  return parts.join(", ");
}

/* =========================
   SQFT HELPERS
========================= */
function getHomeSqft() {
  if (window.wizardState && window.wizardState.homeSqft) {
    const v = Number(window.wizardState.homeSqft);
    if (!isNaN(v) && v > 0) return v;
  }

  const el =
    document.getElementById("home-sqft") ||
    document.getElementById("carpet-sqft") ||
    document.querySelector('input[name="home_sqft"]');

  if (!el) return NaN;

  const raw = (el.value || "").trim();
  const num = Number(raw);

  if (!isNaN(num) && num > 0) {
    window.wizardState.homeSqft = num;
    return num;
  }
  return NaN;
}

function getBulbItemIdBySqft(sqft) {
  if (sqft <= 1000) return "145-25";
  if (sqft <= 2000) return "145-26";
  if (sqft <= 3000) return "145-27";
  return "145-28";
}

function getCheckedValue(name) {
  const r = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
  return (r?.value || "").trim();
}

function getInsidePaintSchemeDescription() {
  const r = document.querySelector('input[name="inside_paint_color_scheme"]:checked');
  if (!r) return "";
  return (r.dataset.desc || r.value || "").trim();
}

/* =========================
   COLLECT ALL LINE ITEMS
========================= */
function collectAllLineItems() {
  const items = [];

  // 1) CARPET (radio + sqft)
  const carpetRadio = document.querySelector('input[name="carpet_style"]:checked');
  const carpetSqftEl = document.getElementById("carpet-sqft");

  if (carpetRadio && carpetSqftEl) {
    const carpetItemId =
      carpetRadio.getAttribute("data-item-id") || carpetRadio.value || "";
    const qtyNum = Number((carpetSqftEl.value || "").trim());

    if (carpetItemId && !isNaN(qtyNum) && qtyNum > 0) {
      items.push({ serviceName: "Carpet", itemId: carpetItemId, qty: qtyNum });
    }
  }

  // 2) BULB UPDATE
  const bulbAnswer = document.querySelector('input[name="bulb_update"]:checked');
  if (bulbAnswer && bulbAnswer.value === "yes") {
    const sqft = getHomeSqft();
    if (!isNaN(sqft) && sqft > 0) {
      const bulbItemId = getBulbItemIdBySqft(sqft);
      if (bulbItemId) items.push({ serviceName: "Bulb Update", itemId: bulbItemId, qty: 1 });
    }
  }

  // 4) INSIDE PAINT (110-1, 110-2) + scheme description
  const insidePaintSqftEl =
    document.getElementById("inside-paint-sqft") ||
    document.querySelector('input[name="inside_paint_sqft"]');

  const insidePaintQty = insidePaintSqftEl
    ? Number((insidePaintSqftEl.value || "").trim())
    : NaN;

  const insidePaintChecks = document.querySelectorAll(
    'input[type="checkbox"][name="inside_paint_scope"]:checked'
  );

  const schemeDescription = getInsidePaintSchemeDescription();

  insidePaintChecks.forEach(cb => {
    const itemId = (cb.dataset.itemId || cb.getAttribute("data-item-id") || "").trim();
    if (!itemId) return;

    if (!isNaN(insidePaintQty) && insidePaintQty > 0) {
      items.push({
        serviceName: "Inside Paint",
        itemId,
        qty: insidePaintQty,
        description: schemeDescription
      });
    }
  });

  // 5) INSIDE PAINT – CABINETS (110-3)
  const cabinetAnswer = document.querySelector('input[name="inside_paint_cabinets"]:checked');
  const cabinetDoorsEl =
    document.getElementById("cabinet-doors") ||
    document.querySelector('input[name="cabinet_doors"]');

  if (cabinetAnswer && (cabinetAnswer.value || "").trim().toLowerCase() === "yes") {
    const doorsQty = cabinetDoorsEl ? Number((cabinetDoorsEl.value || "").trim()) : NaN;
    if (!isNaN(doorsQty) && doorsQty > 0) {
      items.push({ serviceName: "Inside Paint - Cabinets", itemId: "110-3", qty: doorsQty });
    }
  }

  // FAUCET / TOILET - TOILET QTY (130-1)
  const toiletQtyEl =
    document.getElementById("toilet-qty") ||
    document.querySelector('input[name="toilet_qty"]');

  if (toiletQtyEl) {
    const qty = Number((toiletQtyEl.value || "").trim());
    if (!isNaN(qty) && qty > 0) {
      items.push({ serviceName: "Faucet / Toilet - Toilet Replacement", itemId: "130-1", qty });
    }
  }

  // Kitchen sink fixture (130-2/3/4)
  const kitchenPick = document.querySelector('input[name="kitchen_sink_fixture"]:checked');
  if (kitchenPick) {
    const itemId = (kitchenPick.dataset.itemId || kitchenPick.value || "").trim();
    if (itemId) items.push({ serviceName: "Kitchen Sink Fixture Replacement", itemId, qty: 1 });
  }

  // Bathroom vanity faucet (130-5/6/7) × bathroom count
  const vanityPick = document.querySelector('input[name="bathroom_vanity_faucet"]:checked');

  const bathroomCountEl =
    document.getElementById("bathroom-count") ||
    document.querySelector('input[name="bathroom_count"]');

  const bathroomQty = bathroomCountEl ? Number((bathroomCountEl.value || "").trim()) : NaN;

  if (vanityPick) {
    const itemId = (vanityPick.dataset.itemId || vanityPick.value || "").trim();
    if (itemId && !isNaN(bathroomQty) && bathroomQty > 0) {
      items.push({ serviceName: "Bathroom Vanity Sink Faucet Replacement", itemId, qty: bathroomQty });
    }
  }

  // DOOR HARDWARE
  const doorFinish = document.querySelector('input[name="door_hardware_finish"]:checked');
  if (doorFinish) {
    const qtyNoLockEl   = document.querySelector('input[data-qty="no_lock"]');
    const qtyWithLockEl = document.querySelector('input[data-qty="with_lock"]');

    const qtyNoLock   = qtyNoLockEl ? Number((qtyNoLockEl.value || "").trim()) : 0;
    const qtyWithLock = qtyWithLockEl ? Number((qtyWithLockEl.value || "").trim()) : 0;

    const itemNoLock   = (doorFinish.dataset.itemNoLock || "").trim();
    const itemWithLock = (doorFinish.dataset.itemWithLock || "").trim();

    if (itemNoLock && !isNaN(qtyNoLock) && qtyNoLock > 0) {
      items.push({ serviceName: "Door Hardware", itemId: itemNoLock, qty: qtyNoLock });
    }
    if (itemWithLock && !isNaN(qtyWithLock) && qtyWithLock > 0) {
      items.push({ serviceName: "Door Hardware", itemId: itemWithLock, qty: qtyWithLock });
    }
  }

  // EXTERIOR PAINT
  const exteriorYesNo = document.querySelector('input[name="home_exterior"]:checked');
  if (exteriorYesNo && (exteriorYesNo.value || "").trim().toLowerCase() === "yes") {
    const story = document.querySelector('input[name="home_exterior_story"]:checked');
    const storyVal = (story?.value || "").trim().toLowerCase();

    let itemId = "";
    if (storyVal.includes("single")) itemId = "110-4";
    else if (storyVal.includes("two")) itemId = "110-5";
    if (itemId) items.push({ serviceName: "Exterior Paint", itemId, qty: 1 });
  }

  // CABINET HARDWARE
  const cabinetReplace = document.querySelector('input[name="cabinet_replace"]:checked');
  const cabinetYes = cabinetReplace && (cabinetReplace.value || "").trim().toLowerCase() === "yes";

  if (cabinetYes) {
    const cabinetFinish = getCheckedValue("cabinet_finish");

    const knobsEl = document.getElementById("cabinet-knobs") || document.querySelector('input[name="cabinet_knobs"]');
    const pullsEl = document.getElementById("cabinet-pulls") || document.querySelector('input[name="cabinet_pulls"]');

    const knobsQty = knobsEl ? Number((knobsEl.value || "").trim()) : NaN;
    const pullsQty = pullsEl ? Number((pullsEl.value || "").trim()) : NaN;

    if (!isNaN(knobsQty) && knobsQty > 0) {
      items.push({ serviceName: "Cabinet Knobs", itemId: "135-7", qty: knobsQty, description: cabinetFinish });
    }
    if (!isNaN(pullsQty) && pullsQty > 0) {
      items.push({ serviceName: "Cabinet Pulls", itemId: "135-8", qty: pullsQty, description: cabinetFinish });
    }
  }

  // LANDSCAPING
  document.querySelectorAll('input[name="landscaping_services"]:checked').forEach(main => {
    const itemId = (main.dataset.itemId || "").trim();
    if (!itemId) return;
    const serviceName = (main.dataset.serviceName || "").trim() || "Landscaping";
    const inputsDesc = buildInputsDescriptionForParent(itemId);
    items.push({ serviceName, itemId, qty: 1, description: inputsDesc });
  });

  // CLEANING
  const cleaningMain = document.querySelectorAll('input[name="cleaning_services"]:checked');
  function getHomeSqftValue() {
    const el = document.getElementById("home-sqft");
    const num = Number((el?.value || "").trim());
    return (!isNaN(num) && num > 0) ? num : NaN;
  }

  cleaningMain.forEach(main => {
    const itemId = (main.dataset.itemId || "").trim();
    if (!itemId) return;

    const serviceName = (main.dataset.serviceName || "").trim() || "Cleaning";
    let qty = 1;
    let description = "";

    if (itemId === "120-1" || itemId === "120-2") {
      const sqft = getHomeSqftValue();
      if (isNaN(sqft)) return;
      qty = sqft;
    } else {
      const subDesc = buildSubDescriptionForParent(itemId);
      const inputsDesc = buildInputsDescriptionForParent(itemId);
      if (subDesc && inputsDesc) description = `${subDesc}, ${inputsDesc}`;
      else if (subDesc) description = subDesc;
      else if (inputsDesc) description = inputsDesc;
    }

    items.push({ serviceName, itemId, qty, description });
  });

  // HANDYMAN
  document.querySelectorAll('input[name="handyman_services"]:checked').forEach(main => {
    const itemId = (main.dataset.itemId || main.getAttribute("data-item-id") || "").trim();
    if (!itemId) return;

    const serviceName = (main.dataset.serviceName || "").trim() || "Handy-Man Service";
    const subDesc = buildSubDescriptionForParent(itemId);
    const inputsDesc = buildInputsDescriptionForParent(itemId);

    let description = "";
    if (subDesc && inputsDesc) description = `${subDesc}, ${inputsDesc}`;
    else if (subDesc) description = subDesc;
    else if (inputsDesc) description = inputsDesc;

    items.push({ serviceName, itemId, qty: 1, description });
  });

  const handymanOtherEl = document.getElementById("handyman-other");
  const handymanOtherVal = (handymanOtherEl?.value || "").trim();
  if (handymanOtherVal) {
    items.push({ serviceName: "Handy-Man - Other", itemId: "125-7", qty: 1, description: handymanOtherVal });
  }

  // LIGHT / FAN FIXTURES catalog
  document.querySelectorAll(".fixture-checkbox:checked").forEach(cb => {
    const itemId = cb.dataset.itemId;
    const qtyNum = Number(cb.dataset.qty || "1");
    if (!itemId) return;

    items.push({
      serviceName: "Light / Fan Fixtures",
      itemId,
      qty: (!isNaN(qtyNum) && qtyNum > 0) ? qtyNum : 1
    });
  });

  console.log("[Collect] Final items:", items);
  return items;
}

/* =========================
   MAIN INIT (ONE DOMContentLoaded)
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("#wizard");
  if (!root) return;

  // sync initial values
  syncClientNameToState();

  // Keep sqft in wizardState if present
  const sqftInput =
    document.getElementById("home-sqft") ||
    document.getElementById("carpet-sqft") ||
    document.querySelector('input[name="home_sqft"]');

  if (sqftInput) {
    const syncSqft = () => {
      const num = Number((sqftInput.value || "").trim());
      if (!isNaN(num) && num > 0) window.wizardState.homeSqft = num;
    };
    syncSqft();
    sqftInput.addEventListener("input", syncSqft);
  }

  /* =========================
     SEND ALL TO SHEET (FINAL)
  ========================= */
  const finalBtn = document.getElementById("sheet-submit-all");
  if (!finalBtn) {
    console.warn("[Sheet] #sheet-submit-all not found");
    return;
  }

  let alreadySending = false;

  finalBtn.addEventListener("click", async () => {
    if (alreadySending) return;

    syncClientNameToState();

    const lines = collectAllLineItems();
    if (!lines.length) {
      alert("Nothing to submit.");
      return;
    }

    const clientName = (window.wizardState?.clientName || "").trim() || "Test User";

    alreadySending = true;
    const oldText = finalBtn.textContent;
    finalBtn.disabled = true;
    finalBtn.textContent = "Sending...";

    try {
      for (const line of lines) {
        const ok = await sendLineToSheet({ ...line, clientName });
        if (!ok) console.warn("[Sheet] One line failed:", line);
      }

      console.log("[Sheet] All sent OK", { sessionId: window.wizardState.sessionId });
      alert("✅ Sent!");

      // If you want each submit to create a new Order sheet, uncomment:
      // window.wizardState.sessionId = crypto?.randomUUID?.() || String(Date.now());

    } catch (err) {
      console.error("❌ Submit failed:", err);
      alert("Submit failed. Check console.");
    } finally {
      alreadySending = false;
      finalBtn.disabled = false;
      finalBtn.textContent = oldText || "Submit";
    }
  });
});
