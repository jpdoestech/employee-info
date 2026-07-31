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

  // Home address cascade
  const homeRegionEl = el("homeRegion"), homeProvinceEl = el("homeProvince"),
        homeCityEl = el("homeCity"), homeBarangayEl = el("homeBarangay");

  // Emergency contact address cascade
  const emergencyRegionEl = el("emergencyRegion"), emergencyProvinceEl = el("emergencyProvince"),
        emergencyCityEl = el("emergencyCity"), emergencyBarangayEl = el("emergencyBarangay");

  // Birth region/province (no city/barangay level, matches the
  // original intake form's Birth Information feature)
  const regionOfBirthEl = el("regionOfBirth"), provinceOfBirthEl = el("provinceOfBirth"),
        countryOfBirthEl = el("countryOfBirth");

  const bloodTypeEl = el("bloodType"), civilStatusEl = el("civilStatus"),
        emergencyRelationshipEl = el("emergencyRelationship");

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
      const regionName = selectedName(regionEl);
      resetSelect(provinceEl, "Loading provinces\u2026");
      resetSelect(cityEl, "Select Province first");
      resetSelect(barangayEl, "Select City/Municipality first");

      if (!regionCode) { resetSelect(provinceEl, "Select Region first"); return; }

      callApi("getProvinces", regionCode)
        .then(provinces => {
          if (provinces && provinces.length) {
            state.provinceLevelExists = true;
            provinceEl.disabled = false;
            fillSelect(provinceEl, provinces, "Select Province");
          } else {
            // Province-less region (e.g. NCR): use the region itself
            // as the "province" value so the field still carries a
            // value instead of submitting empty and failing the
            // required-field check server-side.
            state.provinceLevelExists = false;
            fillSelect(provinceEl, [{ code: regionCode, name: regionName }], "N/A for this region");
            provinceEl.value = regionCode;
            provinceEl.disabled = true;
            loadCitiesForRegion(regionCode);
          }
        })
        .catch(err => { showBanner("Could not load provinces."); console.error(err); });
    }

    function loadCitiesForRegion(regionCode) {
      resetSelect(cityEl, "Loading cities\u2026");
      callApi("getCitiesForRegion", regionCode)
        .then(cities => {
          if (cities && cities.length) { cityEl.disabled = false; fillSelect(cityEl, cities, "Select City/Municipality"); }
          else { resetSelect(cityEl, "No cities found \u2014 contact support"); }
        })
        .catch(err => { showBanner("Could not load cities."); console.error(err); });
    }

    function onProvinceChange() {
      const provinceCode = provinceEl.value;
      resetSelect(cityEl, "Loading cities\u2026");
      resetSelect(barangayEl, "Select City/Municipality first");

      if (!provinceCode) { resetSelect(cityEl, "Select Province first"); return; }

      callApi("getCities", provinceCode)
        .then(cities => { cityEl.disabled = false; fillSelect(cityEl, cities, "Select City/Municipality"); })
        .catch(err => { showBanner("Could not load cities."); console.error(err); });
    }

    function onCityChange() {
      const cityCode = cityEl.value;
      resetSelect(barangayEl, "Loading barangays\u2026");

      if (!cityCode) { resetSelect(barangayEl, "Select City/Municipality first"); return; }

      callApi("getBarangays", cityCode)
        .then(barangays => { barangayEl.disabled = false; fillSelect(barangayEl, barangays, "Select Barangay"); })
        .catch(err => { showBanner("Could not load barangays."); console.error(err); });
    }

    regionEl.addEventListener("change", onRegionChange);
    provinceEl.addEventListener("change", onProvinceChange);
    cityEl.addEventListener("change", onCityChange);

    /**
     * Restores a saved cascade (Region -> Province -> City ->
     * Barangay) during "view/edit my response", awaiting each
     * level before loading the next.
     */
    async function restore(regionCode, provinceCode, cityCode, barangayCode) {
      if (!regionCode) return;
      regionEl.value = regionCode;
      const regionName = selectedName(regionEl);

      try {
        const provinces = await callApi("getProvinces", regionCode);
        if (provinces && provinces.length) {
          state.provinceLevelExists = true;
          provinceEl.disabled = false;
          fillSelect(provinceEl, provinces, "Select Province");
          if (provinceCode) provinceEl.value = provinceCode;
        } else {
          state.provinceLevelExists = false;
          fillSelect(provinceEl, [{ code: regionCode, name: regionName }], "N/A for this region");
          provinceEl.value = regionCode;
          provinceEl.disabled = true;
        }

        const cities = state.provinceLevelExists
          ? await callApi("getCities", provinceCode)
          : await callApi("getCitiesForRegion", regionCode);

        if (cities && cities.length) {
          cityEl.disabled = false;
          fillSelect(cityEl, cities, "Select City/Municipality");
          if (cityCode) cityEl.value = cityCode;
        }

        if (cityCode) {
          const barangays = await callApi("getBarangays", cityCode);
          if (barangays && barangays.length) {
            barangayEl.disabled = false;
            fillSelect(barangayEl, barangays, "Select Barangay");
            if (barangayCode) barangayEl.value = barangayCode;
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
   * Region Of Birth -> Province Of Birth (no City/Barangay level,
   * matches the original form's Birth Information feature)
   * ========================================================== */
  let birthProvinceLevelExists = true;

  regionOfBirthEl.addEventListener("change", () => {
    const regionCode = regionOfBirthEl.value;
    const regionName = selectedName(regionOfBirthEl);
    resetSelect(provinceOfBirthEl, "Loading provinces\u2026");

    if (!regionCode) { resetSelect(provinceOfBirthEl, "Select Region Of Birth first"); return; }

    callApi("getProvinces", regionCode)
      .then(provinces => {
        if (provinces && provinces.length) {
          birthProvinceLevelExists = true;
          provinceOfBirthEl.disabled = false;
          fillSelect(provinceOfBirthEl, provinces, "Select Province");
        } else {
          // Province-less region (e.g. NCR): use the region itself as
          // the "province" value so the field still carries a value.
          birthProvinceLevelExists = false;
          fillSelect(provinceOfBirthEl, [{ code: regionCode, name: regionName }], "N/A for this region");
          provinceOfBirthEl.value = regionCode;
          provinceOfBirthEl.disabled = true;
        }
      })
      .catch(err => { showBanner("Could not load provinces for Region Of Birth."); console.error(err); });
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

      fillSelect(homeRegionEl, regions, "Select Region");
      fillSelect(emergencyRegionEl, regions, "Select Region");
      fillSelect(regionOfBirthEl, regions, "Select Region");

      const sv = data.standardValues || {};
      fillSimpleSelect(bloodTypeEl, sv.bloodType || [], "Select Blood Type");
      fillSimpleSelect(civilStatusEl, sv.civilStatus || [], "Select Civil Status");
      fillSimpleSelect(emergencyRelationshipEl, sv.relationship || [], "Select Relationship");
      fillSimpleSelect(countryOfBirthEl, sv.country || [], "Select Country");
      // Country Of Birth defaults to Philippines when present, since
      // this form is aimed at Philippine employees.
      if ((sv.country || []).includes("Philippines")) countryOfBirthEl.value = "Philippines";

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
        regionOfBirthEl.value = data.regionOfBirthCode;
        try {
          const provinces = await callApi("getProvinces", data.regionOfBirthCode);
          if (provinces && provinces.length) {
            birthProvinceLevelExists = true;
            provinceOfBirthEl.disabled = false;
            fillSelect(provinceOfBirthEl, provinces, "Select Province");
            if (data.provinceOfBirthCode) provinceOfBirthEl.value = data.provinceOfBirthCode;
          } else {
            birthProvinceLevelExists = false;
            resetSelect(provinceOfBirthEl, "N/A for this region");
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

    const requiredSimpleSelects = ["countryOfBirth", "bloodType", "civilStatus", "emergencyRelationship"];
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
      contactNumber: el("contactNumber").value.trim(),

      homeStreet: el("homeStreet").value.trim(),
      homeRegionCode: homeRegionEl.value,
      homeRegionName: selectedName(homeRegionEl),
      homeProvinceCode: homeCascade.state.provinceLevelExists ? homeProvinceEl.value : homeRegionEl.value,
      homeProvinceName: homeCascade.state.provinceLevelExists ? selectedName(homeProvinceEl) : selectedName(homeRegionEl),
      homeCityCode: homeCityEl.value,
      homeCityName: selectedName(homeCityEl),
      homeBarangayCode: homeBarangayEl.value,
      homeBarangayName: selectedName(homeBarangayEl),

      dateOfBirth: el("dateOfBirth").value,
      placeOfBirth: el("placeOfBirth").value.trim(),
      regionOfBirthCode: regionOfBirthEl.value,
      regionOfBirthName: selectedName(regionOfBirthEl),
      provinceOfBirthCode: birthProvinceLevelExists ? provinceOfBirthEl.value : regionOfBirthEl.value,
      provinceOfBirthName: birthProvinceLevelExists ? selectedName(provinceOfBirthEl) : selectedName(regionOfBirthEl),
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
      emergencyRegionName: selectedName(emergencyRegionEl),
      emergencyProvinceCode: emergencyCascade.state.provinceLevelExists ? emergencyProvinceEl.value : emergencyRegionEl.value,
      emergencyProvinceName: emergencyCascade.state.provinceLevelExists ? selectedName(emergencyProvinceEl) : selectedName(emergencyRegionEl),
      emergencyCityCode: emergencyCityEl.value,
      emergencyCityName: selectedName(emergencyCityEl),
      emergencyBarangayCode: emergencyBarangayEl.value,
      emergencyBarangayName: selectedName(emergencyBarangayEl),

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
    resetSelect(homeProvinceEl, "Select Region first");
    resetSelect(homeCityEl, "Select Province first");
    resetSelect(homeBarangayEl, "Select City/Municipality first");
    resetSelect(emergencyProvinceEl, "Select Region first");
    resetSelect(emergencyCityEl, "Select Province first");
    resetSelect(emergencyBarangayEl, "Select City/Municipality first");
    resetSelect(provinceOfBirthEl, "Select Region Of Birth first");
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
