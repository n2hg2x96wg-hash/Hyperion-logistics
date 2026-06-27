import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const APP_NAME = "hyperion-client-dashboard";

export function createClientAuth(firebaseConfig, { sessionTimeoutMs = 30 * 60 * 1000 } = {}) {
  const app = getApps().find((item) => item.name === APP_NAME) || initializeApp(firebaseConfig, APP_NAME);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let timeoutId = null;

  function resetSessionTimer(onTimeout) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      await signOut(auth);
      if (typeof onTimeout === "function") onTimeout();
    }, sessionTimeoutMs);
  }

  function attachActivityTimer(onTimeout) {
    ["click", "keydown", "mousemove", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, () => resetSessionTimer(onTimeout), { passive: true });
    });
    resetSessionTimer(onTimeout);
  }

  async function login(email, password) {
    await setPersistence(auth, browserSessionPersistence);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return credential.user;
  }

  async function logout() {
    await signOut(auth);
  }

  async function getClientProfile(uid) {
    const profileRef = doc(db, "clients", uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) return null;
    return { id: profileSnap.id, ...profileSnap.data() };
  }

  function monitorAuth({ onAuthorized, onUnauthorized, onTimeout }) {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (typeof onUnauthorized === "function") onUnauthorized();
        return;
      }

      const profile = await getClientProfile(user.uid);
      if (!profile || profile.status !== "active") {
        await signOut(auth);
        if (typeof onUnauthorized === "function") onUnauthorized("Account inactive or unavailable.");
        return;
      }

      attachActivityTimer(onTimeout);
      if (typeof onAuthorized === "function") onAuthorized({ user, profile, db });
    });
  }

  return {
    auth,
    db,
    login,
    logout,
    getClientProfile,
    monitorAuth
  };
}
