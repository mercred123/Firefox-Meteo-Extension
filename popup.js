let cacheDurationMs = 10 * 60 * 1000;
let currentUnit = "C";
let currentWeatherData = null;

const storage =
  typeof browser !== "undefined" ? browser.storage.local : chrome.storage.local;
const DAILY_LIMIT = 1000;

// Éléments de vues
const mainView = document.getElementById("main-view");
const settingsView = document.getElementById("settings-view");
const apiModal = document.getElementById("api-modal");

// Boutons
const btnSettings = document.getElementById("btn-settings");
const btnBack = document.getElementById("btn-back");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnSaveModal = document.getElementById("btn-save-modal");
const unitCBtn = document.getElementById("unit-c");
const unitFBtn = document.getElementById("unit-f");
const btnReload = document.getElementById("btn-reload-weather");

// Inputs & Selects
const apiKeyInput = document.getElementById("api-key-input");
const modalApiKeyInput = document.getElementById("modal-api-key-input");
const cacheDurationSelect = document.getElementById("cache-duration-select");
const settingsStatus = document.getElementById("settings-status");
const modalStatus = document.getElementById("modal-status");

// Météo UI
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

const estimationValEl = document.getElementById("estimation-val");
const quotaProgressEl = document.getElementById("quota-progress");
const quotaTextEl = document.getElementById("quota-text");

const actionAPI =
  typeof browser !== "undefined" && browser.action
    ? browser.action
    : typeof chrome !== "undefined" && chrome.action
      ? chrome.action
      : null;

// Masquer/Afficher clé API avec l'œil
function setupEyeToggle(inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(toggleBtnId);

  btn?.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";

    btn.innerHTML = isPassword
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
         </svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
         </svg>`;
  });
}

setupEyeToggle("api-key-input", "toggle-key-settings");
setupEyeToggle("modal-api-key-input", "toggle-key-modal");

function updateBadge(tempCelsius) {
  if (!actionAPI) return;

  const tempFormatted = `${convertTemp(tempCelsius)}°`;

  actionAPI.setBadgeText({ text: tempFormatted });
  actionAPI.setBadgeBackgroundColor({ color: "#0284c7" }); // Bleu assorti au thème
}

btnReload?.addEventListener("click", async () => {
  const currentCity =
    cityInput.value.trim() || currentWeatherData?.current?.name;
  if (!currentCity) return;

  btnReload.classList.add("spinning");
  await getWeather(currentCity, true); // true = force l'appel API
  btnReload.classList.remove("spinning");
});

// Conversions de température
function convertTemp(tempCelsius) {
  if (currentUnit === "F") {
    return Math.round((tempCelsius * 9) / 5 + 32);
  }
  return Math.round(tempCelsius);
}

// Gestion des boutons °C / °F dans le DOM
function setUnitUI(unit) {
  currentUnit = unit;
  if (unit === "C") {
    unitCBtn.classList.add("active");
    unitFBtn.classList.remove("active");
  } else {
    unitFBtn.classList.add("active");
    unitCBtn.classList.remove("active");
  }
}

unitCBtn.addEventListener("click", () => setUnitUI("C"));
unitFBtn.addEventListener("click", () => setUnitUI("F"));

async function getApiKey() {
  const store = await storage.get("apiKey");
  return store.apiKey || null;
}

// Charger les préférences
async function loadSettings() {
  const store = await storage.get(["unit", "cacheDuration", "apiKey"]);
  currentUnit = store.unit || "C";
  setUnitUI(currentUnit);

  const duration = store.cacheDuration || 10;
  cacheDurationSelect.value = duration;
  cacheDurationMs = duration * 60 * 1000;

  if (store.apiKey) {
    apiKeyInput.value = store.apiKey;
  }
}

// Ouvrir les paramètres
async function openSettings() {
  await loadSettings();
  updateEstimation();
  await updateQuotaUI();
  settingsStatus.innerText = "";
  settingsStatus.className = "settings-status";

  mainView.style.display = "none";
  settingsView.style.display = "block";
}

cacheDurationSelect.addEventListener("change", updateEstimation);

// Fermer les paramètres et réafficher la météo (sans rappel d'API si seul l'unité change)
async function closeSettings() {
  settingsView.style.display = "none";
  mainView.style.display = "block";

  if (currentWeatherData) {
    updateWeatherUI(
      currentWeatherData.current,
      currentWeatherData.forecast,
      currentWeatherData.timestamp,
      currentWeatherData.isFromCache,
    );
  } else {
    loadDefaultCity();
  }
}

btnSettings.addEventListener("click", openSettings);
btnBack.addEventListener("click", closeSettings);

// Sauvegarder les paramètres
btnSaveSettings.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    settingsStatus.innerText = "Veuillez saisir une clé valide.";
    settingsStatus.className = "settings-status error";
    return;
  }

  const durationMin = parseInt(cacheDurationSelect.value, 10);
  cacheDurationMs = durationMin * 60 * 1000;

  await storage.set({
    apiKey: key,
    unit: currentUnit,
    cacheDuration: durationMin,
  });

  settingsStatus.innerText = "Enregistré !";
  settingsStatus.className = "settings-status success";

  setTimeout(() => closeSettings(), 600);
});

// Sauvegarde via la modale
btnSaveModal.addEventListener("click", async () => {
  const key = modalApiKeyInput.value.trim();
  if (!key) {
    modalStatus.innerText = "Saisissez une clé valide.";
    modalStatus.className = "settings-status error";
    return;
  }

  await storage.set({ apiKey: key });
  apiModal.style.display = "none";
  loadDefaultCity();
});

cityInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    const city = cityInput.value.trim();
    if (city) getWeather(city);
  }
});

async function getWeather(city, forceRefresh = false) {
  const apiKey = await getApiKey();

  if (!apiKey) {
    apiModal.style.display = "flex";
    return;
  }

  statusMsg.style.display = "block";
  statusMsg.innerText = "Chargement...";
  weatherContent.style.display = "none";

  const cityKey = city.toLowerCase();
  const encodedCity = encodeURIComponent(city);
  const now = Date.now();

  const store = await storage.get(["weatherCache", "lastCity"]);
  const cache = store.weatherCache || {};
  const cachedData = cache[cityKey];

  // 1. Détection du mode Hors Ligne
  const isOffline = !navigator.onLine;

  if (isOffline) {
    if (cachedData) {
      // Chargement des données locales sans appel API
      updateWeatherUI(
        cachedData.current,
        cachedData.forecast,
        cachedData.timestamp,
        true,
        true,
      );
      await storage.set({ lastCity: cachedData.current.name });
    } else {
      statusMsg.innerText =
        "Hors ligne : aucune donnée sauvegardée pour cette ville.";
    }
    return;
  }

  // 2. Si en ligne, vérification du cache valide (si forceRefresh est faux)
  if (
    !forceRefresh &&
    cachedData &&
    now - cachedData.timestamp < cacheDurationMs
  ) {
    updateWeatherUI(
      cachedData.current,
      cachedData.forecast,
      cachedData.timestamp,
      true,
      false,
    );
    await storage.set({ lastCity: cachedData.current.name });
    return;
  }

  // 3. Appel API
  try {
    const resCurrent = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&units=metric&appid=${apiKey}&lang=fr`,
    );
    const dataCurrent = await resCurrent.json();

    if (Number(dataCurrent.cod) !== 200) {
      statusMsg.innerText = "Ville non trouvée.";
      return;
    }

    const resForecast = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?q=${encodedCity}&units=metric&appid=${apiKey}&lang=fr`,
    );
    const dataForecast = await resForecast.json();

    if (Number(dataForecast.cod) !== 200) {
      statusMsg.innerText = "Erreur prévisions.";
      return;
    }

    cache[cityKey] = {
      timestamp: now,
      current: dataCurrent,
      forecast: dataForecast,
    };

    await storage.set({
      weatherCache: cache,
      lastCity: dataCurrent.name,
    });

    await incrementDailyCalls(2);
    updateWeatherUI(dataCurrent, dataForecast, now, false, false);
  } catch (err) {
    // Fallback si la requête échoue en cours de route (ex: perte soudaine de connexion)
    if (cachedData) {
      updateWeatherUI(
        cachedData.current,
        cachedData.forecast,
        cachedData.timestamp,
        true,
        true,
      );
    } else {
      statusMsg.innerText = "Erreur de connexion (Hors ligne).";
    }
  }
}

function updateBadgeAndTitle(current) {
  if (!actionAPI) return;

  const temp = `${convertTemp(current.main.temp)}°${currentUnit}`;
  const desc = current.weather[0]?.description || "";
  const descFormat = desc.charAt(0).toUpperCase() + desc.slice(1); // Ex: "Nuageux"

  // 1. Badge sur l'icône (ex: "21°")
  actionAPI.setBadgeText({ text: `${convertTemp(current.main.temp)}°` });
  actionAPI.setBadgeBackgroundColor({ color: "#0284c7" });

  // 2. Info-bulle au survol (ex: "Paris : 21°C, Ciel dégagé")
  actionAPI.setTitle({
    title: `${current.name} : ${temp}, ${descFormat}`,
  });
}

function updateWeatherUI(
  current,
  forecast,
  timestamp,
  isFromCache,
  isOffline = false,
) {
  currentWeatherData = { current, forecast, timestamp, isFromCache, isOffline };

  updateBadgeAndTitle(current);

  statusMsg.style.display = "none";
  weatherContent.style.display = "block";

  const unitSymbol = `°${currentUnit}`;

  cityNameEl.innerText = current.name;
  tempMainEl.innerText = `${convertTemp(current.main.temp)}${unitSymbol}`;
  weatherIconEl.src = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
  weatherIconEl.alt = current.weather[0].description;
  tempRangeEl.innerText = `Min: ${convertTemp(current.main.temp_min)}° | Max: ${convertTemp(current.main.temp_max)}°`;

  feelsLikeEl.innerText = `${convertTemp(current.main.feels_like)}${unitSymbol}`;
  humidityEl.innerText = `${current.main.humidity}%`;
  windSpeedEl.innerText = `${Math.round(current.wind.speed * 3.6)} km/h`;
  pressureEl.innerText = `${current.main.pressure} hPa`;

  const rain3h = current.rain?.["3h"] || 0;
  const snow3h = current.snow?.["3h"] || 0;
  const totalPrecip = rain3h + snow3h;
  precip3hEl.innerText = totalPrecip > 0 ? `${totalPrecip} mm` : "0 mm";

  visibilityEl.innerText =
    current.visibility !== undefined
      ? `${(current.visibility / 1000).toFixed(1)} km`
      : "N/A";

  if (current.sys?.sunrise && current.sys?.sunset) {
    const formatTime = (unixSec) =>
      new Date(unixSec * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    sunriseEl.innerText = formatTime(current.sys.sunrise);
    sunsetEl.innerText = formatTime(current.sys.sunset);
  } else {
    sunriseEl.innerText = "--:--";
    sunsetEl.innerText = "--:--";
  }

  const durationMin = Math.round(cacheDurationMs / 60000);
  const updateTime = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isOffline) {
    lastUpdateEl.innerText = `Hors ligne — Données en cache (${updateTime}) • Aucun appel API`;
    lastUpdateEl.classList.add("offline");
  } else {
    lastUpdateEl.classList.remove("offline");
    lastUpdateEl.innerText = isFromCache
      ? `En cache (${updateTime}) — Maj dans ${durationMin} min`
      : `Mise à jour (${updateTime})`;
  }

  forecastEl.innerHTML = "";
  const dailyForecasts = forecast.list
    .filter((item) => item.dt_txt.includes("12:00:00"))
    .slice(0, 3);
  const daysShort = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];

  dailyForecasts.forEach((item) => {
    const date = new Date(item.dt * 1000);
    const dayName = daysShort[date.getDay()];
    const iconUrl = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;

    const dayEl = document.createElement("div");
    dayEl.className = "forecast-item";
    dayEl.innerHTML = `
      <div class="forecast-day">${dayName}</div>
      <img class="forecast-icon" src="${iconUrl}" alt="icon" />
      <div class="forecast-temp">${convertTemp(item.main.temp)}°</div>
    `;
    forecastEl.appendChild(dayEl);
  });
}

async function loadDefaultCity() {
  const data = await storage.get("lastCity");
  if (data.lastCity) {
    cityInput.value = data.lastCity;
    getWeather(data.lastCity);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  const apiKey = await getApiKey();

  if (!apiKey) {
    apiModal.style.display = "flex";
  } else {
    loadDefaultCity();
  }
});

function updateEstimation() {
  const durationMin = parseInt(cacheDurationSelect.value, 10);
  const refreshesPerDay = 1440 / durationMin; // 1440 min dans 24h
  const reqPerRefresh = 2; // 1 call weather + 1 call forecast
  const totalCalls = Math.round(refreshesPerDay * reqPerRefresh * 2); // pour 2 villes

  estimationValEl.innerText = `${totalCalls.toLocaleString("fr-FR")} req`;
}

// Met à jour la barre de quota et le texte dans les paramètres
async function updateQuotaUI() {
  const todayStr = new Date().toISOString().split("T")[0];
  const store = await storage.get(["dailyCallsDate", "dailyCallsCount"]);

  let count = store.dailyCallsCount || 0;
  if (store.dailyCallsDate !== todayStr) {
    count = 0; // Réinitialisation quotidienne
    await storage.set({ dailyCallsDate: todayStr, dailyCallsCount: 0 });
  }

  const remaining = Math.max(0, DAILY_LIMIT - count);
  const percentage = Math.min(100, Math.round((count / DAILY_LIMIT) * 100));

  quotaProgressEl.style.width = `${percentage}%`;
  quotaTextEl.innerText = `${count} / ${DAILY_LIMIT.toLocaleString("fr-FR")} utilisées (${remaining} restantes)`;

  // Changement de couleur si proche de la limite
  quotaProgressEl.className = "quota-progress";
  if (percentage >= 90) {
    quotaProgressEl.classList.add("danger");
  } else if (percentage >= 70) {
    quotaProgressEl.classList.add("warning");
  }
}

// Incrémente le compteur quand un vrai appel API est effectué
async function incrementDailyCalls(callsCount = 2) {
  const todayStr = new Date().toISOString().split("T")[0];
  const store = await storage.get(["dailyCallsDate", "dailyCallsCount"]);

  let currentCount = store.dailyCallsCount || 0;
  if (store.dailyCallsDate !== todayStr) {
    currentCount = 0;
  }

  const newCount = currentCount + callsCount;
  await storage.set({ dailyCallsDate: todayStr, dailyCallsCount: newCount });
  updateQuotaUI();
}
