/**
 * Le contrôle de l'interprète vocal, lancé par le workflow dans l'Electron du
 * dépôt : `npx electron .github/verifier-capture.js`.
 *
 * La salle d'enregistrement et l'interprète du site lisent
 * `getSupportedConstraints().restrictOwnAudio` : vrai (Electron ≥ 44), la
 * capture du son de l'ordinateur exclut la voix que Rapporteur joue lui-même
 * — l'interprétation n'entre pas dans le compte rendu, Teams ou Zoom y
 * restent, et l'interprète marche pendant un enregistrement. Faux (Electron
 * 38), l'interprète y est refusé. C'est ce contrôle qui fait échouer la
 * construction ; la capture elle-même est essayée et seulement racontée, car
 * une machine d'intégration n'a pas toujours de sortie son.
 */
const { app, BrowserWindow, desktopCapturer } = require("electron");

app.whenReady().then(async () => {
  const fenetre = new BrowserWindow({ show: false });
  const ses = fenetre.webContents.session;
  // Le même accord que main.js : l'écran et le son de tout le système.
  ses.setDisplayMediaRequestHandler((demande, accorder) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      try { accorder({ video: sources[0], audio: "loopback" }); } catch { accorder({ video: sources[0] }); }
    }).catch(() => accorder(null));
  });
  ses.setPermissionRequestHandler((contenu, permission, accorder) => accorder(true));
  await fenetre.loadURL("https://lerapporteur.com/bureau");
  const etat = await fenetre.webContents.executeJavaScript(`(async () => {
    const accepte = Boolean(navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio);
    let capture = "non essayée";
    try {
      const flux = await Promise.race([
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: { restrictOwnAudio: true } }),
        new Promise((oui, non) => setTimeout(() => non(new Error("délai dépassé")), 15000)),
      ]);
      const piste = flux.getAudioTracks()[0];
      capture = piste ? "piste son, restrictOwnAudio = " + piste.getSettings().restrictOwnAudio : "écran sans son";
      flux.getTracks().forEach((p) => p.stop());
    } catch (e) { capture = "refusée : " + (e.name || "") + " " + (e.message || ""); }
    return { chromium: (navigator.userAgent.match(/Chrome\\/([\\d.]+)/) || [])[1], restrictOwnAudio: accepte, capture };
  })()`, true);
  console.log(`Electron ${process.versions.electron} : ${JSON.stringify(etat)}`);
  app.exit(etat.restrictOwnAudio ? 0 : 1);
}).catch((erreur) => { console.error(erreur); app.exit(1); });
