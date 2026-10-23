// ZACK! Server-Anbindung (Firebase). Aktiv nur, wenn config.js window.ZACK_FIREBASE setzt.
// Stellt dieselbe Schnittstelle bereit wie die Claude-Laufzeit: window.claude.use("db" | "room" | "user").
// Jeder Spieler bekommt sofort ein anonymes Konto; beim Registrieren wird es mit E-Mail + Passwort verknüpft (gleiche ID).
(function () {
  var cfg = window.ZACK_FIREBASE;
  if (!cfg || !cfg.apiKey) return;
  var BASE = "https://www.gstatic.com/firebasejs/10.12.2/";
  function load(f) { return new Promise(function (ok, no) { var s = document.createElement("script"); s.src = BASE + f; s.onload = ok; s.onerror = function () { no({ code: "network" }); }; document.head.appendChild(s); }); }
  var fs = null, auth = null, user = null, savedAt = null;
  var TAB_PEER = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  var sdk = load("firebase-app-compat.js")
    .then(function () { return Promise.all([load("firebase-auth-compat.js"), load("firebase-firestore-compat.js")]); })
    .then(function () { firebase.initializeApp(cfg); auth = firebase.auth(); fs = firebase.firestore(); });
  // Anmeldung: vorhandene Sitzung übernehmen, sonst anonym anmelden
  var ready = sdk.then(function () {
    return new Promise(function (resolve, reject) {
      var first = true;
      auth.onAuthStateChanged(function (u) {
        if (u) { user = u; if (first) { first = false; resolve(u); } return; }
        if (first) auth.signInAnonymously().catch(function (e) { first = false; reject(e); });
      });
    });
  }).then(function (u) {
    if (u && !u.isAnonymous) return fs.doc("saves/" + u.uid).get().then(function (d) { savedAt = d.exists ? d.data().at : null; }, function () {});
  });

  // ---------- db: Firestore, plus acquire() für die kurze Namens-Sperre ----------
  function wrapDoc(ref) {
    return {
      id: ref.id,
      get: function () { return ref.get(); },
      set: function (d) { return ref.set(clean(d)); },
      update: function (d) { return ref.update(clean(d)); },
      delete: function () { return ref.delete(); },
      onSnapshot: function (cb, err) { return ref.onSnapshot(cb, err || function () {}); },
      acquire: function (o) {
        var holder = (o && o.holder) || (user && user.uid), ttl = (o && o.ttlMs) || 8000;
        return fs.runTransaction(function (tx) {
          return tx.get(ref).then(function (s) {
            var d = s.exists ? s.data() : null, now = Date.now();
            if (d && d.holder && d.holder !== holder && d.exp > now) return { acquired: false };
            tx.set(ref, { holder: holder, exp: now + ttl });
            return { acquired: true };
          });
        }).then(function (r) { r.release = function () { return Promise.resolve(); }; return r; });
      }
    };
  }
  function clean(d) { return JSON.parse(JSON.stringify(d, function (k, v) { return v === undefined ? null : v; })); }
  var db = {
    doc: function (p) { return wrapDoc(fs.doc(p)); },
    collection: function (p) {
      var c = fs.collection(p);
      var add = c.add.bind(c);
      c.add = function (d) { return add(clean(d)); };
      return c;
    }
  };

  // ---------- room: Echtzeit über Firestore (rooms/{name}/peers und rooms/{name}/msgs) ----------
  var ALIVE = 40000;
  function makeRoom(name) {
    var base = fs.collection("rooms").doc(name), peersCol = base.collection("peers"), msgsCol = base.collection("msgs");
    var mine = {}, hb = null, unsubs = [], peerCbs = [], last = new Map(), topicCbs = {}, msgUnsub = null, t0 = Date.now(), left = false;
    function writeMe() { if (left) return Promise.resolve(); return peersCol.doc(TAB_PEER).set({ peer: TAB_PEER, by: user.uid, presence: clean(mine), at: Date.now() }); }
    function startHb() { if (hb) return; hb = setInterval(function () { writeMe().catch(function () {}); }, 15000); }
    var latest = [];
    function recompute() {
      var now = Date.now(), next = new Map();
      latest.forEach(function (d) { if (now - d.at < ALIVE || d.peer === TAB_PEER) next.set(d.peer, { peer: d.peer, by: d.by, kind: "viewer", isMe: d.by === user.uid, sameTab: d.peer === TAB_PEER, presence: d.presence || {} }); });
      var joined = [], gone = [];
      next.forEach(function (p, k) { if (!last.has(k)) joined.push(p); });
      last.forEach(function (p, k) { if (!next.has(k)) gone.push(p); });
      last = next;
      var ch = { peers: Array.from(next.values()), joined: joined, left: gone };
      peerCbs.forEach(function (f) { try { f(ch); } catch (e) {} });
    }
    var peerUnsub = null, tick = null;
    function watchPeers() {
      if (peerUnsub) return;
      peerUnsub = peersCol.orderBy("at", "desc").limit(200).onSnapshot(function (q) { latest = q.docs.map(function (d) { return d.data(); }); recompute(); }, function () {});
      tick = setInterval(recompute, 10000);
    }
    function watchMsgs() {
      if (msgUnsub) return;
      msgUnsub = msgsCol.orderBy("at").startAt(t0 - 1500).onSnapshot(function (q) {
        q.docChanges().forEach(function (c) {
          if (c.type !== "added") return;
          var d = c.doc.data(), fns = topicCbs[d.topic] || [];
          var m = { topic: d.topic, data: d.data, peer: d.peer, by: d.by, isMe: d.by === user.uid };
          fns.forEach(function (f) { try { f(m); } catch (e) {} });
        });
      }, function () {});
    }
    var room = {
      presence: function (patch) { mine = patch || {}; startHb(); return writeMe(); },
      onPeers: function (fn, err) { peerCbs.push(fn); watchPeers(); writeMe().catch(function () {}); startHb(); return function () { peerCbs = peerCbs.filter(function (x) { return x !== fn; }); }; },
      on: function (topic, fn, err) { (topicCbs[topic] = topicCbs[topic] || []).push(fn); watchMsgs(); return function () { topicCbs[topic] = (topicCbs[topic] || []).filter(function (x) { return x !== fn; }); }; },
      emit: function (topic, data) {
        return msgsCol.add({ topic: topic, data: clean(data == null ? null : data), peer: TAB_PEER, by: user.uid, at: Date.now() }).then(function (r) { setTimeout(function () { r.delete().catch(function () {}); }, 60000); });
      },
      join: function (n) { var r = makeRoom(n); return r.presence({}).then(function () { return r; }); },
      leave: function () {
        left = true; clearInterval(hb); clearInterval(tick);
        if (peerUnsub) peerUnsub(); if (msgUnsub) msgUnsub();
        return peersCol.doc(TAB_PEER).delete().catch(function () {});
      }
    };
    rooms.push(room);
    return room;
  }
  var rooms = [];
  addEventListener("pagehide", function () { rooms.forEach(function (r) { try { r.leave(); } catch (e) {} }); });

  // ---------- user ----------
  var userNs = {
    id: function () { return Promise.resolve(user.uid); },
    me: function () { return Promise.resolve({ id: user.uid, name: "" }); },
    profiles: function () { return Promise.resolve({}); },
    search: function () { return Promise.resolve([]); },
    isOwner: function () { return false; }, canEdit: function () { return false; }, can: function () { return null; }
  };

  var lobby = null;
  window.claude = {
    use: function (n) {
      return ready.then(function () {
        if (n === "db") return db;
        if (n === "user") return userNs;
        if (n === "room") return lobby || (lobby = makeRoom("lobby"));
        return null;
      }, function () { return null; });
    }
  };

  // ---------- Konto: E-Mail + Passwort ----------
  function wrap(e) { return { code: e && e.code ? String(e.code).replace("auth/", "") : "error" }; }
  function lang() { try { auth.languageCode = (localStorage.getItem("zack.lang") || '"de"').replace(/"/g, ""); } catch (e) {} }
  window.ZACK_AUTH = {
    kind: "firebase",
    ready: function () { return ready; },
    current: function () { return user && !user.isAnonymous ? { email: user.email, savedAt: savedAt } : null; },
    signUp: function (email, pw) {
      return ready.then(function () {
        var cred = firebase.auth.EmailAuthProvider.credential(email, pw);
        return auth.currentUser && auth.currentUser.isAnonymous ? auth.currentUser.linkWithCredential(cred) : auth.createUserWithEmailAndPassword(email, pw);
      }).then(function (c) { user = c.user; }, function (e) { var w = wrap(e); if (/credential-already-in-use|email-already-in-use/.test(w.code)) w.code = "exists"; throw w; });
    },
    signIn: function (email, pw) {
      return ready.then(function () { return auth.signInWithEmailAndPassword(email, pw); })
        .then(function (c) { user = c.user; return fs.doc("saves/" + user.uid).get(); })
        .then(function (d) { savedAt = d.exists ? d.data().at : null; return d.exists ? JSON.parse(d.data().snap || "{}") : null; }, function (e) { throw wrap(e); });
    },
    save: function (snap) { return ready.then(function () { if (!user || user.isAnonymous) return; var at = Date.now(); return fs.doc("saves/" + user.uid).set({ snap: JSON.stringify(snap), at: at }).then(function () { savedAt = at; }); }); },
    signOut: function () { return ready.then(function () { rooms.forEach(function (r) { try { r.leave(); } catch (e) {} }); return auth.signOut(); }).then(function () { user = null; }); },
    reset: function (email) { return ready.then(function () { lang(); return auth.sendPasswordResetEmail(email); }).catch(function (e) { throw wrap(e); }); }
  };
})();
