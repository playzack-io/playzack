// ZACK! Server-Anbindung (Firebase). Aktiv nur, wenn config.js einen Firebase-Config-Block setzt.
// Konto: E-Mail + Passwort (Firebase Auth). Spielstand: Firestore saves/{uid}.
// Firestore-Regel: match /saves/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }
(function () {
  var cfg = window.ZACK_FIREBASE;
  if (!cfg || !cfg.apiKey) return;
  var base = "https://www.gstatic.com/firebasejs/10.12.2/";
  function load(f) { return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = base + f; s.onload = ok; s.onerror = function () { no({ code: "network" }); }; document.head.appendChild(s); }); }
  var user = null, savedAt = null, fs = null;
  var ready = load("firebase-app-compat.js")
    .then(function () { return Promise.all([load("firebase-auth-compat.js"), load("firebase-firestore-compat.js")]); })
    .then(function () {
      firebase.initializeApp(cfg); fs = firebase.firestore();
      return new Promise(function (r) { firebase.auth().onAuthStateChanged(function (u) { user = u; r(); }); });
    })
    .then(function () { if (user) return fs.doc("saves/" + user.uid).get().then(function (d) { savedAt = d.exists ? d.data().at : null; }, function () {}); });
  function wrap(e) { return { code: e && e.code ? String(e.code).replace("auth/", "") : "error" }; }
  function lang() { try { firebase.auth().languageCode = (localStorage.getItem("zack.lang") || '"de"').replace(/"/g, ""); } catch (e) {} }
  window.ZACK_AUTH = {
    kind: "firebase",
    ready: function () { return ready; },
    current: function () { return user ? { email: user.email, savedAt: savedAt } : null; },
    signUp: function (email, pw) { return ready.then(function () { return firebase.auth().createUserWithEmailAndPassword(email, pw); }).then(function (c) { user = c.user; }, function (e) { throw wrap(e); }); },
    signIn: function (email, pw) {
      return ready.then(function () { return firebase.auth().signInWithEmailAndPassword(email, pw); })
        .then(function (c) { user = c.user; return fs.doc("saves/" + user.uid).get(); })
        .then(function (d) { savedAt = d.exists ? d.data().at : null; return d.exists ? JSON.parse(d.data().snap || "{}") : null; }, function (e) { throw wrap(e); });
    },
    save: function (snap) { return ready.then(function () { if (!user) return; var at = Date.now(); return fs.doc("saves/" + user.uid).set({ snap: JSON.stringify(snap), at: at }).then(function () { savedAt = at; }); }); },
    signOut: function () { return ready.then(function () { return firebase.auth().signOut(); }).then(function () { user = null; }); },
    reset: function (email) { return ready.then(function () { lang(); return firebase.auth().sendPasswordResetEmail(email); }).catch(function (e) { throw wrap(e); }); }
  };
})();
