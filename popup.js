const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

const cityInput = document.getElementById("city");
const statusMsg = document.getElementById("status-msg");
const weatherContent = document.getElementById("weather-content");

// Éléments UI
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

async function getApiKey() {
  const store = await browser.storage.local.get("apiKey");
  return store.apiKey || null;
}

cityInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    const city = cityInput.value.trim();
    if (city) getWeather(city);
  }
});

async function getWeather(city) {
  const apiKey = await getApiKey();

  if (!apiKey) {
    statusMsg.style.display = "block";
    statusMsg.innerHTML =
      'Clé API manquante.<br><a href="#" id="open-options" style="color:#38bdf8; text-decoration: underline;">Configurer les options</a>';
    weatherContent.style.display = "none";

    document.getElementById("open-options")?.addEventListener("click", (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
    });
    return;
  }

  statusMsg.style.display = "block";
  statusMsg.innerText = "Chargement...";
  weatherContent.style.display = "none";

  const cityKey = city.toLowerCase();
  const encodedCity = encodeURIComponent(city);
  const now = Date.now();

  const storage = await browser.storage.local.get(["weatherCache", "lastCity"]);
  const cache = storage.weatherCache || {};

  // Utilisation du cache si < 10 min
  if (cache[cityKey] && now - cache[cityKey].timestamp < CACHE_DURATION_MS) {
    const cachedData = cache[cityKey];
    updateWeatherUI(
      cachedData.current,
      cachedData.forecast,
      cachedData.timestamp,
      true,
    );
    await browser.storage.local.set({ lastCity: cachedData.current.name });
    return;
  }

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
      statusMsg.innerText = "Erreur lors de la récupération des prévisions.";
      return;
    }

    cache[cityKey] = {
      timestamp: now,
      current: dataCurrent,
      forecast: dataForecast,
    };

    await browser.storage.local.set({
      weatherCache: cache,
      lastCity: dataCurrent.name,
    });

    updateWeatherUI(dataCurrent, dataForecast, now, false);
  } catch (err) {
    statusMsg.innerText = "Erreur de connexion.";
  }
}

function updateWeatherUI(current, forecast, timestamp, isFromCache) {
  statusMsg.style.display = "none";
  weatherContent.style.display = "block";

  cityNameEl.innerText = current.name;
  tempMainEl.innerText = `${Math.round(current.main.temp)}°`;
  weatherIconEl.src = `https://openweathermap.org/img/wn/${current.weather[0].icon}@2x.png`;
  weatherIconEl.alt = current.weather[0].description;
  tempRangeEl.innerText = `Min: ${Math.round(current.main.temp_min)}° | Max: ${Math.round(current.main.temp_max)}°`;

  feelsLikeEl.innerText = `${Math.round(current.main.feels_like)}°C`;
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

  const updateTime = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  lastUpdateEl.innerText = isFromCache
    ? `En cache (${updateTime}) — Maj auto dans 10 min`
    : `Mise à jour (${updateTime})`;

  // Affichage des 3 prochains jours
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
      <div class="forecast-temp">${Math.round(item.main.temp)}°</div>
    `;
    forecastEl.appendChild(dayEl);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const data = await browser.storage.local.get("lastCity");
  if (data.lastCity) {
    cityInput.value = data.lastCity;
    getWeather(data.lastCity);
  }
});
