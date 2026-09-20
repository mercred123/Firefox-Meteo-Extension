const apiKeyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

// Charger la clé API existante si elle est déjà enregistrée
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const store = await browser.storage.local.get("apiKey");
    if (store.apiKey) {
      apiKeyInput.value = store.apiKey;
    }
  } catch (err) {
    showStatus("Erreur lors de la lecture du stockage.", "error");
  }
});

// Sauvegarder la clé API
saveBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showStatus("Veuillez entrer une clé API valide.", "error");
    return;
  }

  try {
    await browser.storage.local.set({ apiKey: key });
    showStatus("Clé API enregistrée avec succès !", "success");
  } catch (err) {
    showStatus("Impossible d'enregistrer la clé.", "error");
  }
});

function showStatus(message, type) {
  statusEl.innerText = message;
  statusEl.className = `status-msg ${type}`;
  setTimeout(() => {
    statusEl.innerText = "";
    statusEl.className = "status-msg";
  }, 3000);
}
