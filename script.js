(function () {

  /* ============================================================
   * Apps Script API config
   * Paste the /exec URL of your deployed Apps Script web app here
   * after deploying (Deploy > New deployment > Web app).
   * Only form config (Blood Type, Civil Status, Relationship,
   * Country lists), submission, and entry lookup go through this
   * — the address cascade below is served as static files.
   * ========================================================== */
  const API_URL = "https://script.google.com/macros/s/AKfycbxK8daSyXE4B0tOH0guAiimrjOQbyX-kMGc2yU9x35NVfbDvC4GKh6sT2Ix_e6mdhgA/exec";

  function apiGet(action, params) {
    const qs = new URLSearchParams(Object.assign({ action }, params || {}));
    return fetch(`${API_URL}?${qs.toString()}`)
      .then(res => {
        if (!res.ok) throw new Error("Network response was not OK (" + res.status + ")");
        return res.json();
      });
  }

  function apiPost(action, payload) {
    return fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(res => {
      if (!res.ok) throw new Error("Network response was not OK (" + res.status + ")");
      return res.json();
    });
  }

  /* ============================================================
   * Static address data (regions/provinces/cities/barangays)
   * Lives in data/*.json right next to this file on GitHub Pages
   * — no Apps Script round trip, no quota, no CORS.
   * ========================================================== */
  const DATA_BASE = "data";

  let _regionsPromise = null;
  let _provincesPromise = null;
  let _citiesPromise = null;
  const _barangaysPromiseByCity = {};

  function fetchJson(path) {
    return fetch(path).then(res => {
      if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
      return res.json();
    });
  }

  function loadRegions() {
    if (!_regionsPromise) _regionsPromise = fetchJson(`${DATA_BASE}/regions.json`);
    return _regionsPromise;
  }
  function loadProvinces() {
    if (!_provincesPromise) _provincesPromise = fetchJson(`${DATA_BASE}/provinces.json`);
    return _provincesPromise;
  }
  function loadCities() {
    if (!_citiesPromise) _citiesPromise = fetchJson(`${DATA_BASE}/cities.json`);
    return _citiesPromise;
  }
  function loadBarangaysForCity(cityCode) {
    if (!_barangaysPromiseByCity[cityCode]) {
      _barangaysPromiseByCity[cityCode] = fetchJson(`${DATA_BASE}/barangays/${cityCode}.json`);
    }
    return _barangaysPromiseByCity[cityCode];
  }

  /**
   * Routes each server function name to the right call — address
   * cascade actions resolve from the local static files above,
   * everything else goes to Apps Script.
   */
  function callApi(fnName, ...args) {
    switch (fnName) {
      case "getInitialFormData":
        return apiGet("getInitialFormData");

      case "getRegions":
        return loadRegions();

      case "getProvinces": {
        const regionCode = args[0];
        return loadProvinces().then(all =>
          all.filter(p => p.regionCode === regionCode)
             .map(p => ({ code: p.code, name: p.name }))
        );
      }

      case "getCities": {
        const provinceCode = args[0];
        return loadCities().then(all =>
          all.filter(c => c.provinceCode === provinceCode)
             .map(c => ({ code: c.code, name: c.name }))
        );
      }

      case "getCitiesForRegion": {
        const regionCode = args[0];
        return loadCities().then(all =>
          all.filter(c => c.regionCode === regionCode && !c.provinceCode)
             .map(c => ({ code: c.code, name: c.name }))
        );
      }

      case "getBarangays":
        return loadBarangaysForCity(args[0]);

      case "getEntryByReference":
        return apiGet("getEntryByReference", { lastName: args[0], code: args[1] });

      case "uploadImage":
        return apiPost("uploadImage", args[0]);

      case "submitForm":
        return apiPost("submitForm", args[0]);

      default:
        return Promise.reject(new Error("Unknown API function: " + fnName));
    }
  }

  /* ============================================================
   * Element refs
   * ========================================================== */
  const el = id => document.getElementById(id);

  const formEl = el("mainForm");
  const banner = el("formBanner");
  const submitBtn = el("submitBtn"), submitBtnLabel = el("submitBtnLabel"), spinner = el("submitSpinner");
  const clearBtn = el("clearBtn");
  const successCard = el("successCard"), successTitleEl = el("successTitle"),
        successReferenceCodeEl = el("successReferenceCode"), successLastNameEl = el("successLastName"),
        submitAnotherBtn = el("submitAnotherBtn"), copyReferenceBtn = el("copyReferenceBtn");

  const homeQuickSearchEl = el("homeQuickSearch"), homeQuickSearchListEl = el("homeQuickSearchList");
  const emergencyQuickSearchEl = el("emergencyQuickSearch"), emergencyQuickSearchListEl = el("emergencyQuickSearchList");

  // Home address cascade (comboboxes — type to filter, or click to browse)
  const homeRegionEl = createCombobox(el("homeRegion"), el("homeRegionList"));
  const homeProvinceEl = createCombobox(el("homeProvince"), el("homeProvinceList"));
  const homeCityEl = createCombobox(el("homeCity"), el("homeCityList"));
  const homeBarangayEl = createCombobox(el("homeBarangay"), el("homeBarangayList"));

  // Emergency contact address cascade
  const emergencyRegionEl = createCombobox(el("emergencyRegion"), el("emergencyRegionList"));
  const emergencyProvinceEl = createCombobox(el("emergencyProvince"), el("emergencyProvinceList"));
  const emergencyCityEl = createCombobox(el("emergencyCity"), el("emergencyCityList"));
  const emergencyBarangayEl = createCombobox(el("emergencyBarangay"), el("emergencyBarangayList"));

  // Birth region/province (no city/barangay level, matches the
  // original intake form's Birth Information feature)
  const regionOfBirthEl = createCombobox(el("regionOfBirth"), el("regionOfBirthList"));
  const provinceOfBirthEl = createCombobox(el("provinceOfBirth"), el("provinceOfBirthList"));
  const countryOfBirthEl = el("countryOfBirth");

  const bloodTypeEl = el("bloodType"), civilStatusEl = el("civilStatus"),
        emergencyRelationshipEl = el("emergencyRelationship");

  // Branch Assigned -> Client Code (cascading, like the address
  // dropdowns) + a read-only Client Name hint once Code is picked
  const branchAssignedEl = el("branchAssigned"), clientCodeEl = el("clientCode"),
        clientNameHintEl = el("clientNameHint");
  let branchClientData = []; // [{branch, clientCode, clientName}, ...] from getInitialFormData()

  // TIN / SSS / PhilHealth / Pag-IBIG "I don't have" toggles
  const tinEl = el("tin"), noTinEl = el("noTin");
  const sssEl = el("sssNo"), noSssEl = el("noSss");
  const philHealthEl = el("philHealthNo"), noPhilHealthEl = el("noPhilHealth");
  const pagIbigEl = el("pagIbigNo"), noPagIbigEl = el("noPagIbig");

  // Profile/ID Photo upload
  const profilePhotoCameraInput = el("profilePhotoCameraInput"), profilePhotoGalleryInput = el("profilePhotoGalleryInput"),
        profilePhotoPreview = el("profilePhotoPreview"),
        profilePhotoPlaceholder = el("profilePhotoPlaceholder"), profilePhotoRemoveBtn = el("profilePhotoRemoveBtn"),
        profilePhotoExistingHint = el("profilePhotoExistingHint");

  // Signature — Draw or Upload
  const signatureDrawTabBtn = el("signatureDrawTabBtn"), signatureUploadTabBtn = el("signatureUploadTabBtn"),
        signatureDrawPanel = el("signatureDrawPanel"), signatureUploadPanel = el("signatureUploadPanel"),
        signatureCanvas = el("signatureCanvas"), signatureClearBtn = el("signatureClearBtn"),
        signaturePhotoCameraInput = el("signaturePhotoCameraInput"), signaturePhotoGalleryInput = el("signaturePhotoGalleryInput"),
        signaturePhotoPreview = el("signaturePhotoPreview"),
        signaturePhotoPlaceholder = el("signaturePhotoPlaceholder"), signaturePhotoRemoveBtn = el("signaturePhotoRemoveBtn"),
        signatureExistingHint = el("signatureExistingHint");

  // "View/Edit my response" lookup
  const showLookupBtn = el("showLookupBtn"), lookupPanel = el("lookupPanel");
  const lookupLastNameEl = el("lookupLastName"), lookupCodeEl = el("lookupCode");
  const lookupErrorEl = el("lookupError"), findEntryBtn = el("findEntryBtn"),
        lookupSpinner = el("lookupSpinner"), cancelLookupBtn = el("cancelLookupBtn");
  const editModeBanner = el("editModeBanner"), editModeCodeEl = el("editModeCode"),
        exitEditModeBtn = el("exitEditModeBtn");

  let isEditMode = false;
  let editReferenceLastName = "";
  let editReferenceCode = "";
  let validationRules = null; // populated from getInitialFormData()
  let allRegionsCache = [];   // populated from getRegions(), reused by clearForm()

  function populateRegionCombobox(comboboxEl) {
    comboboxEl.fill(allRegionsCache, "Select Region");
  }

  /* ============================================================
   * Generic helpers
   * ========================================================== */
  function fillSelect(selectEl, items, placeholder, preferredValue) {
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = placeholder;
    selectEl.appendChild(ph);
    items.forEach(item => {
      const opt = document.createElement("option");
      const value = typeof item === "string" ? item : item.code;
      const label = typeof item === "string" ? item : item.name;
      opt.value = value;
      opt.textContent = label;
      opt.dataset.name = typeof item === "string" ? item : item.name;
      selectEl.appendChild(opt);
    });
    if (preferredValue) {
      const match = Array.from(selectEl.options).find(o => o.dataset.name === preferredValue || o.value === preferredValue);
      if (match) selectEl.value = match.value;
    }
  }

  function fillSimpleSelect(selectEl, stringItems, placeholder, preferredValue) {
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = placeholder;
    selectEl.appendChild(ph);
    stringItems.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name; opt.dataset.name = name;
      selectEl.appendChild(opt);
    });
    if (preferredValue && stringItems.includes(preferredValue)) selectEl.value = preferredValue;
  }

  function resetSelect(selectEl, placeholder) {
    selectEl.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = placeholder;
    selectEl.appendChild(opt);
    selectEl.disabled = true;
  }

  function showBanner(msg) { banner.textContent = msg; banner.classList.add("show"); }
  function hideBanner() { banner.classList.remove("show"); }

  function selectedName(selectEl) {
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? (opt.dataset.name || "") : "";
  }

  function toTitleCase(str) {
    return String(str || "").toLowerCase().replace(/\b\p{L}/gu, ch => ch.toUpperCase());
  }

  /* ============================================================
   * Combobox (type-to-filter OR click-to-browse)
   * Converts a plain text <input> + a suggestion list container
   * into a searchable dropdown. API is deliberately close to the
   * <select>-based helpers above (fill/reset/value/selectedName/
   * addEventListener) so the address-cascade logic barely changes
   * — see createAddressCascade() and the Region Of Birth cascade.
   * ========================================================== */
  function createCombobox(inputEl, listEl) {
    let options = [];              // [{code, name}]
    let selected = { code: "", name: "" };
    let filtered = [];
    let activeIndex = -1;
    const changeListeners = [];
    const MAX_VISIBLE = 60;         // enough to browse, not so many it's sluggish

    function normalize(items) {
      return items.map(item =>
        typeof item === "string" ? { code: item, name: item } : { code: item.code, name: item.name }
      );
    }

    function filterOptions(query) {
      const q = query.trim().toLowerCase();
      const pool = q ? options.filter(o => o.name.toLowerCase().includes(q)) : options;
      return pool.slice(0, MAX_VISIBLE);
    }

    function renderList() {
      listEl.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "gf-combobox-empty";
        empty.textContent = "No matches";
        listEl.appendChild(empty);
      } else {
        filtered.forEach((item, idx) => {
          const opt = document.createElement("div");
          opt.className = "gf-combobox-option" + (idx === activeIndex ? " active" : "");
          opt.textContent = item.name;
          // mousedown (not click) fires before the input's blur handler,
          // so the selection registers before the list gets closed/reverted
          opt.addEventListener("mousedown", e => { e.preventDefault(); selectItem(item); });
          listEl.appendChild(opt);
        });
      }
      listEl.classList.add("show");
    }

    function closeList() {
      listEl.classList.remove("show");
      listEl.innerHTML = "";
      activeIndex = -1;
    }

    function selectItem(item) {
      selected = { code: item.code, name: item.name };
      inputEl.value = item.name;
      closeList();
      changeListeners.forEach(fn => fn());
    }

    function scrollActiveIntoView() {
      const activeEl = listEl.querySelector(".gf-combobox-option.active");
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    inputEl.addEventListener("input", () => {
      // Typing invalidates whatever was previously selected until a
      // fresh selection is made — mirrors a <select> having no value
      // until an option is actually chosen.
      if (selected.code && inputEl.value !== selected.name) selected = { code: "", name: "" };
      filtered = filterOptions(inputEl.value);
      activeIndex = -1;
      renderList();
    });

    inputEl.addEventListener("focus", () => {
      if (inputEl.disabled) return;
      filtered = filterOptions(inputEl.value);
      renderList();
    });

    inputEl.addEventListener("blur", () => {
      // Delayed so a suggestion's mousedown can register its
      // selection first (blur fires before click otherwise).
      setTimeout(() => {
        closeList();
        // Enforce "must pick a real option" — revert stray typed
        // text that doesn't match an actual selection.
        if (inputEl.value !== selected.name) inputEl.value = selected.name;
      }, 150);
    });

    inputEl.addEventListener("keydown", e => {
      if (!listEl.classList.contains("show")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
        renderList(); scrollActiveIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        renderList(); scrollActiveIntoView();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && filtered[activeIndex]) selectItem(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        closeList();
      }
    });

    return {
      fill(items, placeholder, preferredValue) {
        options = normalize(items);
        if (placeholder !== undefined) inputEl.placeholder = placeholder;
        if (preferredValue) {
          const match = options.find(o => o.code === preferredValue || o.name === preferredValue);
          if (match) { selected = match; inputEl.value = match.name; }
        }
      },
      reset(placeholder) {
        options = [];
        selected = { code: "", name: "" };
        inputEl.value = "";
        inputEl.disabled = true;
        if (placeholder !== undefined) inputEl.placeholder = placeholder;
        closeList();
      },
      enable() { inputEl.disabled = false; },
      disable() { inputEl.disabled = true; },
      get disabled() { return inputEl.disabled; },
      get value() { return selected.code; },
      get selectedName() { return selected.name; },
      setValue(code) {
        const match = options.find(o => o.code === code);
        if (match) { selected = match; inputEl.value = match.name; }
      },
      addEventListener(eventName, fn) {
        if (eventName === "change") changeListeners.push(fn);
      }
    };
  }

  function markInvalid(idOrEl, invalid) {
    const targetEl = typeof idOrEl === "string" ? el(idOrEl) : idOrEl;
    if (targetEl) targetEl.classList && targetEl.classList.toggle("gf-invalid", invalid);
    const errKey = typeof idOrEl === "string" ? idOrEl : (targetEl && targetEl.id);
    const errEl = document.querySelector(`[data-error-for="${errKey}"]`);
    if (errEl) errEl.classList.toggle("show", invalid);
  }

  /* ============================================================
   * Address cascade — generic, reused for Home Address and
   * Emergency Contact Address so the logic isn't duplicated.
   * Each cascade gets its own controller object tracking whether
   * the current region has a Province level (province-less
   * regions like NCR fall back straight to City).
   * ========================================================== */
  function createAddressCascade(regionEl, provinceEl, cityEl, barangayEl) {

    const state = { provinceLevelExists: true };

    function onRegionChange() {
      const regionCode = regionEl.value;
      const regionName = regionEl.selectedName;
      provinceEl.reset("Loading provinces\u2026");
      cityEl.reset("Select Province first");
      barangayEl.reset("Select City/Municipality first");

      if (!regionCode) { provinceEl.reset("Select Region first"); return; }

      callApi("getProvinces", regionCode)
        .then(provinces => {
          if (provinces && provinces.length) {
            state.provinceLevelExists = true;
            provinceEl.enable();
            provinceEl.fill(provinces, "Select Province");
          } else {
            // Province-less region (e.g. NCR): use the region itself
            // as the "province" value so the field still carries a
            // value instead of submitting empty and failing the
            // required-field check server-side.
            state.provinceLevelExists = false;
            provinceEl.fill([{ code: regionCode, name: regionName }], "N/A for this region");
            provinceEl.setValue(regionCode);
            provinceEl.disable();
            loadCitiesForRegion(regionCode);
          }
        })
        .catch(err => { showBanner("Could not load provinces."); console.error(err); });
    }

    function loadCitiesForRegion(regionCode) {
      cityEl.reset("Loading cities\u2026");
      callApi("getCitiesForRegion", regionCode)
        .then(cities => {
          if (cities && cities.length) { cityEl.enable(); cityEl.fill(cities, "Select City/Municipality"); }
          else { cityEl.reset("No cities found \u2014 contact support"); }
        })
        .catch(err => { showBanner("Could not load cities."); console.error(err); });
    }

    function onProvinceChange() {
      const provinceCode = provinceEl.value;
      cityEl.reset("Loading cities\u2026");
      barangayEl.reset("Select City/Municipality first");

      if (!provinceCode) { cityEl.reset("Select Province first"); return; }

      callApi("getCities", provinceCode)
        .then(cities => { cityEl.enable(); cityEl.fill(cities, "Select City/Municipality"); })
        .catch(err => { showBanner("Could not load cities."); console.error(err); });
    }

    function onCityChange() {
      const cityCode = cityEl.value;
      barangayEl.reset("Loading barangays\u2026");

      if (!cityCode) { barangayEl.reset("Select City/Municipality first"); return; }

      callApi("getBarangays", cityCode)
        .then(barangays => { barangayEl.enable(); barangayEl.fill(barangays, "Select Barangay"); })
        .catch(err => { showBanner("Could not load barangays."); console.error(err); });
    }

    regionEl.addEventListener("change", onRegionChange);
    provinceEl.addEventListener("change", onProvinceChange);
    cityEl.addEventListener("change", onCityChange);

    /**
     * Restores a saved cascade (Region -> Province -> City ->
     * Barangay) during "view/edit my response" AND when the
     * barangay Quick Address Search auto-fills a whole address —
     * both need to populate every level's full option list (not
     * just the one selected value) and select the right one at
     * each step, awaiting each level before loading the next.
     */
    async function restore(regionCode, provinceCode, cityCode, barangayCode) {
      if (!regionCode) return;
      regionEl.setValue(regionCode);
      const regionName = regionEl.selectedName;

      try {
        const provinces = await callApi("getProvinces", regionCode);
        if (provinces && provinces.length) {
          state.provinceLevelExists = true;
          provinceEl.enable();
          provinceEl.fill(provinces, "Select Province");
          if (provinceCode) provinceEl.setValue(provinceCode);
        } else {
          state.provinceLevelExists = false;
          provinceEl.fill([{ code: regionCode, name: regionName }], "N/A for this region");
          provinceEl.setValue(regionCode);
          provinceEl.disable();
        }

        const cities = state.provinceLevelExists
          ? await callApi("getCities", provinceCode)
          : await callApi("getCitiesForRegion", regionCode);

        if (cities && cities.length) {
          cityEl.enable();
          cityEl.fill(cities, "Select City/Municipality");
          if (cityCode) cityEl.setValue(cityCode);
        }

        if (cityCode) {
          const barangays = await callApi("getBarangays", cityCode);
          if (barangays && barangays.length) {
            barangayEl.enable();
            barangayEl.fill(barangays, "Select Barangay");
            if (barangayCode) barangayEl.setValue(barangayCode);
          }
        }
      } catch (e) {
        console.error("Address cascade restore failed:", e);
      }
    }

    return { state, restore };
  }

  const homeCascade = createAddressCascade(homeRegionEl, homeProvinceEl, homeCityEl, homeBarangayEl);
  const emergencyCascade = createAddressCascade(emergencyRegionEl, emergencyProvinceEl, emergencyCityEl, emergencyBarangayEl);

  /* ============================================================
   * Quick Address Search — type part of a barangay name, pick a
   * suggestion, and the whole Region/Province/City/Barangay
   * cascade auto-fills for that address block.
   *
   * The full nationwide index (~42,000 barangays, ~8MB) is lazy
   * loaded on first use — not on page load — so people who never
   * touch this box pay zero extra cost for it.
   * ========================================================== */
  let barangaySearchIndexPromise = null;
  function loadBarangaySearchIndex() {
    if (!barangaySearchIndexPromise) {
      barangaySearchIndexPromise = fetchJson(`${DATA_BASE}/barangay-search-index.json`);
    }
    return barangaySearchIndexPromise;
  }

  function createBarangaySearch(inputEl, listEl, cascade) {
    let debounceTimer = null;

    function renderLoading() {
      listEl.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "gf-quick-search-loading";
      loading.textContent = "Loading barangay index\u2026 (first search only)";
      listEl.appendChild(loading);
      listEl.classList.add("show");
    }

    function renderResults(matches) {
      listEl.innerHTML = "";
      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "gf-combobox-empty";
        empty.textContent = "No matching barangay found";
        listEl.appendChild(empty);
      } else {
        matches.forEach(item => {
          const opt = document.createElement("div");
          opt.className = "gf-quick-search-option";
          const path = [item.cityName, item.provinceName, item.regionName].filter(Boolean).join(", ");
          opt.innerHTML = `<div class="gf-quick-search-name"></div><div class="gf-quick-search-path"></div>`;
          opt.querySelector(".gf-quick-search-name").textContent = item.name;
          opt.querySelector(".gf-quick-search-path").textContent = path;
          opt.addEventListener("mousedown", async e => {
            e.preventDefault();
            listEl.classList.remove("show");
            inputEl.value = `${item.name} \u2014 ${item.cityName}`;
            inputEl.disabled = true;
            try {
              await cascade.restore(item.regionCode, item.provinceCode, item.cityCode, item.code);
            } finally {
              inputEl.disabled = false;
            }
          });
          listEl.appendChild(opt);
        });
      }
      listEl.classList.add("show");
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) { listEl.classList.remove("show"); return; }
      loadBarangaySearchIndex()
        .then(index => {
          const matches = index.filter(b => b.name.toLowerCase().includes(q)).slice(0, 25);
          renderResults(matches);
        })
        .catch(err => {
          listEl.innerHTML = "";
          const errEl = document.createElement("div");
          errEl.className = "gf-quick-search-loading";
          errEl.textContent = "Could not load the barangay index. Please use the dropdowns below instead.";
          listEl.appendChild(errEl);
          console.error(err);
        });
    }

    inputEl.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const query = inputEl.value;
      if (!query.trim()) { listEl.classList.remove("show"); return; }
      if (!barangaySearchIndexPromise) renderLoading();
      debounceTimer = setTimeout(() => runSearch(query), 250);
    });

    inputEl.addEventListener("blur", () => {
      setTimeout(() => listEl.classList.remove("show"), 150);
    });
  }

  createBarangaySearch(homeQuickSearchEl, homeQuickSearchListEl, homeCascade);
  createBarangaySearch(emergencyQuickSearchEl, emergencyQuickSearchListEl, emergencyCascade);

  /* ============================================================
   * Region Of Birth -> Province Of Birth (no City/Barangay level,
   * matches the original form's Birth Information feature)
   * ========================================================== */
  let birthProvinceLevelExists = true;

  regionOfBirthEl.addEventListener("change", () => {
    const regionCode = regionOfBirthEl.value;
    const regionName = regionOfBirthEl.selectedName;
    provinceOfBirthEl.reset("Loading provinces\u2026");

    if (!regionCode) { provinceOfBirthEl.reset("Select Region Of Birth first"); return; }

    callApi("getProvinces", regionCode)
      .then(provinces => {
        if (provinces && provinces.length) {
          birthProvinceLevelExists = true;
          provinceOfBirthEl.enable();
          provinceOfBirthEl.fill(provinces, "Select Province");
        } else {
          // Province-less region (e.g. NCR): use the region itself as
          // the "province" value so the field still carries a value.
          birthProvinceLevelExists = false;
          provinceOfBirthEl.fill([{ code: regionCode, name: regionName }], "N/A for this region");
          provinceOfBirthEl.setValue(regionCode);
          provinceOfBirthEl.disable();
        }
      })
      .catch(err => { showBanner("Could not load provinces for Region Of Birth."); console.error(err); });
  });

  /* ============================================================
   * Branch Assigned -> Client Code -> Client Name hint
   * Small dataset (unlike the address cascade), so all of it is
   * bundled into getInitialFormData() and filtered locally here —
   * no extra Apps Script round trips needed per selection.
   * ========================================================== */
  function populateBranchOptions() {
    const branches = [...new Set(branchClientData.map(r => r.branch))].sort();
    fillSimpleSelect(branchAssignedEl, branches, "Select Branch");
  }

  function populateClientCodeOptions(branch, preferredCode) {
    if (!branch) {
      resetSelect(clientCodeEl, "Select Branch Assigned first");
      clientNameHintEl.style.display = "none";
      return;
    }
    const codes = branchClientData
      .filter(r => r.branch === branch)
      .map(r => r.clientCode)
      .sort();
    if (codes.length) {
      clientCodeEl.disabled = false;
      fillSimpleSelect(clientCodeEl, codes, "Select Client Code", preferredCode);
      updateClientNameHint();
    } else {
      resetSelect(clientCodeEl, "No client codes found for this branch");
      clientNameHintEl.style.display = "none";
    }
  }

  function updateClientNameHint() {
    const branch = branchAssignedEl.value;
    const code = clientCodeEl.value;
    const match = branchClientData.find(r => r.branch === branch && r.clientCode === code);
    if (match && match.clientName) {
      clientNameHintEl.textContent = `Client Name: ${match.clientName}`;
      clientNameHintEl.style.display = "block";
    } else {
      clientNameHintEl.style.display = "none";
    }
  }

  branchAssignedEl.addEventListener("change", () => {
    populateClientCodeOptions(branchAssignedEl.value);
    markInvalid("branchAssigned", false);
  });
  clientCodeEl.addEventListener("change", () => {
    updateClientNameHint();
    markInvalid("clientCode", false);
  });

  /* ============================================================
   * TIN / SSS / PhilHealth / Pag-IBIG default value toggles
   * Rather than have the user type the dummy default digits by
   * hand, checking the box selects the default value for them and
   * locks the field so it can't be overtyped by mistake.
   * ========================================================== */
  function wireDefaultToggle(checkboxEl, inputEl, fieldKey, fallbackDefault) {
    function apply() {
      const defaultValue = (validationRules && validationRules[fieldKey] && validationRules[fieldKey].defaultValue) || fallbackDefault;
      if (checkboxEl.checked) {
        inputEl.value = defaultValue;
        inputEl.disabled = true;
        markInvalid(inputEl, false);
      } else {
        inputEl.disabled = false;
        if (inputEl.value === defaultValue) inputEl.value = "";
      }
    }
    checkboxEl.addEventListener("change", apply);
    return apply;
  }

  const applyNoTinToggle = wireDefaultToggle(noTinEl, tinEl, "tin", "000000000");
  const applyNoSssToggle = wireDefaultToggle(noSssEl, sssEl, "sss", "0000000000");
  const applyNoPhilHealthToggle = wireDefaultToggle(noPhilHealthEl, philHealthEl, "philHealth", "000000000000");
  const applyNoPagIbigToggle = wireDefaultToggle(noPagIbigEl, pagIbigEl, "pagIbig", "000000000000");

  /* ============================================================
   * Profile/ID Photo + Signature (draw or upload)
   *
   * Both end up as compressed base64 JPEG/PNG data URLs held in
   * memory (profilePhotoDataUrl / signatureDataUrl) until submit,
   * at which point buildPayload() sends them to Apps Script, which
   * saves them to Drive and stores the resulting link in the sheet.
   *
   * "existing*Url" holds a previously-saved Drive link when editing
   * an entry — if the person doesn't choose a new file, buildPayload
   * sends "" for that field and the server keeps the file already
   * on record instead of requiring a fresh upload every time.
   * ========================================================== */
  let profilePhotoDataUrl = "";
  let existingProfilePhotoUrl = "";
  let signatureDataUrl = "";
  let existingSignatureUrl = "";
  let signatureMethod = "draw"; // "draw" | "upload"
  let hasDrawnSignature = false;

  /**
   * Reads an image File, downsizes it to at most maxDimension on
   * its longest side, and re-encodes as JPEG at the given quality —
   * turns multi-MB camera photos into a couple hundred KB before
   * they're ever sent anywhere.
   */
  function compressImageFile(file, maxDimension, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not read the selected image."));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDimension) {
            height = Math.round(height * (maxDimension / width));
            width = maxDimension;
          } else if (height > maxDimension) {
            width = Math.round(width * (maxDimension / height));
            height = maxDimension;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function showUploadPreview(previewEl, placeholderEl, removeBtnEl, dataUrl) {
    previewEl.src = dataUrl;
    previewEl.style.display = "block";
    placeholderEl.style.display = "none";
    removeBtnEl.style.display = "inline-block";
  }

  function hideUploadPreview(previewEl, placeholderEl, removeBtnEl) {
    previewEl.src = "";
    previewEl.style.display = "none";
    placeholderEl.style.display = "block";
    removeBtnEl.style.display = "none";
  }

  // --- Profile/ID Photo (Take Photo and Choose from Gallery both
  //     feed the same handler — see the mobile-camera-hijack note
  //     on signature's twin inputs below for why there are two) ---
  async function handleProfilePhotoFile(file) {
    if (!file) return;
    try {
      profilePhotoDataUrl = await compressImageFile(file, 1200, 0.8);
      showUploadPreview(profilePhotoPreview, profilePhotoPlaceholder, profilePhotoRemoveBtn, profilePhotoDataUrl);
      profilePhotoExistingHint.style.display = "none";
      markInvalid("profilePhoto", false);
      el("profilePhotoBox").classList.remove("gf-invalid");
    } catch (e) {
      showBanner("Could not process that photo. Please try a different file.");
      console.error(e);
    }
  }
  profilePhotoCameraInput.addEventListener("change", () => handleProfilePhotoFile(profilePhotoCameraInput.files[0]));
  profilePhotoGalleryInput.addEventListener("change", () => handleProfilePhotoFile(profilePhotoGalleryInput.files[0]));

  profilePhotoRemoveBtn.addEventListener("click", () => {
    profilePhotoDataUrl = "";
    profilePhotoCameraInput.value = "";
    profilePhotoGalleryInput.value = "";
    hideUploadPreview(profilePhotoPreview, profilePhotoPlaceholder, profilePhotoRemoveBtn);
    if (existingProfilePhotoUrl) profilePhotoExistingHint.style.display = "block";
  });

  // --- Signature: Draw tab ---
  const sigCtx = signatureCanvas.getContext("2d");
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = "round";
  sigCtx.strokeStyle = "#202124";
  let isDrawing = false;

  // The canvas's CSS background is just a visual style — the
  // actual pixel data starts fully transparent. Fill it with real
  // white pixels so the saved PNG looks correct as a standalone
  // image (not transparent) wherever it's viewed later.
  function fillSignatureCanvasWhite() {
    sigCtx.fillStyle = "#ffffff";
    sigCtx.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  }
  fillSignatureCanvasWhite();

  function getCanvasPoint(evt) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: (point.clientX - rect.left) * scaleX, y: (point.clientY - rect.top) * scaleY };
  }

  function startDraw(evt) {
    evt.preventDefault();
    isDrawing = true;
    const { x, y } = getCanvasPoint(evt);
    sigCtx.beginPath();
    sigCtx.moveTo(x, y);
  }
  function moveDraw(evt) {
    if (!isDrawing) return;
    evt.preventDefault();
    const { x, y } = getCanvasPoint(evt);
    sigCtx.lineTo(x, y);
    sigCtx.stroke();
    if (!hasDrawnSignature) {
      hasDrawnSignature = true;
      signatureCanvas.classList.remove("gf-invalid");
      const errEl = document.querySelector('[data-error-for="signature"]');
      if (errEl) errEl.classList.remove("show");
    }
  }
  function endDraw() { isDrawing = false; }

  signatureCanvas.addEventListener("mousedown", startDraw);
  signatureCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  signatureCanvas.addEventListener("touchstart", startDraw, { passive: false });
  signatureCanvas.addEventListener("touchmove", moveDraw, { passive: false });
  signatureCanvas.addEventListener("touchend", endDraw);

  signatureClearBtn.addEventListener("click", () => {
    fillSignatureCanvasWhite();
    hasDrawnSignature = false;
    signatureExistingHint.style.display = existingSignatureUrl ? "block" : "none";
  });

  // --- Signature: Upload tab ---
  // Two separate inputs (camera vs. gallery) rather than one with
  // capture="environment" — on many mobile browsers that attribute
  // forces the camera app open directly and skips the gallery/file
  // picker entirely, so there'd be no way to pick an existing photo.
  async function handleSignaturePhotoFile(file) {
    if (!file) return;
    try {
      signatureDataUrl = await compressImageFile(file, 1000, 0.85);
      showUploadPreview(signaturePhotoPreview, signaturePhotoPlaceholder, signaturePhotoRemoveBtn, signatureDataUrl);
      signatureExistingHint.style.display = "none";
      markInvalid("signature", false);
      signatureCanvas.classList.remove("gf-invalid");
      el("signatureUploadBox").classList.remove("gf-invalid");
    } catch (e) {
      showBanner("Could not process that photo. Please try a different file.");
      console.error(e);
    }
  }
  signaturePhotoCameraInput.addEventListener("change", () => handleSignaturePhotoFile(signaturePhotoCameraInput.files[0]));
  signaturePhotoGalleryInput.addEventListener("change", () => handleSignaturePhotoFile(signaturePhotoGalleryInput.files[0]));

  signaturePhotoRemoveBtn.addEventListener("click", () => {
    signatureDataUrl = "";
    signaturePhotoCameraInput.value = "";
    signaturePhotoGalleryInput.value = "";
    hideUploadPreview(signaturePhotoPreview, signaturePhotoPlaceholder, signaturePhotoRemoveBtn);
    if (existingSignatureUrl) signatureExistingHint.style.display = "block";
  });

  // --- Signature: Draw / Upload tab switch ---
  function setSignatureMethod(method) {
    signatureMethod = method;
    const isDraw = method === "draw";
    signatureDrawTabBtn.classList.toggle("active", isDraw);
    signatureUploadTabBtn.classList.toggle("active", !isDraw);
    signatureDrawPanel.style.display = isDraw ? "block" : "none";
    signatureUploadPanel.style.display = isDraw ? "none" : "block";
  }
  signatureDrawTabBtn.addEventListener("click", () => setSignatureMethod("draw"));
  signatureUploadTabBtn.addEventListener("click", () => setSignatureMethod("upload"));

  /**
   * Resolves whatever the signature currently is, based on the
   * active method — a freshly drawn canvas image, a freshly
   * uploaded photo, or "" if neither was provided this session.
   */
  function getCurrentSignatureDataUrl() {
    if (signatureMethod === "draw") {
      return hasDrawnSignature ? signatureCanvas.toDataURL("image/png") : "";
    }
    return signatureDataUrl;
  }

  /* ============================================================
   * Auto-capitalize name fields on blur
   * ========================================================== */
  ["lastName", "firstName", "middleName", "emergencyContactPerson"].forEach(id => {
    el(id).addEventListener("blur", () => { el(id).value = toTitleCase(el(id).value); });
  });

  /* ============================================================
   * Initial load — form config from Apps Script + regions from
   * the local static file, fetched in parallel.
   * ========================================================== */
  Promise.all([callApi("getInitialFormData"), callApi("getRegions")])
    .then(([data, regions]) => {

      allRegionsCache = regions;
      homeRegionEl.fill(regions, "Select Region");
      emergencyRegionEl.fill(regions, "Select Region");
      regionOfBirthEl.fill(regions, "Select Region");

      const sv = data.standardValues || {};
      fillSimpleSelect(bloodTypeEl, sv.bloodType || [], "Select Blood Type");
      fillSimpleSelect(civilStatusEl, sv.civilStatus || [], "Select Civil Status");
      fillSimpleSelect(emergencyRelationshipEl, sv.relationship || [], "Select Relationship");
      fillSimpleSelect(countryOfBirthEl, sv.country || [], "Select Country");
      // Country Of Birth defaults to Philippines when present, since
      // this form is aimed at Philippine employees.
      if ((sv.country || []).includes("Philippines")) countryOfBirthEl.value = "Philippines";

      branchClientData = data.branchClientData || [];
      populateBranchOptions();

      validationRules = data.validation || null;

    })
    .catch(err => {
      showBanner("Could not load form data. Please refresh the page.");
      console.error(err);
    });

  /* ============================================================
   * "View/Edit my response" lookup
   * ========================================================== */
  showLookupBtn.addEventListener("click", () => {
    lookupPanel.style.display = lookupPanel.style.display === "none" ? "block" : "none";
  });
  cancelLookupBtn.addEventListener("click", () => {
    lookupPanel.style.display = "none";
    lookupLastNameEl.value = ""; lookupCodeEl.value = "";
    lookupErrorEl.textContent = ""; lookupErrorEl.classList.remove("show");
  });

  function setLookupLoading(isLoading) {
    findEntryBtn.disabled = isLoading;
    lookupSpinner.classList.toggle("show", isLoading);
  }

  function enterEditMode(lastName, referenceCode, hasFullSnapshot) {
    isEditMode = true;
    editReferenceLastName = lastName;
    editReferenceCode = referenceCode;
    editModeCodeEl.textContent = referenceCode;
    editModeBanner.classList.add("show");
    editModeBanner.style.display = "flex";
    if (!hasFullSnapshot) {
      showBanner("This entry was migrated from an older format — please re-check the address and dropdown fields before resubmitting.");
    }
  }

  function exitEditMode() {
    isEditMode = false;
    editReferenceLastName = "";
    editReferenceCode = "";
    editModeBanner.classList.remove("show");
    editModeBanner.style.display = "none";
  }

  exitEditModeBtn.addEventListener("click", () => {
    exitEditMode();
    clearForm();
  });

  findEntryBtn.addEventListener("click", async () => {
    const lastName = lookupLastNameEl.value.trim();
    const code = lookupCodeEl.value.trim();

    lookupErrorEl.textContent = "";
    lookupErrorEl.classList.remove("show");

    if (!lastName || !code) {
      lookupErrorEl.textContent = "Please enter both your last name and reference code.";
      lookupErrorEl.classList.add("show");
      return;
    }

    setLookupLoading(true);

    callApi("getEntryByReference", lastName, code)
      .then(async result => {
        setLookupLoading(false);

        if (!result || result.status !== "success") {
          lookupErrorEl.textContent = (result && result.message) || "No entry found for that last name and reference code.";
          lookupErrorEl.classList.add("show");
          return;
        }

        try {
          await applyEntryToForm(result.data || {});
        } catch (e) {
          console.error(e);
        }

        enterEditMode(lastName, result.referenceCode, result.hasFullSnapshot);

        lookupPanel.style.display = "none";
        lookupLastNameEl.value = "";
        lookupCodeEl.value = "";
        formEl.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(err => {
        setLookupLoading(false);
        lookupErrorEl.textContent = "Something went wrong while looking up your entry. Please try again.";
        lookupErrorEl.classList.add("show");
        console.error(err);
      });
  });

  /**
   * Repopulates every field from a saved submission (the payload
   * shape produced by buildPayload()).
   */
  async function applyEntryToForm(data) {

    el("lastName").value = data.lastName || "";
    el("firstName").value = data.firstName || "";
    el("middleName").value = data.middleName || "";
    el("position").value = data.position || "";
    el("dateHired").value = data.dateHired || "";

    // Branch Assigned -> Client Code (already loaded once at
    // startup, so this is just a local filter — no round trip).
    if (data.branchAssigned) {
      branchAssignedEl.value = data.branchAssigned;
      populateClientCodeOptions(data.branchAssigned, data.clientCode);
    }

    el("contactNumber").value = data.contactNumber || "";

    el("homeStreet").value = data.homeStreet || "";
    el("dateOfBirth").value = data.dateOfBirth || "";
    el("placeOfBirth").value = data.placeOfBirth || "";
    if (data.countryOfBirth) countryOfBirthEl.value = data.countryOfBirth;

    if (data.bloodType) bloodTypeEl.value = data.bloodType;
    if (data.civilStatus) civilStatusEl.value = data.civilStatus;

    // TIN / SSS / PhilHealth / Pag-IBIG — restore via the "I don't
    // have" toggle when the saved value is the shared default,
    // otherwise fill it directly.
    const tinDefault = (validationRules && validationRules.tin.defaultValue) || "000000000";
    const sssDefault = (validationRules && validationRules.sss.defaultValue) || "0000000000";
    const philHealthDefault = (validationRules && validationRules.philHealth.defaultValue) || "000000000000";
    const pagIbigDefault = (validationRules && validationRules.pagIbig.defaultValue) || "000000000000";

    noTinEl.checked = data.tin === tinDefault; applyNoTinToggle();
    if (!noTinEl.checked) tinEl.value = data.tin || "";

    noSssEl.checked = data.sssNo === sssDefault; applyNoSssToggle();
    if (!noSssEl.checked) sssEl.value = data.sssNo || "";

    noPhilHealthEl.checked = data.philHealthNo === philHealthDefault; applyNoPhilHealthToggle();
    if (!noPhilHealthEl.checked) philHealthEl.value = data.philHealthNo || "";

    noPagIbigEl.checked = data.pagIbigNo === pagIbigDefault; applyNoPagIbigToggle();
    if (!noPagIbigEl.checked) pagIbigEl.value = data.pagIbigNo || "";

    // Profile/ID Photo — show the file already on record as a
    // preview; a new upload is only required to replace it.
    profilePhotoDataUrl = "";
    profilePhotoCameraInput.value = ""; profilePhotoGalleryInput.value = "";
    existingProfilePhotoUrl = data.profilePhotoUrl || "";
    if (existingProfilePhotoUrl) {
      showUploadPreview(profilePhotoPreview, profilePhotoPlaceholder, profilePhotoRemoveBtn, existingProfilePhotoUrl);
      profilePhotoRemoveBtn.style.display = "none"; // nothing new to remove yet
      profilePhotoExistingHint.style.display = "block";
    } else {
      hideUploadPreview(profilePhotoPreview, profilePhotoPlaceholder, profilePhotoRemoveBtn);
      profilePhotoExistingHint.style.display = "none";
    }

    // Signature — same idea; defaults to the Upload tab so the
    // existing image can actually be shown (drawing starts blank).
    signatureDataUrl = "";
    signaturePhotoCameraInput.value = ""; signaturePhotoGalleryInput.value = "";
    hasDrawnSignature = false;
    fillSignatureCanvasWhite();
    existingSignatureUrl = data.signatureUrl || "";
    if (existingSignatureUrl) {
      setSignatureMethod("upload");
      showUploadPreview(signaturePhotoPreview, signaturePhotoPlaceholder, signaturePhotoRemoveBtn, existingSignatureUrl);
      signaturePhotoRemoveBtn.style.display = "none";
      signatureExistingHint.style.display = "block";
    } else {
      setSignatureMethod("draw");
      hideUploadPreview(signaturePhotoPreview, signaturePhotoPlaceholder, signaturePhotoRemoveBtn);
      signatureExistingHint.style.display = "none";
    }

    el("emergencyContactPerson").value = data.emergencyContactPerson || "";
    if (data.emergencyRelationship) emergencyRelationshipEl.value = data.emergencyRelationship;
    el("emergencyContactNo").value = data.emergencyContactNo || "";
    el("emergencyStreet").value = data.emergencyStreet || "";

    document.querySelectorAll(".gf-invalid").forEach(f => f.classList.remove("gf-invalid"));
    document.querySelectorAll(".gf-error-text.show").forEach(f => f.classList.remove("show"));

    await Promise.all([
      homeCascade.restore(data.homeRegionCode, data.homeProvinceCode, data.homeCityCode, data.homeBarangayCode),
      emergencyCascade.restore(data.emergencyRegionCode, data.emergencyProvinceCode, data.emergencyCityCode, data.emergencyBarangayCode),
      (async () => {
        if (!data.regionOfBirthCode) return;
        regionOfBirthEl.setValue(data.regionOfBirthCode);
        try {
          const provinces = await callApi("getProvinces", data.regionOfBirthCode);
          if (provinces && provinces.length) {
            birthProvinceLevelExists = true;
            provinceOfBirthEl.enable();
            provinceOfBirthEl.fill(provinces, "Select Province");
            if (data.provinceOfBirthCode) provinceOfBirthEl.setValue(data.provinceOfBirthCode);
          } else {
            birthProvinceLevelExists = false;
            provinceOfBirthEl.reset("N/A for this region");
          }
        } catch (e) { console.error(e); }
      })()
    ]);

  }

  /* ============================================================
   * Validation
   * ========================================================== */
  function validate() {
    let valid = true;

    const requiredText = [
      "lastName", "firstName", "position", "dateHired", "contactNumber",
      "homeStreet", "dateOfBirth", "placeOfBirth",
      "philHealthNo", "pagIbigNo", "sssNo", "tin",
      "emergencyContactPerson", "emergencyContactNo", "emergencyStreet"
    ];
    requiredText.forEach(id => {
      const bad = !el(id).value.trim();
      markInvalid(id, bad);
      if (bad) valid = false;
    });

    const requiredSimpleSelects = ["countryOfBirth", "bloodType", "civilStatus", "emergencyRelationship", "branchAssigned", "clientCode"];
    requiredSimpleSelects.forEach(id => {
      const bad = !el(id).value;
      markInvalid(id, bad);
      if (bad) valid = false;
    });

    // Home Address cascade
    const homeRegionBad = !homeRegionEl.value;
    markInvalid("homeRegion", homeRegionBad);
    if (homeRegionBad) valid = false;
    if (!homeRegionBad) {
      const homeProvinceBad = homeCascade.state.provinceLevelExists && !homeProvinceEl.value;
      markInvalid("homeProvince", homeProvinceBad);
      if (homeProvinceBad) valid = false;
    }
    const homeCityBad = !homeCityEl.value;
    markInvalid("homeCity", homeCityBad);
    if (homeCityBad) valid = false;
    const homeBarangayBad = !homeBarangayEl.value;
    markInvalid("homeBarangay", homeBarangayBad);
    if (homeBarangayBad) valid = false;

    // Emergency Contact Address cascade
    const emgRegionBad = !emergencyRegionEl.value;
    markInvalid("emergencyRegion", emgRegionBad);
    if (emgRegionBad) valid = false;
    if (!emgRegionBad) {
      const emgProvinceBad = emergencyCascade.state.provinceLevelExists && !emergencyProvinceEl.value;
      markInvalid("emergencyProvince", emgProvinceBad);
      if (emgProvinceBad) valid = false;
    }
    const emgCityBad = !emergencyCityEl.value;
    markInvalid("emergencyCity", emgCityBad);
    if (emgCityBad) valid = false;
    const emgBarangayBad = !emergencyBarangayEl.value;
    markInvalid("emergencyBarangay", emgBarangayBad);
    if (emgBarangayBad) valid = false;

    // Region Of Birth / Province Of Birth
    const regionOfBirthBad = !regionOfBirthEl.value;
    markInvalid("regionOfBirth", regionOfBirthBad);
    if (regionOfBirthBad) valid = false;
    if (!regionOfBirthBad) {
      const provinceOfBirthBad = birthProvinceLevelExists && !provinceOfBirthEl.value;
      markInvalid("provinceOfBirth", provinceOfBirthBad);
      if (provinceOfBirthBad) valid = false;
    }

    // Format checks
    if (validationRules) {
      if (!new RegExp(validationRules.mobile.pattern).test(el("contactNumber").value.trim())) { markInvalid("contactNumber", true); valid = false; }
      if (!new RegExp(validationRules.mobile.pattern).test(el("emergencyContactNo").value.trim())) { markInvalid("emergencyContactNo", true); valid = false; }
      if (!new RegExp(validationRules.tin.pattern).test(el("tin").value.trim())) { markInvalid("tin", true); valid = false; }
      if (!new RegExp(validationRules.sss.pattern).test(el("sssNo").value.trim())) { markInvalid("sssNo", true); valid = false; }
      if (!new RegExp(validationRules.philHealth.pattern).test(el("philHealthNo").value.trim())) { markInvalid("philHealthNo", true); valid = false; }
      if (!new RegExp(validationRules.pagIbig.pattern).test(el("pagIbigNo").value.trim())) { markInvalid("pagIbigNo", true); valid = false; }
    }

    // Profile/ID Photo — required unless an existing one is on
    // record (editing without choosing a replacement).
    const profilePhotoBad = !profilePhotoDataUrl && !existingProfilePhotoUrl;
    el("profilePhotoBox").classList.toggle("gf-invalid", profilePhotoBad);
    document.querySelector('[data-error-for="profilePhoto"]').classList.toggle("show", profilePhotoBad);
    if (profilePhotoBad) valid = false;

    // Signature — required unless an existing one is on record.
    const signatureBad = !getCurrentSignatureDataUrl() && !existingSignatureUrl;
    signatureCanvas.classList.toggle("gf-invalid", signatureBad && signatureMethod === "draw");
    el("signatureUploadBox").classList.toggle("gf-invalid", signatureBad && signatureMethod === "upload");
    document.querySelector('[data-error-for="signature"]').classList.toggle("show", signatureBad);
    if (signatureBad) valid = false;

    return valid;
  }

  /* ============================================================
   * Submit
   * ========================================================== */
  function buildPayload() {
    return {
      lastName: toTitleCase(el("lastName").value),
      firstName: toTitleCase(el("firstName").value),
      middleName: toTitleCase(el("middleName").value),
      position: el("position").value.trim(),
      dateHired: el("dateHired").value,
      branchAssigned: branchAssignedEl.value,
      clientCode: clientCodeEl.value,
      // Just a convenience echo — Code.gs always re-resolves the
      // authoritative Client Name from the Branch & Client sheet
      // rather than trusting this value.
      clientName: (branchClientData.find(r => r.branch === branchAssignedEl.value && r.clientCode === clientCodeEl.value) || {}).clientName || "",
      contactNumber: el("contactNumber").value.trim(),

      homeStreet: el("homeStreet").value.trim(),
      homeRegionCode: homeRegionEl.value,
      homeRegionName: homeRegionEl.selectedName,
      homeProvinceCode: homeCascade.state.provinceLevelExists ? homeProvinceEl.value : homeRegionEl.value,
      homeProvinceName: homeCascade.state.provinceLevelExists ? homeProvinceEl.selectedName : homeRegionEl.selectedName,
      homeCityCode: homeCityEl.value,
      homeCityName: homeCityEl.selectedName,
      homeBarangayCode: homeBarangayEl.value,
      homeBarangayName: homeBarangayEl.selectedName,

      dateOfBirth: el("dateOfBirth").value,
      placeOfBirth: el("placeOfBirth").value.trim(),
      regionOfBirthCode: regionOfBirthEl.value,
      regionOfBirthName: regionOfBirthEl.selectedName,
      provinceOfBirthCode: birthProvinceLevelExists ? provinceOfBirthEl.value : regionOfBirthEl.value,
      provinceOfBirthName: birthProvinceLevelExists ? provinceOfBirthEl.selectedName : regionOfBirthEl.selectedName,
      countryOfBirth: countryOfBirthEl.value,

      bloodType: bloodTypeEl.value,
      civilStatus: civilStatusEl.value,

      philHealthNo: el("philHealthNo").value.trim(),
      pagIbigNo: el("pagIbigNo").value.trim(),
      sssNo: el("sssNo").value.trim(),
      tin: el("tin").value.trim(),

      // profilePhotoUrl / signatureUrl are resolved separately via
      // uploadImage() and merged into this payload by the submit
      // handler below — see resolveProfilePhotoUrl()/resolveSignatureUrl().

      emergencyContactPerson: toTitleCase(el("emergencyContactPerson").value),
      emergencyRelationship: emergencyRelationshipEl.value,
      emergencyContactNo: el("emergencyContactNo").value.trim(),

      emergencyStreet: el("emergencyStreet").value.trim(),
      emergencyRegionCode: emergencyRegionEl.value,
      emergencyRegionName: emergencyRegionEl.selectedName,
      emergencyProvinceCode: emergencyCascade.state.provinceLevelExists ? emergencyProvinceEl.value : emergencyRegionEl.value,
      emergencyProvinceName: emergencyCascade.state.provinceLevelExists ? emergencyProvinceEl.selectedName : emergencyRegionEl.selectedName,
      emergencyCityCode: emergencyCityEl.value,
      emergencyCityName: emergencyCityEl.selectedName,
      emergencyBarangayCode: emergencyBarangayEl.value,
      emergencyBarangayName: emergencyBarangayEl.selectedName,

      referenceLastName: isEditMode ? editReferenceLastName : "",
      referenceCode: isEditMode ? editReferenceCode : ""
    };
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    spinner.classList.toggle("show", isSubmitting);
  }

  function makeFilenameBase(suffix) {
    const safeName = toTitleCase(el("lastName").value).replace(/[^a-zA-Z0-9]+/g, "_") || "employee";
    return `${Date.now()}_${safeName}_${suffix}`;
  }

  /**
   * Uploads the Profile/ID Photo if a new one was chosen this
   * session, and returns the URL to submit — either the freshly
   * uploaded one, or whatever was already on record (unchanged).
   * Successfully uploaded URLs are cached into
   * existingProfilePhotoUrl, so retrying after a later failure
   * (e.g. the final submitForm call) won't re-upload the same image.
   */
  async function resolveProfilePhotoUrl() {
    if (!profilePhotoDataUrl) return existingProfilePhotoUrl;
    const result = await callApi("uploadImage", {
      folderType: "profile",
      dataUrl: profilePhotoDataUrl,
      filenameBase: makeFilenameBase("profile")
    });
    if (!result || result.status !== "success") {
      throw new Error((result && result.message) || "Could not upload the Profile/ID photo.");
    }
    existingProfilePhotoUrl = result.url;
    profilePhotoDataUrl = "";
    return existingProfilePhotoUrl;
  }

  /** Same idea as resolveProfilePhotoUrl(), for the signature. */
  async function resolveSignatureUrl() {
    const fresh = getCurrentSignatureDataUrl();
    if (!fresh) return existingSignatureUrl;
    const result = await callApi("uploadImage", {
      folderType: "signature",
      dataUrl: fresh,
      filenameBase: makeFilenameBase("signature")
    });
    if (!result || result.status !== "success") {
      throw new Error((result && result.message) || "Could not upload the signature.");
    }
    existingSignatureUrl = result.url;
    signatureDataUrl = "";
    hasDrawnSignature = false;
    return existingSignatureUrl;
  }

  submitBtn.addEventListener("click", async () => {
    hideBanner();

    if (!validate()) {
      showBanner("Please fix the highlighted fields before submitting.");
      return;
    }

    setSubmitting(true);

    try {

      // Images are uploaded as their own separate, fast requests
      // first — keeping the final submitForm call itself quick
      // (just a sheet write). Combining slow Drive uploads with the
      // sheet write in a single request is what previously caused
      // occasional "Could not submit" errors even though the entry
      // had actually already been saved.
      submitBtnLabel.textContent = "Uploading photo\u2026";
      const profilePhotoUrl = await resolveProfilePhotoUrl();

      submitBtnLabel.textContent = "Uploading signature\u2026";
      const signatureUrl = await resolveSignatureUrl();

      submitBtnLabel.textContent = "Saving\u2026";
      const payload = buildPayload();
      payload.profilePhotoUrl = profilePhotoUrl;
      payload.signatureUrl = signatureUrl;

      const result = await callApi("submitForm", payload);

      setSubmitting(false);
      submitBtnLabel.textContent = "Submit";

      if (result.status === "success") {
        successTitleEl.textContent = result.message || "This entry has been recorded";
        successReferenceCodeEl.textContent = result.referenceCode || "";
        successLastNameEl.textContent = result.lastName || "";
        exitEditMode();
        formEl.style.display = "none";
        successCard.classList.add("show");
      } else {
        showBanner(result.message || "Something went wrong. Please try again.");
      }

    } catch (err) {

      setSubmitting(false);
      submitBtnLabel.textContent = "Submit";
      showBanner(err.message || "Could not submit the form. Please check your connection and try again.");
      console.error(err);

    }

  });

  copyReferenceBtn.addEventListener("click", () => {
    const code = successReferenceCodeEl.textContent;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      copyReferenceBtn.textContent = "Copied!";
      copyReferenceBtn.classList.add("copied");
      setTimeout(() => {
        copyReferenceBtn.textContent = "Copy";
        copyReferenceBtn.classList.remove("copied");
      }, 2000);
    }).catch(() => {});
  });

  /* ============================================================
   * Clear / submit another
   * ========================================================== */
  function clearForm() {
    formEl.reset();
    document.querySelectorAll(".gf-invalid").forEach(f => f.classList.remove("gf-invalid"));
    document.querySelectorAll(".gf-error-text.show").forEach(f => f.classList.remove("show"));
    // formEl.reset() only clears the comboboxes' visible input text —
    // their internal selected-value state needs resetting explicitly,
    // unlike a native <select> which resets its value automatically.
    homeRegionEl.reset("Select Region");
    homeProvinceEl.reset("Select Region first");
    homeCityEl.reset("Select Province first");
    homeBarangayEl.reset("Select City/Municipality first");
    emergencyRegionEl.reset("Select Region");
    emergencyProvinceEl.reset("Select Region first");
    emergencyCityEl.reset("Select Province first");
    emergencyBarangayEl.reset("Select City/Municipality first");
    regionOfBirthEl.reset("Select Region");
    provinceOfBirthEl.reset("Select Region Of Birth first");
    // Region-level comboboxes need their full option list refilled
    // immediately after reset (unlike Province/City/Barangay, which
    // stay empty until their parent is picked again).
    populateRegionCombobox(homeRegionEl);
    populateRegionCombobox(emergencyRegionEl);
    populateRegionCombobox(regionOfBirthEl);
    homeQuickSearchEl.value = "";
    emergencyQuickSearchEl.value = "";
    resetSelect(clientCodeEl, "Select Branch Assigned first");
    clientNameHintEl.style.display = "none";
    tinEl.disabled = false; sssEl.disabled = false; philHealthEl.disabled = false; pagIbigEl.disabled = false;

    profilePhotoDataUrl = ""; existingProfilePhotoUrl = "";
    hideUploadPreview(profilePhotoPreview, profilePhotoPlaceholder, profilePhotoRemoveBtn);
    profilePhotoExistingHint.style.display = "none";

    signatureDataUrl = ""; existingSignatureUrl = ""; hasDrawnSignature = false;
    fillSignatureCanvasWhite();
    hideUploadPreview(signaturePhotoPreview, signaturePhotoPlaceholder, signaturePhotoRemoveBtn);
    signatureExistingHint.style.display = "none";
    setSignatureMethod("draw");

    hideBanner();
  }

  clearBtn.addEventListener("click", clearForm);

  submitAnotherBtn.addEventListener("click", () => {
    clearForm();
    exitEditMode();
    successCard.classList.remove("show");
    formEl.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

})();
