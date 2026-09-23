"use strict";

let cacheDurationMs = 10 * 60 * 1000;
let currentUnit = "C";
let currentLang = "auto";
let customDict = null;
let currentWeatherData = null;
let requestCounter = 0; // ignore les réponses d'une recherche périmée

const ext = typeof browser !== "undefined" ? browser : chrome;
const storage = ext.storage.local;
const i18n = ext.i18n;
const runtime = ext.runtime;

const DAILY_LIMIT = 1000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // purge du cache après 24 h
const CACHE_MAX_ENTRIES = 10; // nombre max de villes conservées
const FETCH_TIMEOUT_MS = 8000;
const API_BASE = "https://api.openweathermap.org/data/2.5";

// MV3 => action ; MV2 => browserAction
const actionAPI = ext.action || ext.browserAction || null;

/* -------------------------------------------------------------------------- */
/*  i18n                                                                      */
/* -------------------------------------------------------------------------- */

// Charge le dictionnaire JSON si une langue spécifique est sélectionnée
async function loadLanguage(lang) {
  currentLang = lang;
  customDict = null;
  if (lang === "auto") return;
  try {
    const res = await fetch(runtime.getURL(`_locales/${lang}/messages.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    customDict = await res.json();
  } catch (e) {
    console.error("Chargement de la langue impossible :", e);
    customDict = null;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\@]/g, "\\$&");
}

// Traduction sur-mesure (fallback sur l'API i18n native + placeholders)
function getMessage(key, subs = []) {
  if (!Array.isArray(subs)) subs = [subs];

  const entry = customDict?.[key];
  if (entry && typeof entry.message === "string") {
    let text = entry.message;
    for (const [name, def] of Object.entries(entry.placeholders || {})) {
      const content = String(def?.content ?? "");
      const m = content.match(/^\$(\d)$/);
      const value = m ? subs[parseInt(m[1], 10) - 1] : content;
      if (value === undefined) continue;
      // Les noms de placeholders sont insensibles à la casse ; fonction de
      // remplacement pour éviter l'interprétation de "$&" & co dans la valeur.
      text = text.replace(new RegExp(`\\$${escapeRegExp(name)}\\$`, "gi"), () => String(value));
    }
    return text.replace(/\$\$/g, "$");
  }
  return i18n.getMessage(key, subs);
}

// Message traduit, avec texte de repli si la clé n'existe pas encore
function t(key, fallback = "", subs = []) {
  return getMessage(key, subs) || fallback;
}

function getApiLang() {
  if (currentLang !== "auto") return currentLang;
  const uiLang = i18n.getUILanguage().toLowerCase();
  return uiLang.startsWith("fr") ? "fr" : "en";
}

// Locale pour les formats de dates/heures/nombres : langue choisie dans l'app,
// sinon locale complète du navigateur (ex. "en-GB" garde son format 24 h)
function getLocale() {
  return currentLang === "auto" ? i18n.getUILanguage() : currentLang;
}

// Application globale de l'i18n au DOM
function localizeUI() {
  document.documentElement.lang = getApiLang();

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = getMessage(el.getAttribute("data-i18n"));
    if (msg) el.textContent = msg;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const msg = getMessage(el.getAttribute("data-i18n-placeholder"));
    if (msg) el.setAttribute("placeholder", msg);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const msg = getMessage(el.getAttribute("data-i18n-title"));
    if (msg) el.setAttribute("title", msg);
  });

  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const msg = getMessage(el.getAttribute("data-i18n-alt"));
    if (msg) el.setAttribute("alt", msg);
  });
}

/* -------------------------------------------------------------------------- */
/*  Éléments UI                                                               */
/* -------------------------------------------------------------------------- */

const mainView = document.getElementById("main-view");
const settingsView = document.getElementById("settings-view");
const apiModal = document.getElementById("api-modal");

const btnSettings = document.getElementById("btn-settings");
const btnBack = document.getElementById("btn-back");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnSaveModal = document.getElementById("btn-save-modal");
const unitCBtn = document.getElementById("unit-c");
const unitFBtn = document.getElementById("unit-f");
const btnReload = document.getElementById("btn-reload-weather");

const apiKeyInput = document.getElementById("api-key-input");
const modalApiKeyInput = document.getElementById("modal-api-key-input");
const cacheDurationSelect = document.getElementById("cache-duration-select");
const langSelect = document.getElementById("lang-select");
const settingsStatus = document.getElementById("settings-status");
const modalStatus = document.getElementById("modal-status");

const cityInput = document.getElementById("city");
const statusMsg = document.getElementById("status-msg");
const weatherContent = document.getElementById("weather-content");

const cityNameEl = document.getElementById("city-name");
const tempMainEl = document.getElementById("temp-main");
const weatherIconEl = document.getElementById("weather-icon");
const tempRangeEl = document.getElementById("temp-range");
const forecastEl = document.getElementById("forecast");

const feelsLikeEl = document.getElementById("feels-like");
const humidityEl = document.getElementById("humidity");
const windSpeedEl = document.getElementById("wind-speed");
const pressureEl = document.getElementById("pressure");
const precip3hEl = document.getElementById("precip-3h");
const visibilityEl = document.getElementById("visibility");
const sunriseEl = document.getElementById("sunrise");
const sunsetEl = document.getElementById("sunset");
const lastUpdateEl = document.getElementById("last-update");

const quotaProgressEl = document.getElementById("quota-progress");
const quotaTextEl = document.getElementById("quota-text");

function showStatus(message) {
  if (weatherContent) weatherContent.style.display = "none";
  if (statusMsg) {
    statusMsg.style.display = "block";
    statusMsg.textContent = message;
  }
}

function setupEyeToggle(inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(toggleBtnId);
  if (!input || !btn) return;

  btn.addEventListener("click", () => {
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    btn.classList.toggle("revealed", reveal); // bascule d'icône gérée en CSS
    btn.setAttribute("aria-pressed", String(reveal));
  });
}

setupEyeToggle("api-key-input", "toggle-key-settings");
setupEyeToggle("modal-api-key-input", "toggle-key-modal");

btnReload?.addEventListener("click", async () => {
  const currentCity = cityInput?.value.trim() || currentWeatherData?.current?.name;
  if (!currentCity) return;
  btnReload.classList.add("spinning");
  try {
    await getWeather(currentCity, true);
  } finally {
    btnReload.classList.remove("spinning");
  }
});

/* -------------------------------------------------------------------------- */
/*  Unités                                                                    */
/* -------------------------------------------------------------------------- */

function convertTemp(tempCelsius) {
  return currentUnit === "F" ? Math.round((tempCelsius * 9) / 5 + 32) : Math.round(tempCelsius);
}

function rerender() {
  if (!currentWeatherData) return;
  const { current, forecast, timestamp, isFromCache, isOffline } = currentWeatherData;
  updateWeatherUI(current, forecast, timestamp, isFromCache, isOffline);
}

function setUnitUI(unit, persist = false) {
  currentUnit = unit === "F" ? "F" : "C";
  unitCBtn?.classList.toggle("active", currentUnit === "C");
  unitFBtn?.classList.toggle("active", currentUnit === "F");
  unitCBtn?.setAttribute("aria-pressed", String(currentUnit === "C"));
  unitFBtn?.setAttribute("aria-pressed", String(currentUnit === "F"));

  // Sans persistance immédiate, l'unité affichée (et le badge) divergeait
  // de celle stockée si l'utilisateur quittait les paramètres sans enregistrer.
  if (persist) storage.set({ unit: currentUnit });

  rerender(); // rafraîchissement instantané si des données existent
}

unitCBtn?.addEventListener("click", () => setUnitUI("C", true));
unitFBtn?.addEventListener("click", () => setUnitUI("F", true));

/* -------------------------------------------------------------------------- */
/*  Paramètres, quota                                                         */
/* -------------------------------------------------------------------------- */

async function getApiKey() {
  const store = await storage.get("apiKey");
  return store.apiKey || null;
}

async function loadSettings() {
  const store = await storage.get(["unit", "cacheDuration", "apiKey", "appLang"]);
  setUnitUI(store.unit || "C");

  currentLang = store.appLang || "auto";
  if (langSelect) langSelect.value = currentLang;
  await loadLanguage(currentLang);
  localizeUI();

  const duration = Number(store.cacheDuration) || 10;
  if (cacheDurationSelect) cacheDurationSelect.value = String(duration);
  cacheDurationMs = duration * 60 * 1000;

  if (store.apiKey && apiKeyInput) {
    apiKeyInput.value = store.apiKey;
  }
}

function updateEstimation() {
  if (!cacheDurationSelect) return;
  const durationMin = parseInt(cacheDurationSelect.value, 10) || 10;
  const total = Math.round((24 * 60) / durationMin) * 2;
  const estContainer = document.getElementById("api-estimation");
  if (estContainer) {
    estContainer.textContent = getMessage("estimation_text", [total.toString()]);
  }
}

// Clé du quota : jour UTC (OpenWeather réinitialise ses compteurs à 00:00 UTC)
function quotaKeyForToday() {
  return `quota_${new Date().toISOString().slice(0, 10)}`;
}

async function updateQuotaUI() {
  const todayKey = quotaKeyForToday();
  const store = await storage.get(null); // Récupère tout pour nettoyer les clés obsolètes

  // Nettoyage des anciens quotas
  const keysToRemove = Object.keys(store).filter((k) => k.startsWith("quota_") && k !== todayKey);
  if (keysToRemove.length > 0) {
    await storage.remove(keysToRemove);
  }

  const callsCount = store[todayKey] || 0;

  if (quotaTextEl) {
    quotaTextEl.textContent = getMessage("quota_text", [callsCount.toString()]);
  }
  if (quotaProgressEl) {
    const pct = Math.min(100, Math.round((callsCount / DAILY_LIMIT) * 100));
    quotaProgressEl.style.width = `${pct}%`;
    quotaProgressEl.className = "quota-progress";
    if (pct >= 90) quotaProgressEl.classList.add("danger");
    else if (pct >= 70) quotaProgressEl.classList.add("warning");
  }
}

async function incrementDailyCalls(count = 1) {
  const todayKey = quotaKeyForToday();
  const store = await storage.get(todayKey);
  await storage.set({ [todayKey]: (store[todayKey] || 0) + count });
}

async function loadDefaultCity() {
  const store = await storage.get("lastCity");
  const city = store.lastCity || "Paris";
  if (cityInput) cityInput.value = city;
  await getWeather(city);
}

async function openSettings() {
  await loadSettings();
  updateEstimation();
  await updateQuotaUI();
  if (settingsStatus) {
    settingsStatus.textContent = "";
    settingsStatus.className = "settings-status";
  }

  if (mainView) mainView.style.display = "none";
  if (settingsView) settingsView.style.display = "block";
}

cacheDurationSelect?.addEventListener("change", updateEstimation);

async function closeSettings() {
  if (settingsView) settingsView.style.display = "none";
  if (mainView) mainView.style.display = "block";

  if (currentWeatherData) {
    rerender();
  } else {
    loadDefaultCity();
  }
}

btnSettings?.addEventListener("click", openSettings);
btnBack?.addEventListener("click", closeSettings);

btnSaveSettings?.addEventListener("click", async () => {
  const key = apiKeyInput ? apiKeyInput.value.trim() : "";
  if (!key) {
    if (settingsStatus) {
      settingsStatus.textContent = getMessage("status_enter_valid_key");
      settingsStatus.className = "settings-status error";
    }
    return;
  }

  const durationMin = parseInt(cacheDurationSelect?.value, 10) || 10;
  cacheDurationMs = durationMin * 60 * 1000;
  const selectedLang = langSelect ? langSelect.value : "auto";

  await storage.set({
    apiKey: key,
    unit: currentUnit,
    cacheDuration: durationMin,
    appLang: selectedLang
  });

  await loadLanguage(selectedLang);
  localizeUI();

  if (settingsStatus) {
    settingsStatus.textContent = getMessage("status_saved");
    settingsStatus.className = "settings-status success";
  }

  setTimeout(() => closeSettings(), 600);
});

btnSaveModal?.addEventListener("click", async () => {
  const key = modalApiKeyInput ? modalApiKeyInput.value.trim() : "";
  if (!key) {
    if (modalStatus) {
      modalStatus.textContent = getMessage("status_enter_valid_key");
      modalStatus.className = "settings-status error";
    }
    return;
  }

  await storage.set({ apiKey: key });
  if (apiKeyInput) apiKeyInput.value = key;
  if (modalStatus) {
    modalStatus.textContent = "";
    modalStatus.className = "settings-status";
  }
  if (apiModal) apiModal.style.display = "none";
  loadDefaultCity();
});

// Validation au clavier (Entrée)
modalApiKeyInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) btnSaveModal?.click();
});
apiKeyInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) btnSaveSettings?.click();
});

// "keypress" est déprécié : on utilise "keydown"
cityInput?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const city = cityInput.value.trim();
  if (city) getWeather(city);
});

/* -------------------------------------------------------------------------- */
/*  Appels API & cache                                                        */
/* -------------------------------------------------------------------------- */

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    // OpenWeather renvoie déjà "cod" ; sinon on retombe sur le statut HTTP
    return { cod: res.status, ...data };
  } finally {
    clearTimeout(timer);
  }
}

// Distingue clé invalide / quota / ville introuvable (avant : tout donnait
// "ville introuvable", y compris pour une clé API invalide).
function apiErrorMessage(cod, notFoundKey) {
  switch (Number(cod)) {
    case 401:
      return t("status_invalid_key", "Clé API invalide ou pas encore activée.");
    case 429:
      return t("status_rate_limit", "Quota API dépassé, réessayez plus tard.");
    case 404:
      return getMessage(notFoundKey);
    default:
      return getMessage("status_offline_error");
  }
}

// Empêche le cache de grossir indéfiniment dans storage.local
function pruneCache(cache, now) {
  const entries = Object.entries(cache)
    .filter(([, v]) => v && now - v.timestamp < CACHE_MAX_AGE_MS)
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
    .slice(0, CACHE_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

async function getWeather(city, forceRefresh = false) {
  const requestId = ++requestCounter;
  const apiKey = await getApiKey();

  if (!apiKey) {
    if (apiModal) apiModal.style.display = "flex";
    return;
  }

  showStatus(getMessage("status_loading"));

  const cityKey = city.toLowerCase();
  const encodedCity = encodeURIComponent(city);
  const now = Date.now();
  const lang = getApiLang();

  const store = await storage.get("weatherCache");
  if (requestId !== requestCounter) return;
  const cache = store.weatherCache || {};
  const cachedData = cache[cityKey];

  if (!navigator.onLine) {
    if (cachedData) {
      updateWeatherUI(cachedData.current, cachedData.forecast, cachedData.timestamp, true, true);
      await storage.set({ lastCity: cachedData.current.name });
    } else {
      showStatus(getMessage("status_offline_no_data"));
    }
    return;
  }

  // Le cache n'est valable que dans la même langue (descriptions traduites par l'API)
  const cacheIsFresh =
    cachedData && cachedData.lang === lang && now - cachedData.timestamp < cacheDurationMs;

  if (!forceRefresh && cacheIsFresh) {
    updateWeatherUI(cachedData.current, cachedData.forecast, cachedData.timestamp, true, false);
    await storage.set({ lastCity: cachedData.current.name });
    return;
  }

  try {
    const params = `units=metric&appid=${encodeURIComponent(apiKey)}&lang=${lang}`;

    const dataCurrent = await fetchJson(`${API_BASE}/weather?q=${encodedCity}&${params}`);
    if (requestId !== requestCounter) return;
    if (Number(dataCurrent.cod) !== 200) {
      showStatus(apiErrorMessage(dataCurrent.cod, "status_city_not_found"));
      return;
    }
    await incrementDailyCalls(1);

    const dataForecast = await fetchJson(`${API_BASE}/forecast?q=${encodedCity}&${params}`);
    if (requestId !== requestCounter) return;
    if (Number(dataForecast.cod) !== 200) {
      showStatus(apiErrorMessage(dataForecast.cod, "status_forecast_error"));
      return;
    }
    await incrementDailyCalls(1);

    cache[cityKey] = { timestamp: now, lang, current: dataCurrent, forecast: dataForecast };

    await storage.set({
      weatherCache: pruneCache(cache, now),
      lastCity: dataCurrent.name
    });

    updateWeatherUI(dataCurrent, dataForecast, now, false, false);
  } catch (err) {
    if (requestId !== requestCounter) return;
    console.error("Erreur météo détaillée :", err);
    if (cachedData) {
      updateWeatherUI(cachedData.current, cachedData.forecast, cachedData.timestamp, true, true);
    } else {
      showStatus(getMessage("status_offline_error"));
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Affichage                                                                 */
/* -------------------------------------------------------------------------- */

function updateBadgeAndTitle(current) {
  if (!actionAPI) return;

  const temp = `${convertTemp(current.main.temp)}°${currentUnit}`;
  const desc = current.weather?.[0]?.description || "";
  const descFormat = desc.charAt(0).toUpperCase() + desc.slice(1);

  actionAPI.setBadgeText({ text: `${convertTemp(current.main.temp)}°` });
  actionAPI.setBadgeBackgroundColor({ color: "#0284c7" });
  actionAPI.setTitle({ title: `${current.name} : ${temp}${descFormat ? ", " + descFormat : ""}` });
}

function formatNumber(value, maxDecimals = 1) {
  return value.toLocaleString(getLocale(), { maximumFractionDigits: maxDecimals });
}

// Heure locale de la VILLE (et non celle de l'utilisateur) : on décale le
// timestamp du fuseau de la ville puis on lit le résultat en UTC.
function cityDate(unixSec, tzOffsetSec = 0) {
  return new Date((unixSec + tzOffsetSec) * 1000);
}

function formatCityTime(unixSec, tzOffsetSec = 0) {
  return cityDate(unixSec, tzOffsetSec).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  });
}

// Min/Max : /weather donne les écarts entre stations météo (pas le min/max du
// jour). On les calcule donc sur les prochaines 24 h de /forecast.
function computeTempRange(current, forecast) {
  const next24h = (forecast?.list || []).slice(0, 8);
  if (next24h.length === 0) {
    return { min: current.main.temp_min, max: current.main.temp_max };
  }
  const temps = [current.main.temp];
  next24h.forEach((i) => temps.push(i.main.temp_min, i.main.temp_max));
  return { min: Math.min(...temps), max: Math.max(...temps) };
}

// /weather ne fournit en général que rain.1h ; le volume sur 3 h vient du
// prochain créneau de /forecast (arrondi pour éviter 0.30000000000000004).
function computePrecip3h(current, forecast) {
  const src = forecast?.list?.[0] ?? current;
  const rain = src.rain?.["3h"] ?? src.rain?.["1h"] ?? 0;
  const snow = src.snow?.["3h"] ?? src.snow?.["1h"] ?? 0;
  return Math.round((rain + snow) * 10) / 10;
}

// Un point par jour (les 3 prochains jours de la ville), le plus proche de 12 h
// heure locale de la ville.
function pickDailyForecasts(forecast, count = 3) {
  const tz = forecast.city?.timezone ?? 0;
  const todayKey = cityDate(Date.now() / 1000, tz).toISOString().slice(0, 10);
  const byDay = new Map();

  for (const item of forecast.list) {
    const date = cityDate(item.dt, tz);
    const dayKey = date.toISOString().slice(0, 10);
    if (dayKey <= todayKey) continue;

    const distance = Math.abs(date.getUTCHours() - 12);
    const best = byDay.get(dayKey);
    if (!best || distance < best.distance) {
      byDay.set(dayKey, { item, date, distance });
    }
  }
  return [...byDay.values()].slice(0, count);
}

function renderForecast(forecast) {
  if (!forecastEl) return;
  forecastEl.replaceChildren();
  if (!forecast?.list) return;

  for (const { item, date } of pickDailyForecasts(forecast)) {
    const w = item.weather?.[0];
    if (!w) continue;

    const dayEl = document.createElement("div");
    dayEl.className = "forecast-item";

    const nameEl = document.createElement("div");
    nameEl.className = "forecast-day";
    nameEl.textContent = date.toLocaleDateString(getLocale(), { weekday: "short", timeZone: "UTC" });

    const iconEl = document.createElement("img");
    iconEl.className = "forecast-icon";
    iconEl.src = `https://openweathermap.org/img/wn/${w.icon}.png`;
    iconEl.alt = w.description || "";

    const tempEl = document.createElement("div");
    tempEl.className = "forecast-temp";
    tempEl.textContent = `${convertTemp(item.main.temp)}°`;

    dayEl.append(nameEl, iconEl, tempEl);
    forecastEl.appendChild(dayEl);
  }
}

function updateWeatherUI(current, forecast, timestamp, isFromCache, isOffline = false) {
  currentWeatherData = { current, forecast, timestamp, isFromCache, isOffline };

  updateBadgeAndTitle(current);

  if (statusMsg) statusMsg.style.display = "none";
  if (weatherContent) weatherContent.style.display = "block";

  const unitSymbol = `°${currentUnit}`;
  const w = current.weather?.[0];

  if (cityNameEl) cityNameEl.textContent = current.name;
  if (tempMainEl) tempMainEl.textContent = `${convertTemp(current.main.temp)}${unitSymbol}`;
  if (weatherIconEl && w) {
    weatherIconEl.src = `https://openweathermap.org/img/wn/${w.icon}@2x.png`;
    weatherIconEl.alt = w.description;
  }
  if (tempRangeEl) {
    const { min, max } = computeTempRange(current, forecast);
    tempRangeEl.textContent = `Min: ${convertTemp(min)}° | Max: ${convertTemp(max)}°`;
  }

  if (feelsLikeEl) feelsLikeEl.textContent = `${convertTemp(current.main.feels_like)}${unitSymbol}`;
  if (humidityEl) humidityEl.textContent = `${current.main.humidity}%`;
  if (windSpeedEl) {
    const speed = current.wind?.speed;
    windSpeedEl.textContent = speed !== undefined ? `${Math.round(speed * 3.6)} km/h` : "N/A";
  }
  if (pressureEl) pressureEl.textContent = `${current.main.pressure} hPa`;

  if (precip3hEl) {
    precip3hEl.textContent = `${formatNumber(computePrecip3h(current, forecast))} mm`;
  }

  if (visibilityEl) {
    visibilityEl.textContent =
      current.visibility !== undefined ? `${formatNumber(current.visibility / 1000)} km` : "N/A";
  }

  if (sunriseEl && sunsetEl) {
    if (current.sys?.sunrise && current.sys?.sunset) {
      const tz = current.timezone ?? 0;
      sunriseEl.textContent = formatCityTime(current.sys.sunrise, tz);
      sunsetEl.textContent = formatCityTime(current.sys.sunset, tz);
    } else {
      sunriseEl.textContent = "--:--";
      sunsetEl.textContent = "--:--";
    }
  }

  renderForecast(forecast);

  if (lastUpdateEl) {
    const durationMin = Math.round(cacheDurationMs / 60000);
    const updateTime = new Date(timestamp).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });

    if (isOffline) {
      lastUpdateEl.textContent = getMessage("last_update_offline", [updateTime]);
      lastUpdateEl.classList.add("offline");
    } else if (isFromCache) {
      lastUpdateEl.textContent = getMessage("last_update_cache", [durationMin.toString(), updateTime]);
      lastUpdateEl.classList.remove("offline");
    } else {
      lastUpdateEl.textContent = getMessage("last_update_live", [updateTime]);
      lastUpdateEl.classList.remove("offline");
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  loadDefaultCity();
});