console.log("HBC-Form.js LOADED");



/* =========================
   CLOUDINARY CONFIG
========================= */
const CLOUD_NAME    = "da95wtjhp";
const UPLOAD_PRESET = "wizard_unsigned";
const ROOT_FOLDER   = "wizard_uploads";

/* =========================
   SHEETS ENDPOINT
========================= */
const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbxO-3bwR0fr6QR860cKbMkzziH1-hR6dnsyz1K5HEYxMqLGj096yNCuGec56sStIfjO/exec";

/* =========================
   GLOBAL STATE
========================= */
window.wizardState = window.wizardState || {
  sessionId  : window.wizardState?.sessionId || (crypto?.randomUUID?.() || String(Date.now())),
  uploadUrls : {},   // { final_upload: [url1,url2], carpet:[...], ... }
  // clientName: "Test User",
  // homeSqft: 1234,
};

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
    const t = await res.text().catch(()=> "");
    throw new Error("Cloudinary upload failed: " + t);
  }
  return res.json();
}

/* =========================
   SHEET HELPERS
========================= */

function getClientIdentity() {
  let firstName = "";
  let lastName  = "";
  let email     = "";

  try {
    const raw = localStorage.getItem("hs_form_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      firstName = (parsed.firstName || "").trim();
      lastName  = (parsed.lastName || "").trim();
      email     = (parsed.email || "").trim();
    }
  } catch (err) {
    console.warn("[ClientIdentity] Failed to parse hs_form_user", err);
  }

  const clientName = [firstName, lastName].filter(Boolean).join(" ") || "Test User";

  return { clientName, clientEmail: email };
}






async function sendSubmissionToSheet(lines) {
  const { clientName, clientEmail } = getClientIdentity();

  const params = new URLSearchParams();
  params.append("action", "submit_all");
  params.append("clientName", clientName);
  params.append("clientEmail", clientEmail);
  params.append("sessionId", window.wizardState?.sessionId || "wizard-session");

  
  const uploadObj = window.wizardState?.uploadUrls || {};
  const allUploads = Object.values(uploadObj).flat().filter(Boolean);
  params.append("uploads", allUploads.join("\n"));
   
   // 👇 šaljemo linije kao JSON string u jednom parametru
  params.append("lines", JSON.stringify(
    (lines || []).map(l => ({
      serviceName: l.serviceName || "",
      itemId: l.itemId || "",
      qty: Number(l.qty || 0),
      description: l.description || ""
    }))
  ));

  const res = await fetch(SHEET_ENDPOINT, {
    method: "POST",
    body: params
  });

  const text = await res.text().catch(() => "");
  console.log("[Sheet] submit_all response", { status: res.status, body: text });

  return res.ok;
}




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
      if (bulbItemId) {
        items.push({ serviceName: "Bulb Update", itemId: bulbItemId, qty: 1 });
      }
    } else {
      console.warn("[Collect] Bulb Update: missing valid sqft");
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
    } else {
      console.warn("[Collect] Inside Paint: missing valid sqft");
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
      items.push({
        serviceName: "Inside Paint - Cabinets",
        itemId: "110-3",
        qty: doorsQty
      });
    } else {
      console.warn("[Collect] Cabinets: yes selected but doors qty invalid");
    }
  }

   // FAUCET / TOILET - TOILET QTY (130-1)
const toiletQtyEl =
  document.getElementById("toilet-qty") ||
  document.querySelector('input[name="toilet_qty"]');

if (toiletQtyEl) {
  const qty = Number((toiletQtyEl.value || "").trim());

  if (!isNaN(qty) && qty > 0) {
    items.push({
      serviceName: "Faucet / Toilet - Toilet Replacement",
      itemId: "130-1",
      qty
    });
  }
}


   // FAUCET / TOILET — Kitchen sink fixture (130-2/3/4)
  const kitchenPick = document.querySelector('input[name="kitchen_sink_fixture"]:checked');
  if (kitchenPick) {
    const itemId = (kitchenPick.dataset.itemId || kitchenPick.value || "").trim();
    if (itemId) {
      items.push({
        serviceName: "Kitchen Sink Fixture Replacement",
        itemId,
        qty: 1
      });
    }
  }

   // FAUCET / TOILET — Bathroom vanity faucet (130-5/6/7) × bathroom count
const vanityPick = document.querySelector('input[name="bathroom_vanity_faucet"]:checked');

const bathroomCountEl =
  document.getElementById("bathroom-count") ||
  document.querySelector('input[name="bathroom_count"]');

const bathroomQty = bathroomCountEl ? Number((bathroomCountEl.value || "").trim()) : NaN;

if (vanityPick) {
  const itemId = (vanityPick.dataset.itemId || vanityPick.value || "").trim();

  if (itemId && !isNaN(bathroomQty) && bathroomQty > 0) {
    items.push({
      serviceName: "Bathroom Vanity Sink Faucet Replacement",
      itemId,
      qty: bathroomQty
    });
  }
}


     // DOOR HARDWARE (finish radio + qty inputs)
  const doorFinish = document.querySelector('input[name="door_hardware_finish"]:checked');

  if (doorFinish) {
    const qtyNoLockEl  = document.querySelector('input[data-qty="no_lock"]');
    const qtyWithLockEl = document.querySelector('input[data-qty="with_lock"]');

    const qtyNoLock  = qtyNoLockEl ? Number((qtyNoLockEl.value || "").trim()) : 0;
    const qtyWithLock = qtyWithLockEl ? Number((qtyWithLockEl.value || "").trim()) : 0;

    const itemNoLock  = (doorFinish.dataset.itemNoLock || "").trim();
    const itemWithLock = (doorFinish.dataset.itemWithLock || "").trim();

    // No lock
    if (itemNoLock && !isNaN(qtyNoLock) && qtyNoLock > 0) {
      items.push({
        serviceName: "Door Hardware",
        itemId: itemNoLock,
        qty: qtyNoLock
      });
    }

    // With lock
    if (itemWithLock && !isNaN(qtyWithLock) && qtyWithLock > 0) {
      items.push({
        serviceName: "Door Hardware",
        itemId: itemWithLock,
        qty: qtyWithLock
      });
    }
     // Dummy door knobs (non-turning)
const dummyQtyEl =
  document.getElementById("dummy-door-qty") ||
  document.querySelector('input[data-qty="dummy"]');

const dummyQty = dummyQtyEl ? Number((dummyQtyEl.value || "").trim()) : 0;

const itemDummy = (doorFinish.dataset.itemDummy || "").trim();

if (itemDummy && !isNaN(dummyQty) && dummyQty > 0) {
  items.push({
    serviceName: "Door Hardware - Dummy Knob",
    itemId: itemDummy,
    qty: dummyQty
  });
}


     // Front door yes/no
  const frontAns = document.querySelector(
    'input[name="front_door_hardware_replace"]:checked'
  );
  const frontYes = (frontAns?.value || "").trim().toLowerCase() === "yes";

  const itemFront = (doorFinish.dataset.itemFrontExterior || "").trim();
  if (frontYes && itemFront) {
    items.push({
      serviceName: "Front Door Hardware",
      itemId: itemFront,
      qty: 1
    });
  }

  // Other exterior doors qty
  const otherQtyEl = document.getElementById("exterior-doors-qty");
  const otherQty = otherQtyEl ? Number((otherQtyEl.value || "").trim()) : 0;

  const itemOther = (doorFinish.dataset.itemExteriorOther || "").trim();
  if (itemOther && otherQty > 0) {
    items.push({
      serviceName: "Exterior Door Hardware (Other Doors)",
      itemId: itemOther,
      qty: otherQty
    });
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

    if (itemId) {
      items.push({ serviceName: "Exterior Paint", itemId, qty: 1 });
    } else {
      console.warn("[Collect] Exterior Paint: missing single/two selection");
    }
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
  const landscapingMain = document.querySelectorAll('input[name="landscaping_services"]:checked');
  landscapingMain.forEach(main => {
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
      if (isNaN(sqft)) {
        console.warn("[Cleaning] Missing home sqft for", itemId);
        return;
      }
      qty = sqft;
      description = "";
    } else {
      const subDesc = buildSubDescriptionForParent(itemId);
      const inputsDesc = buildInputsDescriptionForParent(itemId);

      if (subDesc && inputsDesc) description = `${subDesc}, ${inputsDesc}`;
      else if (subDesc) description = subDesc;
      else if (inputsDesc) description = inputsDesc;

      qty = 1;
    }

    items.push({ serviceName, itemId, qty, description });
  });

  // HANDYMAN
  const handymanMain = document.querySelectorAll('input[name="handyman_services"]:checked');
  handymanMain.forEach(main => {
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

  // 3) LIGHT / FAN FIXTURES catalog
  const checkedFixtures = document.querySelectorAll(".fixture-checkbox:checked");
  checkedFixtures.forEach(cb => {
    const itemId = cb.dataset.itemId;
    const qtyRaw = cb.dataset.qty || "1";
    const qtyNum = Number(qtyRaw);

    if (itemId) {
      items.push({
        serviceName: "Light / Fan Fixtures",
        itemId,
        qty: (!isNaN(qtyNum) && qtyNum > 0) ? qtyNum : 1
      });
    }
  });

  console.log("[Collect] Final items:", items);
  return items;
}

const ITEM_TITLES = {
  "105-1": "Mid- Grade Level 2  -349 Oak Bay",
  "105-2": "Mid- Grade Level 2  - 812 Clam Shell",
  "105-3": "High- Grade Level 1 - 944 Snowbird",
  "105-4": "High- Grade Level 1 - 813 Morning Dove",
  "105-5": "High- Grade Level 1 - 701 Sawgrass",

  "110-1": "Interior Walls and Ceiling",
  "110-2": "Interior Doors and Trim",
  "110-3": "Paint Cabinets",
  "110-4": "Full Exterior Paint (Single Story)",
  "110-5": "Full Exterior Paint (Two Story)",
  "110-6": "Exterior Trim and Doors",
  "110-7": "Paint High Ceilings",
  "110-8": "Scrape Popcorn Ceilings",
  "110-9": "Remove Wall Paper (by room)",
  "110-10": "Drywall Repairs",

  "115-1": "A Fresh Cut - Mow and Edge Grass",
  "115-2": "Tree Trimming",
  "115-3": "Bush Trimming",
  "115-4": "Flower Bed cleanout + black mulch",
  "115-5": "Pressure Washing",

  "120-1": "Standard Cleaning",
  "120-2": "Deep Cleaning",
  "120-3": "Exterior Window Cleaning",
  "120-4": "Steam Clean Carpets and Rugs",
  "120-5": "Exterior Pressure Washing",
  "120-6": "Reglaze - Tub/shower Tile",

  "125-1": "HVAC Filters",
  "125-2": "Replace Door Weather Stripping",
  "125-3": "Caulking and Sealing",
  "125-4": "Replace House Numbers",
  "125-5": "New Smoke/Carbon Monoxide Detectors",
  "125-6": "Replace Ceiling Vent Covers",
  "125-7": "Handy-Man - Other",

  "130-1": "Toilet Replacement",
  "130-2": "Kitchen Sink Fixture Replacement - Black",
  "130-3": "Kitchen Sink Fixture Replacement - Silver",
  "130-4": "Kitchen Sink Fixture Replacement - Brushed Gold",
  "130-5": "Bathroom Vanity Sink Faucent Replacement - Black",
  "130-6": "Bathroom Vanity Sink Faucent Replacement - Silver",
  "130-7": "Bathroom Vanity Sink Faucent Replacement - Brushed Gold",

  "135-1": "Cabinet Knobs (single hole) - Black",
  "135-2": "Cabinet Knobs (single hole) - Silver",
  "135-3": "Cabinet Knobs (single hole) - Brushed Gold",
  "135-4": "Cabinet Pulls (two hole) - Black",
  "135-5": "Cabinet Pulls (two hole) - Silver",
  "135-6": "Cabinet Pulls (two hole) - Brushed Gold",
  "135-7": "Cabinet Knobs",
  "135-8": "Cabinet Pulls",

  "140-1": "Door knob (pass-through) - Black",
  "140-2": "Door knob (privacy- with a lock) - Black",
  "140-3": "Door Knob (dummy - doesn't turn) - Black",
  "140-4": "Door knob (pass-through) - Silver",
  "140-5": "Door knob (privacy- with a lock) - Silver",
  "140-6": "Door Knob (dummy - doesn't turn) - Silver",
  "140-7": "Door Knobs",
  "140-8": "Front Door Hardware - Handle and Deadbolt - Black",
  "140-9": "Front Door Hardware - Handle and Deadbolt - Silver",
  "140-10": "Exterior Door Hardware - Door Knob & Deadbolt - Black",
  "140-11": "Exterior Door Hardware - Door Knob & Deadbolt - Silver",

  "145-1": "Black - Ceiling Fan",
  "145-2": "Black - Vanity Light - Small (3 light)",
  "145-3": "Black - Vanity Light - Large (5 lights)",
  "145-4": "Black Diningroom Chandelier",
  "145-5": "Black Breakfast Nook Chandelier",
  "145-6": "Black Entry Light Chandelier",
  "145-7": "Black Entry Light Flushmount",
  "145-8": "Black Island Pendant Light",

  "145-9": "Silver - Ceiling Fan",
  "145-10": "Silver - Vanity Light - Small (3 light)",
  "145-11": "Silver  - Vanity Light - Large (5 lights)",
  "145-12": "Silver - Diningroom Chandelier",
  "145-13": "Silver - Breakfast Nook Chandelier",
  "145-14": "Silver - Entry Light Chandelier",
  "145-15": "Silver - Entry Light Flushmount",
  "145-16": "Silver - Island Pendant Light",

  "145-17": "Gold - Ceiling Fan",
  "145-18": "Gold - Vanity Light - Small (3 light)",
  "145-19": "Gold - Vanity Light - Large (5 lights)",
  "145-20": "Gold - Diningroom Chandelier",
  "145-21": "Gold - Breakfast Nook Chandelier",
  "145-22": "Gold - Entry Light Chandelier",
  "145-23": "Gold - Entry Light Flushmount",
  "145-24": "Gold - Island Pendant Light",

  "145-25": "Light Bulb Swap - Full House Matching (<1500 sqft)",
  "145-26": "Light Bulb Swap - Full House Matching (1500-2000 sqft)",
  "145-27": "Light Bulb Swap - Full House Matching (2001-3000 sqft)",
  "145-28": "Light Bulb Swap - Full House Matching (3000+ sqft)"
};


// Summary -> Edit (pencil) routing
const SUMMARY_EDIT_MAP_BY_SERVICE_NAME = {
  "Carpet": "carpet",
  "Bulb Update": "light",
  "Light / Fan Fixtures": "light",

  "Inside Paint": "inside_paint",
  "Inside Paint - Cabinets": "inside_paint",

  "Exterior Paint": "exterior_paint",

  "Cabinet Knobs": "cabinet_hardware",
  "Cabinet Pulls": "cabinet_hardware",

  "Door Hardware": "door_hardware",
  "Door Hardware - Dummy Knob": "door_hardware",
  "Front Door Hardware": "door_hardware",
  "Exterior Door Hardware (Other Doors)": "door_hardware",

  "Cleaning": "cleaning",
  "Landscaping": "landscaping",
  "Handy-Man Service": "handyman",
  "Handy-Man - Other": "handyman",

  "Faucet / Toilet - Toilet Replacement": "faucet_toilet",
  "Kitchen Sink Fixture Replacement": "faucet_toilet",
  "Bathroom Vanity Sink Faucet Replacement": "faucet_toilet",
};

// ako želiš preciznije subIndex po itemId, možeš dopuniti ovde
const SUMMARY_EDIT_SUBINDEX_BY_ITEMID = {
  // primer (ako znaš tačno da je nešto na drugom sub-stepu):
  // "110-3": 1,
};

function getEditTargetForLine(line) {
  const serviceId = SUMMARY_EDIT_MAP_BY_SERVICE_NAME[(line.serviceName || "").trim()] || "";
  const itemId = (line.itemId || "").trim();
  const subIndex = Number(SUMMARY_EDIT_SUBINDEX_BY_ITEMID[itemId] ?? 0);
  return { serviceId, subIndex };
}

function summaryPencilSvg() {
  // mala olovčica (inline SVG)
  return `
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;
}

// ✅ Summary pencil handler (bind once)
(function bindSummaryEditOnce(){
  if (window.__summaryEditBound) return;  // sprečava dupliranje
  window.__summaryEditBound = true;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-service]");
    if (!btn) return;

    const serviceId = (btn.getAttribute("data-edit-service") || "").trim();
    const subIndex = Number(btn.getAttribute("data-edit-subindex") || 0);
    if (!serviceId) return;

    const api = window.__wiz;
    if (!api?.showOnly || !api?.state) {
      console.warn("[SummaryEdit] Missing __wiz api");
      return;
    }

    if (!api.state.selectedOrder?.includes?.(serviceId)) {
      api.showOnly("select");
      return;
    }

    api.showOnly({ type: "service", id: serviceId, subIndex: isNaN(subIndex) ? 0 : subIndex });
  });
})();


window.renderSummary = function renderSummary() {
  const holder = document.getElementById("summaryList");
  if (!holder) {
    console.warn("[Summary] Missing #summaryList element on the page.");
    return;
  }

   


  const lines = collectAllLineItems();
  if (!lines || !lines.length) {
    holder.innerHTML = `<div style="padding:12px;border:1px solid #eee;border-radius:8px;">
      Nothing selected yet.
    </div>`;
    return;
  }

  // group by serviceName
  const groups = {};
  lines.forEach(l => {
    const key = (l.serviceName || "Other").trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  let html = "";
  Object.keys(groups).forEach(service => {
    html += `<div style="margin-bottom:16px;">
      <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(service)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">`;

    groups[service].forEach(item => {
  const id = (item.itemId || "").trim();
  const qty = String(item.qty ?? "").trim();
  const notes = (item.description || "").trim();

  const title = (ITEM_TITLES[id] || "").trim() || `Item ${id}`;

  const edit = getEditTargetForLine(item);

  html += `<div style="padding:10px 12px;border:1px solid #eee;border-radius:10px;background:#fff;">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <div style="font-weight:600;">${escapeHtml(title)}</div>
        <div style="opacity:0.8;">Qty: ${escapeHtml(qty)}</div>
        <div style="opacity:0.45;font-size:12px;">(${escapeHtml(id)})</div>
      </div>

      ${
        edit.serviceId
          ? `<button type="button"
              data-edit-service="${escapeHtml(edit.serviceId)}"
              data-edit-subindex="${escapeHtml(edit.subIndex)}"
              style="display:inline-flex;align-items:center;gap:6px;border:1px solid #e6e6e6;background:#fff;border-radius:999px;padding:6px 10px;cursor:pointer;">
              <span style="display:inline-flex;opacity:0.85;">${summaryPencilSvg()}</span>
              <span style="font-size:12px;opacity:0.85;">Edit</span>
            </button>`
          : ``
      }
    </div>

    ${notes ? `<div style="margin-top:6px;opacity:0.9;"><b>Notes:</b> ${escapeHtml(notes)}</div>` : ""}
  </div>`;
});


    html += `</div></div>`;
  });

  holder.innerHTML = html;
};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================
   MAIN INIT (ONE DOMContentLoaded)
========================= */
document.addEventListener("DOMContentLoaded", () => {

  /* =========================
     WIZARD CORE
  ========================= */
  const root = document.querySelector('#wizard');
  if (!root) return;
   
   console.log("✅ HBC INIT RUNNING (Webflow.push)");



  // FLOW definition (shared)
  const FLOW = {
    carpet:         ['carpet_details', 'carpet_details2'],
    light:          ['light_questions','light_type'],
    inside_paint:   ['paint_details', 'light_questions2', 'color_scheme'],
    exterior_paint: ['ext_paint', 'ext_paint2'],
    cabinet_hardware: ['replace_question', 'counts', 'finish'],
    door_hardware: ['door_details','door_details_ext','door_style'],
    cleaning: ['cleaning_details'],
    landscaping: ['landscaping_details'],
    handyman: ['handyman_details'],
    faucet_toilet: ['faucet_toilet_details', 'faucet_toilet_details2', 'faucet_toilet_details3']
  };

  const state = {
    current: 'intro',
    selectedOrder: [],
    completedServices: new Set(),
  };

  const q  = (sel, ctx = document) => ctx.querySelector(sel);
  const qa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const steps = qa('.step', root);

  function logState(label="STATE") {
    console.log(`🟦 [${label}] current=`, state.current,
      "| selectedOrder=", state.selectedOrder,
      "| completedServices=", Array.from(state.completedServices));
  }

  function showOnly(target) {
    console.log("➡️ showOnly:", target);

    let mode = target;
    let svcId = null, subId = null;

    if (typeof target === 'object' && target?.type === 'service') {
      svcId = target.id;
      const idx = target.subIndex ?? 0;
      subId = (FLOW[svcId] || [])[idx];
      mode = 'service';
      if (!subId) console.warn(`⚠️ FLOW missing substep index=${idx} for service="${svcId}"`);
    }

    steps.forEach(div => {
      const kind = div.dataset.step;
      let match = false;

      if (mode === 'service') {
        match = (kind === 'service'
          && div.dataset.service === svcId
          && div.dataset.sub === subId);
      } else {
        match = (kind === mode);
      }

      div.hidden = !match;

       
      if (match) console.log(`✅ Showing step [${kind}]`, div.dataset);
    });

    state.current = (mode === 'service')
      ? { type:'service', id: svcId, subIndex: target.subIndex ?? 0 }
      : mode;

    renderProgress();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    logState("AFTER showOnly");

     // ✅ When summary step is shown, render it
if ((mode === "summary" || target === "summary") && typeof window.renderSummary === "function") {
  setTimeout(window.renderSummary, 0);
}

  }

  function getSelected() {
    const selected = qa('input[name="services"][type="checkbox"]', root)
      .filter(b => b.checked)
      .map(b => b.dataset.service);
    console.log("🟨 Selected services:", selected);
    return selected;
  }

  function updateSelectedOrder() {
    const now = getSelected();
    now.forEach(v => { if (!state.selectedOrder.includes(v)) state.selectedOrder.push(v); });
    state.selectedOrder = state.selectedOrder.filter(v => now.includes(v));
    for (const s of Array.from(state.completedServices)) {
      if (!state.selectedOrder.includes(s)) state.completedServices.delete(s);
    }
    console.log("🔄 selectedOrder:", state.selectedOrder);
  }

  function firstUnfinishedService() {
    const f = state.selectedOrder.find(id => !state.completedServices.has(id)) || null;
    console.log("🧭 firstUnfinishedService =", f);
    return f;
  }

  function gotoFirstSubOf(serviceId) {
    console.log(`🚀 gotoFirstSubOf(${serviceId})`);
    showOnly({ type:'service', id: serviceId, subIndex: 0 });
  }

  function gotoSuccess() { console.log("🎉 gotoSuccess"); showOnly('success'); }

  function validateIntro() {
    const zip = q('input[name="zip"]', root);
    if (zip && zip.value && zip.getAttribute('pattern')) {
      const re = new RegExp(zip.getAttribute('pattern'));
      if (!re.test(zip.value)) {
        alert('Please enter a valid ZIP.');
        zip.focus();
        return false;
      }
    }
    return true;
  }

  function ensureSelectionBeforeNext() {
    if (!state.selectedOrder.length) {
      alert('Please select at least one service to continue.');
      return false;
    }
    return true;
  }

  function gotoNext() {
    console.log("➡️ gotoNext. current=", state.current);
    logState("BEFORE gotoNext");

    if (state.current === 'intro') {
      if (!validateIntro()) return;
      showOnly('select'); return;
    }

    if (state.current === 'select') {
      updateSelectedOrder();
      if (!ensureSelectionBeforeNext()) return;
      const first = firstUnfinishedService();
      if (first) gotoFirstSubOf(first);
      else showOnly('upload');
      return;
    }

    if (state.current === 'upload') {
  showOnly('summary');
  return;
}

if (state.current === 'summary') {
  gotoSuccess();
  return;
}

    if (state.current === 'success') return;

    if (typeof state.current === 'object' && state.current.type === 'service') {
      const svc  = state.current.id;

// ✅ Faucet/Toilet: ako je NO na details2, preskoči details3
if (svc === "faucet_toilet") {
  const SUB2  = "faucet_toilet_details2";
  const GROUP = "sink_fixtures_replace";

  const curSubId = (FLOW[svc] || [])[state.current.subIndex];

  if (curSubId === SUB2) {
    const active = document.querySelector(
      `.step[data-step="service"][data-service="faucet_toilet"][data-sub="${SUB2}"]:not([hidden])`
    );

    const r = active?.querySelector(`input[name="${GROUP}"]:checked`);
    const ans = (r?.value || "").trim().toLowerCase();

    console.log("[FaucetSkip@gotoNext] ans =", ans);

    if (ans === "no") {
      // skrati FLOW da nema details3
      FLOW[svc] = ["faucet_toilet_details", "faucet_toilet_details2"];
    } else if (ans === "yes") {
      // vrati normalan flow
      FLOW[svc] = ["faucet_toilet_details", "faucet_toilet_details2", "faucet_toilet_details3"];
    }
  }
}

       
      const flow = FLOW[svc] || [];
      const nextSub = state.current.subIndex + 1;

      console.log(`🧩 SERVICE '${svc}' | subIndex=${state.current.subIndex} | nextSub=${nextSub} | flow=`, flow);
       
      if (nextSub < flow.length) {
        showOnly({ type:'service', id: svc, subIndex: nextSub });
      } else {
        console.log(`✅ Completed service: ${svc}`);
        state.completedServices.add(svc);
        const nxtSvc = firstUnfinishedService();
        if (nxtSvc) gotoFirstSubOf(nxtSvc);
        else { console.log("📸 All services done -> UPLOAD"); showOnly('upload'); }
      }
    }

    logState("AFTER gotoNext");
  }

  function gotoBack() {
    console.log("⬅️ gotoBack");

    if (state.current === 'intro') return;
    if (state.current === 'select') { showOnly('intro'); return; }

    if (state.current === 'upload') {
      const done = state.selectedOrder.filter(s => state.completedServices.has(s));
      if (done.length) {
        const lastSvc = done[done.length - 1];
        const flow = FLOW[lastSvc] || [];
        showOnly({ type:'service', id:lastSvc, subIndex: flow.length - 1 });
      } else {
        showOnly('select');
      }
      return;
    }

    if (state.current === 'success') { showOnly('upload'); return; }

    if (typeof state.current === 'object' && state.current.type === 'service') {
      const svc = state.current.id;
      const idx = state.current.subIndex;
      if (idx > 0) showOnly({ type:'service', id: svc, subIndex: idx - 1 });
      else showOnly('select');
    }

    logState("AFTER gotoBack");
  }

  function renderProgress() {
    const box = q('.progress', root);
    if (!box) return;

    const totalServiceSteps = state.selectedOrder.reduce((acc, svc) => acc + (FLOW[svc]?.length || 0), 0);
    const doneServiceSteps  = Array.from(state.completedServices).reduce((acc, svc) => acc + (FLOW[svc]?.length || 0), 0);

    const totalWithExtras = (totalServiceSteps || 0) + 2; // upload + success
    let currentIndexStep = 0;

    if (typeof state.current === 'object' && state.current.type === 'service') {
      currentIndexStep = doneServiceSteps + state.current.subIndex + 1;
    } else if (state.current === 'upload') {
      currentIndexStep = doneServiceSteps + 1;
    } else if (state.current === 'success') {
      currentIndexStep = totalServiceSteps + 2;
    }

    box.textContent = `${Math.min(currentIndexStep, totalWithExtras)} of ${totalWithExtras} answered`;
  }

  // events
  root.addEventListener('change', (e) => {
    if (e.target.matches('input[name="services"][type="checkbox"]')) {
      updateSelectedOrder();
      if (typeof state.current === 'object' && state.current.type === 'service') {
        if (!state.selectedOrder.includes(state.current.id)) {
          state.completedServices.delete(state.current.id);
          const nextSvc = firstUnfinishedService();
          if (nextSvc) gotoFirstSubOf(nextSvc);
          else showOnly('select');
        }
      }
      renderProgress();
    }
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'next') gotoNext();
    if (btn.dataset.action === 'back') gotoBack();
  });

  // expose hooks for other flow scripts
  window.__wiz = window.__wiz || {};
  window.__wiz.FLOW = FLOW;
  window.__wiz.state = state;
  window.__wiz.gotoNext = gotoNext;
  window.__wiz.showOnly = showOnly;
  window.__wiz.firstUnfinishedService = firstUnfinishedService;
  window.__wiz.gotoFirstSubOf = gotoFirstSubOf;

  // init
  updateSelectedOrder();
  showOnly('intro');

   console.log("✅✅ DEBUG LOADED v4");


/* =========================
   QTY CONTROLS (+ / -) FINAL
========================= */
(function initQtyControls() {
  const MIN_QTY = 1;
  const MAX_QTY = 99;

  function clamp(n) {
    n = Number(n);
    if (isNaN(n)) n = MIN_QTY;
    return Math.max(MIN_QTY, Math.min(MAX_QTY, n));
  }

  function esc(s){
    s = String(s || "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
    return s.replace(/["\\]/g, "\\$&");
  }

  function findCheckboxForQtyBox(qtyBox, itemId) {
    // probaj prvo u okviru iste kartice
    const card = qtyBox.closest(".radio-button-field, .with_plus_qnty, label, .popup-grid-radio-btns") || document;

    return (
      card.querySelector(`.fixture-checkbox[data-item-id="${esc(itemId)}"]`) ||
      document.querySelector(`.fixture-checkbox[data-item-id="${esc(itemId)}"]`)
    );
  }

  // =========================
  // CLICK HANDLER FOR + / -
  // =========================
  document.addEventListener("click", (e) => {
    // 1) hvataj po klasi (najsigurnije u Webflow-u)
    let btn = e.target.closest(".qty-btn");

    // 2) fallback na attribute
    if (!btn) btn = e.target.closest("[data-qty-action]");
    if (!btn) return;

    const qtyBox = btn.closest("[data-qty-for]");
    if (!qtyBox) return;

    const itemId = qtyBox.getAttribute("data-qty-for");

    const numEl = qtyBox.querySelector("[data-qty-value]");
    if (!numEl) {
      console.warn("[QTY] Missing [data-qty-value] for itemId:", itemId);
      return;
    }

    const cb = findCheckboxForQtyBox(qtyBox, itemId);
    if (!cb) {
      console.warn("[QTY] Missing checkbox for itemId:", itemId, "→ Dodaj class fixture-checkbox + data-item-id");
      return;
    }

    // auto-check ako nije čekiran
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const cur = clamp(cb.dataset.qty || numEl.textContent || 1);

    // odredi action
    let action = btn.getAttribute("data-qty-action");

    // fallback po klasi imena (ako zatreba)
    if (!action) {
      const cls = btn.className || "";
      if (cls.includes("inc") || cls.includes("plus")) action = "inc";
      if (cls.includes("dec") || cls.includes("minus")) action = "dec";
    }

    if (action !== "inc" && action !== "dec") {
      console.warn("[QTY] Button without action:", btn);
      return;
    }

    const next = action === "inc" ? cur + 1 : cur - 1;
    const finalQty = clamp(next);

    // snimi u checkbox (da tvoj collectAllLineItems uzme pravu vrednost)
    cb.dataset.qty = String(finalQty);

    // update UI broj
    numEl.textContent = String(finalQty);

    console.log("[QTY] itemId:", itemId, "qty:", finalQty);
  });

})();

/* =========================
   SHOW / HIDE QTY ON CHECKBOX
========================= */
document.addEventListener("change", (e) => {
  const cb = e.target.closest(".fixture-checkbox");
  if (!cb) return;

  const itemId = cb.dataset.itemId;
  if (!itemId) return;

  const qtyBox = document.querySelector(`[data-qty-for="${itemId}"]`);
  if (!qtyBox) return;

  const num = qtyBox.querySelector("[data-qty-value]");

  if (cb.checked) {
    // show
    qtyBox.classList.add("is-visible");

    // init to 1 if empty
    if (!cb.dataset.qty) cb.dataset.qty = "1";
    if (num) num.textContent = cb.dataset.qty;
  } else {
    // hide + reset
    qtyBox.classList.remove("is-visible");
    cb.dataset.qty = "1";
    if (num) num.textContent = "1";
  }
});


   

   // =========================
// DEBUG (temporary)
// =========================
window.__DBG = window.__DBG || {
  nextClicks: 0,
  gotoNextCalls: 0
};

function dbgActiveStep() {
  const s = document.querySelector('.step:not([hidden])');
  if (!s) return { step: "none" };
  return {
    step: s.dataset.step,
    service: s.dataset.service,
    sub: s.dataset.sub
  };
}

// Log EVERY click on NEXT in capture + bubble to detect duplicates
document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-action="next"]');
  if (!btn) return;
  window.__DBG.nextClicks += 1;
  console.log("🟧 [DBG] NEXT click (CAPTURE/BUBBLE) count =", window.__DBG.nextClicks, "active=", dbgActiveStep());
}, true);
document.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-action="next"]');
  if (!btn) return;
  console.log("🟨 [DBG] NEXT click (BUBBLE) active=", dbgActiveStep());
}, false);

// Wrap gotoNext so we can count calls and see who is calling it
const __origGotoNext = gotoNext;
gotoNext = function() {
  window.__DBG.gotoNextCalls += 1;
  console.log("🟥 [DBG] gotoNext CALL #", window.__DBG.gotoNextCalls, "state.current=", state.current, "active=", dbgActiveStep());
  return __origGotoNext.apply(this, arguments);
};
window.__wiz.gotoNext = gotoNext;


    /* =========================
     UPLOAD PREVIEW helpers
  ========================= */
  (function injectUploadStyles(){
    if (document.getElementById("hbc-upload-styles")) return;
    const style = document.createElement("style");
    style.id = "hbc-upload-styles";
    style.textContent = `
      .upload-preview{
        display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;
      }
      .upload-thumb{
        position:relative; width:72px; height:72px; border-radius:10px;
        overflow:hidden; border:1px solid #eee; background:#fff;
      }
      .upload-thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
      .upload-remove{
        position:absolute; top:6px; right:6px; width:20px; height:20px;
        border-radius:999px; border:1px solid rgba(0,0,0,0.12);
        background:rgba(255,255,255,0.92); cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        font-size:12px; line-height:1; padding:0;
      }
      .upload-spot.uploading { opacity: 0.75; pointer-events:none; }
      .upload-spot.error { outline: 2px solid rgba(255,0,0,0.25); }
    `;
    document.head.appendChild(style);
  })();

  function ensurePreviewHolder(spot){
    let holder = spot.querySelector(".upload-preview");
    if (!holder) {
      holder = document.createElement("div");
      holder.className = "upload-preview";
      spot.appendChild(holder);
    }
    return holder;
  }

  function getServiceId(spot){
    return spot.dataset.service || "final_upload";
  }

  function getUploadList(serviceId){
    window.wizardState.uploadUrls = window.wizardState.uploadUrls || {};
    window.wizardState.uploadUrls[serviceId] = window.wizardState.uploadUrls[serviceId] || [];
    return window.wizardState.uploadUrls[serviceId];
  }

  function renderUploadPreviewForSpot(spot){
    const serviceId = getServiceId(spot);
    const holder = ensurePreviewHolder(spot);
    const urls = (getUploadList(serviceId) || []).filter(Boolean);

    holder.innerHTML = "";

    urls.forEach((url, idx) => {
      const item = document.createElement("div");
      item.className = "upload-thumb";

      const img = document.createElement("img");
      img.src = url;
      img.alt = "Uploaded photo";

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "upload-remove";
      rm.textContent = "✕";

      rm.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const list = getUploadList(serviceId);
        list.splice(idx, 1);
        window.wizardState.uploadUrls[serviceId] = list;

        renderUploadPreviewForSpot(spot);
      });

      item.appendChild(img);
      item.appendChild(rm);
      holder.appendChild(item);
    });

    holder.style.display = urls.length ? "flex" : "none";
  }

  /* =========================
     UPLOAD BIND (WITH THUMBNAILS)
  ========================= */
  document.querySelectorAll(".upload-spot").forEach(spot => {
    const img        = spot.querySelector(".upload-img");
    const input      = spot.querySelector(".upload-input");
    const serviceId  = spot.dataset.service || "final_upload";
    const multiple   = spot.dataset.multiple === "false" ? false : true;
    const maxMB      = parseInt(spot.dataset.maxMb || "40", 10);
    const maxBytes   = maxMB * 1024 * 1024;

    if (!input) return;

    if (multiple) input.setAttribute("multiple",""); else input.removeAttribute("multiple");

    img?.addEventListener("click", () => input.click());
    spot.setAttribute("tabindex","0");
    spot.setAttribute("role","button");
    spot.addEventListener("keydown", e=>{
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });

    // render existing thumbs if user returns back / refresh
    renderUploadPreviewForSpot(spot);

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;

      const bad = files.find(f => !f.type.startsWith("image/") || f.size > maxBytes);
      if (bad) {
        alert(`"${bad.name}" is not an image or exceeds ${maxMB}MB.`);
        input.value = "";
        return;
      }

      spot.classList.remove("error");
      spot.classList.add("uploading");

      try {
        const urls = [];
        for (const f of files) {
          const data = await uploadServicePhoto(f, serviceId, window.wizardState.sessionId);
          urls.push(data.secure_url);
        }

        window.wizardState.uploadUrls[serviceId] =
          (window.wizardState.uploadUrls[serviceId] || []).concat(urls);

        spot.classList.remove("uploading");
        spot.classList.add("uploaded");

        // optional: set main image preview to first local file
        try { if (img) img.src = URL.createObjectURL(files[0]); } catch {}

        // render thumbnails
        renderUploadPreviewForSpot(spot);

      } catch (err) {
        console.error(err);
        spot.classList.remove("uploading");
        spot.classList.add("error");
        alert("Upload failed. Please try again.");
      } finally {
        input.value = "";
      }
    });
  });


  /* =========================
     POPUP CATALOG OPEN/CLOSE + RADIO BORDER
  ========================= */
  document.addEventListener("click", (e) => {
    const closer = e.target.closest(".close-modal");
    if (closer) {
      const catalog = closer.closest(".popup-catalog");
      if (catalog) catalog.style.display = "none";
      return;
    }

    const opener = e.target.closest(".open-popup");
    if (opener) {
      if (e.target.closest(".popup-catalog")) return;

      const catalog = opener.querySelector(".popup-catalog");
      if (catalog) {
        catalog.style.display = "flex";

        const popupRadios = catalog.querySelectorAll('input[type="radio"]');
        popupRadios.forEach((radio) => {
          const field = radio.closest('.radio-button-field');
          const image = field ? field.querySelector('.image-radio') : null;
          if (image) image.style.borderColor = radio.checked ? '#1E2A38' : '';
        });
      }
      return;
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.matches('.popup-catalog input[type="radio"]')) {
      const changedRadio = e.target;
      const catalog = changedRadio.closest('.popup-catalog');
      if (!catalog) return;

      const groupName = changedRadio.name;
      const groupRadios = catalog.querySelectorAll(`input[type="radio"][name="${groupName}"]`);

      groupRadios.forEach((r) => {
        const field = r.closest('.radio-button-field');
        const image = field ? field.querySelector('.image-radio') : null;
        if (image) image.style.borderColor = r.checked ? '#1E2A38' : '';
      });
    }
  });

  /* =========================
     CLEANING dynamic show-if (by cleaning_services checkboxes)
  ========================= */
  document.querySelectorAll('input[name="cleaning_services"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checkedValues = Array.from(document.querySelectorAll('input[name="cleaning_services"]:checked'))
        .map(i => i.value);

      document.querySelectorAll('[data-show-if]').forEach(block => {
        const triggerValue = block.dataset.showIf;
        block.hidden = !checkedValues.includes(triggerValue);
      });
    });
  });

  /* =========================
     SERVICE subsections show-if (deduped, was duplicated)
  ========================= */
  const serviceInputs = document.querySelectorAll('[data-service]');

  function updateSubsections() {
    const activeServices = Array.from(serviceInputs)
      .filter(input => input.checked)
      .map(input => input.dataset.service);

    document.querySelectorAll('[data-show-if]').forEach(section => {
      const target = section.dataset.showIf;
      if (activeServices.includes(target)) {
        section.style.display = 'flex';
        section.classList.add('visible');
      } else {
        section.style.display = 'none';
        section.classList.remove('visible');
      }
    });
  }

  serviceInputs.forEach(input => input.addEventListener('change', updateSubsections));
  updateSubsections();

  /* =========================
     NEXT button validation (data-required)
  ========================= */
  function isVisible(el) {
    if (!el) return false;
    let node = el;
    while (node && node !== document.body) {
      if (node.hidden) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  }

  function getActiveStep() {
    return document.querySelector(".step:not([hidden])");
  }

  function stepIsValid(step) {
    if (!step) return true;

    const requiredInputs = Array.from(step.querySelectorAll("[data-required]"));
    if (!requiredInputs.length) return true;

    let allOk = true;
    const groups = {};

    requiredInputs.forEach((input, idx) => {
      const tag  = input.tagName;
      const type = (input.type || "").toLowerCase();

      if (type === "radio" || type === "checkbox") {
        const name = input.name || ("__solo_" + idx);
        if (!groups[name]) groups[name] = { someVisible: false, someChecked: false };

        if (isVisible(input)) {
          groups[name].someVisible = true;
          if (input.checked) groups[name].someChecked = true;
        }
      } else {
        if (!isVisible(input)) return;

        const value = (input.value || "").trim();
        if (tag === "SELECT") {
          if (!value) allOk = false;
        } else {
          if (!value) allOk = false;
        }
      }
    });

    Object.values(groups).forEach(g => {
      if (g.someVisible && !g.someChecked) allOk = false;
    });

    return allOk;
  }

  function updateNextButtonState() {
    const step = getActiveStep();
    if (!step) return;

    const nextBtn = step.querySelector('[data-action="next"]');
    if (!nextBtn) return;

    const valid = stepIsValid(step);

    if (valid) {
      nextBtn.disabled = false;
      nextBtn.style.opacity = "";
      nextBtn.style.pointerEvents = "";
      nextBtn.style.cursor = "";
    } else {
      nextBtn.disabled = true;
      nextBtn.style.opacity = "0.7";
      nextBtn.style.pointerEvents = "none";
      nextBtn.style.cursor = "not-allowed";
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="next"]');
    if (!btn) return;

    const step = getActiveStep();
    if (!step) return;

    if (!stepIsValid(step)) {
      e.preventDefault();
      e.stopPropagation();
      alert("Please fill in the required fields to continue.");
    }
  }, true);

  document.addEventListener("change", updateNextButtonState);
  document.addEventListener("input", updateNextButtonState);

  const observer = new MutationObserver(() => updateNextButtonState());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "style", "class"]
  });

  updateNextButtonState();

  /* =========================
     Question renumbering
  ========================= */
  const OFFSET = 4;

  function getActiveServicesForRenumber() {
    return Array.from(
      root.querySelectorAll('input[name="services"][type="checkbox"][data-service]')
    )
      .filter(input => input.checked)
      .map(input => input.dataset.service);
  }

  function renumberQuestions() {
    const activeServices = getActiveServicesForRenumber();
    let counter = OFFSET;

    const allBadges = Array.from(root.querySelectorAll(".question-number-auto"));
    const buckets = {};

    allBadges.forEach((badge) => {
      const step = badge.closest('.step[data-step="service"]');
      if (!step) return;
      const svc = step.dataset.service;
      const sub = step.dataset.sub || "";
      const key = svc + "::" + sub;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(badge);
    });

    allBadges.forEach(badge => { badge.textContent = ""; });

    activeServices.forEach((svcId) => {
      const subs = FLOW[svcId] || [];
      subs.forEach((subId) => {
        const key = svcId + "::" + subId;
        const list = buckets[key] || [];
        list.forEach((badge) => {
          counter += 1;
          badge.textContent = counter;
        });
      });
    });
  }

  renumberQuestions();

  root.addEventListener("change", (e) => {
    if (e.target.matches('input[name="services"][type="checkbox"][data-service]')) {
      renumberQuestions();
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    setTimeout(() => renumberQuestions(), 0);
  });

  /* =========================
     SHEET SUBMIT ALL
  ========================= */
  console.log("[Sheet] init");

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

  const finalBtn = document.getElementById("sheet-submit-all");
  if (!finalBtn) {
    console.warn("[Sheet] #sheet-submit-all not found");
  } else {
    let alreadySending = false;

    finalBtn.addEventListener("click", () => {
      if (alreadySending) return;

      const lines = collectAllLineItems();
      if (!lines.length) {
        console.warn("[Sheet] No line items to send.");
        return;
      }

      alreadySending = true;

      (async () => {
  try {
    const ok = await sendSubmissionToSheet(lines);

    if (ok) {
  console.log("[Sheet] Submission sent. Clearing storage + redirecting.");

  // ✅ obriši Hubspot user (guard više neće pustiti nazad na wizard)
  localStorage.removeItem("hs_form_user");

  // ✅ (opciono) resetuj wizard state u memoriji
  if (window.wizardState) {
    window.wizardState.uploadUrls = {};
    window.wizardState.homeSqft = null;
    // sessionId možeš da ostaviš ili resetuješ, po želji
  }

  // ✅ redirect na success
  window.location.replace("/success");
  return;
}
 else {
      console.warn("[Sheet] Submission failed (not ok response)");
      alert("Something went wrong. Please try again.");
    }

  } catch (err) {
    console.error("[Sheet] submit_all failed:", err);
    alert("Submission failed. Please try again.");
  } finally {
    alreadySending = false;
  }
})();


    });
  }

  /* =========================
     FLOW SKIPS (Light, Exterior, Cabinet)
  ========================= */

  // LIGHT skip
  (function initLightSkip() {
    const api = window.__wiz;
    if (!api?.FLOW || !api?.state || !api?.gotoNext || !api?.showOnly) return;

    const LIGHT_SERVICE = "light";
    const SUB_QUESTIONS = "light_questions";
    const SUB_TYPE = "light_type";

    function getAnswer() {
      const r = document.querySelector('input[name="light_new_fans"]:checked');
      return (r?.value || "").trim().toLowerCase();
    }

    function shouldIncludeLightType() {
      return getAnswer() === "yes";
    }

    function applyFlowRealtime() {
      const include = shouldIncludeLightType();

      api.FLOW[LIGHT_SERVICE] = include ? [SUB_QUESTIONS, SUB_TYPE] : [SUB_QUESTIONS];
      console.log("[LightSkip] FLOW.light =", api.FLOW[LIGHT_SERVICE]);

      const cur = api.state.current;
      if (!include && typeof cur === "object" && cur.type === "service" && cur.id === LIGHT_SERVICE) {
        if (cur.subIndex >= 1) {
          api.state.completedServices?.add?.(LIGHT_SERVICE);
          const nextSvc = api.firstUnfinishedService?.() || null;
          if (nextSvc && api.gotoFirstSubOf) api.gotoFirstSubOf(nextSvc);
          else api.showOnly("upload");
        }
      }
    }

    document.addEventListener("change", (e) => {
      if (e.target.matches('input[name="light_new_fans"]')) applyFlowRealtime();
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="next"]');
      if (!btn) return;

      const activeLightQuestions = document.querySelector(
        `.step[data-step="service"][data-service="${LIGHT_SERVICE}"][data-sub="${SUB_QUESTIONS}"]:not([hidden])`
      );
      if (!activeLightQuestions) return;

      applyFlowRealtime();

      if (!shouldIncludeLightType()) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => api.gotoNext(), 0);
      }
    }, true);

    applyFlowRealtime();
  })();




   
  // Exterior flow
  (function initExteriorFlow() {
    const api = window.__wiz;
    if (!api?.FLOW || !api?.state || !api?.showOnly) return;

    const EXTERIOR_YESNO_GROUP = "home_exterior";
    const SERVICE = "exterior_paint";
    const SUB1 = "ext_paint";
    const SUB2 = "ext_paint2";

    function getRadioVal(groupName) {
      const r = document.querySelector(`input[name="${groupName}"]:checked`);
      return (r?.value || "").trim().toLowerCase();
    }

    function includeExteriorStep2() {
      return getRadioVal(EXTERIOR_YESNO_GROUP) === "yes";
    }

    function applyExteriorFlow() {
      const include2 = includeExteriorStep2();
      api.FLOW[SERVICE] = include2 ? [SUB1, SUB2] : [SUB1];
      console.log("[ExteriorFlow] FLOW.exterior_paint =", api.FLOW[SERVICE]);

      const cur = api.state.current;
      if (!include2 && typeof cur === "object" && cur.type === "service" && cur.id === SERVICE) {
        if (cur.subIndex >= 1) {
          api.state.completedServices?.add?.(SERVICE);
          const nextSvc = api.firstUnfinishedService?.() || null;
          if (nextSvc && api.gotoFirstSubOf) api.gotoFirstSubOf(nextSvc);
          else api.showOnly("upload");
        }
      }
    }

    document.addEventListener("change", (e) => {
      if (e.target.matches(`input[name="${EXTERIOR_YESNO_GROUP}"]`)) applyExteriorFlow();
    });

    applyExteriorFlow();
  })();

  // Cabinet flow
  (function initCabinetFlow() {
    const api = window.__wiz;
    if (!api?.FLOW || !api?.state || !api?.showOnly) return;

    const CABINET_REPLACE_GROUP = "cabinet_replace";
    const SERVICE = "cabinet_hardware";
    const SUB1 = "replace_question";
    const SUB2 = "counts";
    const SUB3 = "finish";

    function getVal() {
      const r = document.querySelector(`input[name="${CABINET_REPLACE_GROUP}"]:checked`);
      return (r?.value || "").trim().toLowerCase();
    }

    function includeCountsAndFinish() {
      return getVal() === "yes";
    }

    function applyCabinetFlow() {
      const include = includeCountsAndFinish();
      api.FLOW[SERVICE] = include ? [SUB1, SUB2, SUB3] : [SUB1];
      console.log("[CabinetFlow] FLOW.cabinet_hardware =", api.FLOW[SERVICE]);

      const cur = api.state.current;
      if (!include && typeof cur === "object" && cur.type === "service" && cur.id === SERVICE) {
        if (cur.subIndex >= 1) {
          api.state.completedServices?.add?.(SERVICE);
          const nextSvc = api.firstUnfinishedService?.() || null;
          if (nextSvc && api.gotoFirstSubOf) api.gotoFirstSubOf(nextSvc);
          else api.showOnly("upload");
        }
      }
    }

    document.addEventListener("change", (e) => {
      if (e.target.matches(`input[name="${CABINET_REPLACE_GROUP}"]`)) applyCabinetFlow();
    });

    applyCabinetFlow();
  })();

  /* =========================
     Misc: yes-radio hide blocks
  ========================= */
  (function initYesRadioHide() {
    const yesRadio = document.querySelector(".yes-radio-btn");
    const targets  = document.querySelectorAll(".hide-if-yes");
    if (!yesRadio) return;

    function updateVisibility() {
      const isChecked = yesRadio.checked === true;
      targets.forEach(el => { el.style.display = isChecked ? "flex" : "none"; });
    }

    document.addEventListener("change", (e) => {
      if (e.target.type === "radio") updateVisibility();
    });

    updateVisibility();
  })();



});
