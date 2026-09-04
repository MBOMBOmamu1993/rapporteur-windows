/**
 * Le seul pont entre l'application et la page.
 *
 * Le site sait ainsi qu'il tourne dans l'application de bureau — pour adapter
 * la salle d'enregistrement à ses modes (présentiel, relecture), marquer les
 * envois « bureau » auprès du serveur, et ramener à l'écran d'accueil de
 * l'application. Rien d'autre ne passe : pas d'accès au système depuis la page.
 */
const { contextBridge, ipcRenderer } = require("electron");

const version = (process.argv.find((a) => a.startsWith("--rapporteur-version=")) || "")
  .split("=")[1] || "";

contextBridge.exposeInMainWorld("rapporteurBureau", {
  version,
  plateforme: "windows",
  retourAccueil: () => ipcRenderer.send("retour-accueil"),
});
