/**
 * Rapporteur pour Windows — la coquille de bureau.
 *
 * L'application ne contient AUCUNE logique du service : son écran d'accueil
 * propose les trois modes, puis elle charge lerapporteur.com comme le ferait
 * un navigateur, en y ajoutant la seule chose qu'un navigateur ne sait pas
 * faire — capter le son de TOUT l'ordinateur (« loopback »), donc aussi
 * Teams, Zoom ou Skype installés sur le poste, ou une réunion déjà
 * enregistrée qu'on rejoue.
 *
 * Conséquences voulues de cette architecture :
 * - le design et les évolutions du site apparaissent ici sans mise à jour ;
 * - les clés, les prompts et la rédaction restent sur le serveur : il n'y a
 *   rien à voler dans cette application ;
 * - la session est le cookie du site : la sécurité est celle des routes API.
 *
 * L'application s'installe et s'ouvre librement. Lancer une réunion demande
 * d'être client — un abonnement en cours (Basic compris) ou un lot acheté —
 * ou une adresse de la caisse, pour que le vendeur essaie son produit.
 * Vérifié ici pour l'affichage (`bureau` dans /api/moi), et par le serveur
 * pour de vrai.
 */
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile, execFileSync } = require("node:child_process");

const SITE = "https://lerapporteur.com";
const VERSION = app.getVersion();

/* Sans cet identifiant, Windows refuse d'afficher les notifications de
   l'application — silencieusement. L'avertisseur de silence de la salle
   d'enregistrement en pose une : elle doit se voir. Même valeur que l'appId
   d'electron-builder, c'est la paire qui fait marcher les toasts. */
app.setAppUserModelId("com.lerapporteur.bureau");

/* Un seul exemplaire : un second lancement ramène la fenêtre existante. */
if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "Rapporteur",
    /* L'icône micro du site, dans la barre des tâches comme dans l'onglet du
       navigateur : le client doit retrouver Rapporteur d'un coup d'œil. */
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#F0EEE6",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // La session persiste sur disque : le client reste connecté d'un
      // lancement à l'autre, comme dans son navigateur.
      partition: "persist:rapporteur",
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--rapporteur-version=${VERSION}`],
    },
  });

  const ses = fenetre.webContents.session;

  /* Le cœur de l'application : quand la page demande un partage d'écran
     (getDisplayMedia), on lui donne l'écran ET le son de tout le système —
     sans sélecteur d'onglet. C'est ce que le navigateur ne sait pas faire. */
  ses.setDisplayMediaRequestHandler((demande, accorder) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      try {
        accorder({ video: sources[0], audio: "loopback" });
      } catch (e) {
        /* Sur macOS, le son du système (« loopback ») n'est pas offert par
           toutes les versions d'Electron ; l'écran seul est alors accordé, et
           la salle le voit : la piste des participants restera muette, le
           client mettra la réunion sur haut-parleur — le micro capte tout. */
        accorder({ video: sources[0] });
      }
    }).catch(() => accorder(null));
  });

  /* Micro et capture : accordés d'office — l'application n'existe que pour
     ça, et l'utilisateur l'a installée en connaissance de cause. */
  ses.setPermissionRequestHandler((contenu, permission, accorder) => {
    accorder(["media", "display-capture", "mediaKeySystem"].includes(permission));
  });

  /* Les liens vers d'autres sites s'ouvrent dans le vrai navigateur :
     l'application ne montre que lerapporteur.com et son propre accueil. */
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  fenetre.webContents.on("will-navigate", (evenement, url) => {
    if (!url.startsWith(SITE) && !url.startsWith("file:")) {
      evenement.preventDefault();
      shell.openExternal(url);
    }
  });

  /* Le contrôle d'entrée : le serveur dit lui-même qui a droit à
     l'application (`bureau` dans /api/moi). Ce n'est pas la sécurité — elle
     est sur les routes du serveur : c'est ce qui évite d'offrir un
     enregistreur qui serait refusé à l'envoi. */
  fenetre.webContents.on("did-finish-load", async () => {
    const adresse = fenetre.webContents.getURL();
    if (!adresse.startsWith(SITE)) return;
    try {
      const etat = await fenetre.webContents.executeJavaScript(
        `fetch("/api/moi", {credentials:"same-origin", cache:"no-store"})
           .then(r => r.json()).catch(() => null)`, true);
      if (!etat || !etat.connecte) return; // la garde du site mène à /connexion
      if (etat.bureau === false && adresse.includes("/enregistrer")) {
        await fenetre.loadFile(path.join(__dirname, "reserve.html"));
      }
    } catch { /* dans le doute, le serveur tranchera à l'envoi */ }
  });

  chargerAccueil();
  fenetre.on("closed", () => { fenetre = null; });
  // La page qui tenait l'interprète s'en va : les autres sons reviennent.
  fenetre.webContents.on("did-start-navigation", (details) => {
    if (details && (details.isMainFrame === false || details.isSameDocument)) return;
    if (veilleSons) { niveauCourant = null; rendreLesSons(); }
  });
}

/* L'accueil de l'application vit SUR LE SITE (/bureau) : la pastille de
   compte y fonctionne comme partout, et l'écran évolue sans mise à jour de
   l'application. Hors connexion, un écran local le remplace. */
function chargerAccueil() {
  if (!fenetre) return;
  fenetre.loadURL(`${SITE}/bureau`).catch(() => {
    if (fenetre) fenetre.loadFile(path.join(__dirname, "accueil.html"));
  });
}

/* Les pages du site ramènent ici par le pont du preload quand on clique un
   lien vers la racine. */
ipcMain.on("retour-accueil", chargerAccueil);

/**
 * L'interprète vocal du site joue sa traduction ici, mais la réunion — YouTube,
 * Teams, Zoom — sort du même haut-parleur, et une page ne peut pas toucher au
 * volume d'une autre application : à l'essai de Felly (15/10/2026), la voix
 * d'origine couvrait l'interprète. Sous Windows, l'application le peut : pendant
 * l'interprète, chaque autre application est mise à NIVEAU_AUTRES de son volume
 * (sons/rapporteur-sons.exe, le mélangeur de Windows), puis rendue à l'arrêt.
 *
 * Baisser, pas couper : mesuré le 15/10/2026, le son de l'ordinateur que captent
 * l'interprète et le compte rendu baisse AVEC le volume de l'application
 * (Windows applique le carré du réglage : 0,4 → 16 dB de moins). Couper rendrait
 * l'interprète et le compte rendu sourds à la réunion ; 16 dB laissent la voix de
 * l'interprète nettement devant, et la réunion bien audible pour eux.
 *
 * Windows garde le volume des applications d'une fois sur l'autre : le fichier
 * d'état sert à les rendre même après une fermeture brutale (au démarrage).
 */
const NIVEAU_AUTRES = "0.4";
const OUTIL_SONS = path.join(process.resourcesPath || "", "rapporteur-sons.exe");
const ETAT_SONS = path.join(app.getPath("userData"), "sons-baisses.txt");
const NOM_PROCESSUS = path.parse(process.execPath).name;
let veilleSons = null;

function outilSons(...args) {
  return new Promise((fini) => {
    if (process.platform !== "win32" || !fs.existsSync(OUTIL_SONS)) return fini(false);
    execFile(OUTIL_SONS, args, { timeout: 5000, windowsHide: true }, (erreur) => fini(!erreur));
  });
}

function rendreLesSons() {
  clearInterval(veilleSons);
  veilleSons = null;
  return fs.existsSync(ETAT_SONS) ? outilSons("rendre", ETAT_SONS) : Promise.resolve(true);
}

let niveauCourant = null;
ipcMain.handle("autres-sons", async (evenement, baisser, niveau) => {
  if (!baisser) { niveauCourant = null; return rendreLesSons(); }
  // La page dit le niveau : moins baissé pendant un enregistrement (le compte rendu
  // capte le son de l'ordinateur APRÈS ce réglage). Un autre niveau : on rend, puis on rebaisse.
  const n = Number(niveau);
  const voulu = Number.isFinite(n) && n >= 0.1 && n <= 1 ? String(n) : NIVEAU_AUTRES;
  if (niveauCourant !== null && niveauCourant !== voulu) await rendreLesSons();
  clearInterval(veilleSons);
  niveauCourant = voulu;
  const fait = await outilSons("baisser", ETAT_SONS, voulu, NOM_PROCESSUS);
  // Une application qui se met à jouer pendant l'interprète est baissée à son tour.
  veilleSons = setInterval(() => outilSons("baisser", ETAT_SONS, voulu, NOM_PROCESSUS), 4000);
  return fait;
});

/**
 * La mise à jour : le site publie la version courante dans /docs/bureau.json.
 * Presque tout vit sur le serveur — la coquille change rarement — mais quand
 * elle change, on le dit au lancement et un clic télécharge la nouvelle.
 */
async function verifierMiseAJour() {
  /* L'édition Microsoft Store se met à jour par le Store lui-même : ne jamais
     lui proposer le .exe du site. */
  if (process.windowsStore) return;
  try {
    const reponse = await fetch(`${SITE}/docs/bureau.json`, { cache: "no-store" });
    if (!reponse.ok) return;
    const info = await reponse.json();
    const publiee = String(info.version || "");
    if (!publiee || publiee === VERSION || !info.telechargement) return;
    const plusRecente = publiee.localeCompare(VERSION, undefined, { numeric: true }) > 0;
    if (!plusRecente || !fenetre) return;
    /* La langue du système, comme sur le site : français, sinon anglais. */
    const enAnglais = !String(app.getLocale() || "fr").toLowerCase().startsWith("fr");
    const { response } = await dialog.showMessageBox(fenetre, enAnglais ? {
      type: "info",
      title: "Rapporteur update",
      message: `A new version (${publiee}) is available.`,
      detail: "Your settings and your sign-in are preserved. The download opens in your browser.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    } : {
      type: "info",
      title: "Mise à jour de Rapporteur",
      message: `Une nouvelle version (${publiee}) est disponible.`,
      detail: "Vos réglages et votre connexion sont conservés. Le téléchargement s'ouvre dans votre navigateur.",
      buttons: ["Télécharger", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(info.telechargement);
  } catch { /* hors connexion : on réessaiera au prochain lancement */ }
}

app.on("second-instance", () => {
  if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
});

app.whenReady().then(() => {
  // Une fermeture brutale pendant l'interprète a pu laisser des volumes baissés.
  rendreLesSons();
  creerFenetre();
  verifierMiseAJour();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  clearInterval(veilleSons);
  if (process.platform !== "win32" || !fs.existsSync(ETAT_SONS) || !fs.existsSync(OUTIL_SONS)) return;
  try { execFileSync(OUTIL_SONS, ["rendre", ETAT_SONS], { timeout: 4000, windowsHide: true }); } catch { /* au prochain démarrage */ }
});
