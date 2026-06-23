import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { createTrackingMap } from "./mapping.js";
import { calculateEtaData, formatEtaCountdown } from "./eta-calculator.js";
import { renderTimeline } from "./tracking-timeline.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRd7FFT2ycMaLvdgvYyauQz13nCnfGOss",
  authDomain: "hyperion-logistics.firebaseapp.com",
  projectId: "hyperion-logistics",
  storageBucket: "hyperion-logistics.firebasestorage.app",
  messagingSenderId: "481927084665",
  appId: "1:481927084665:web:6c067752a922890e44f2a8",
  measurementId: "G-JWBT2EH4WY"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const POLLING_INTERVAL = 30_000;
const SIMULATION_INTERVAL = 5_000;

const refs = {
  trackingInput: document.getElementById("trackingInput"),
  error: document.getElementById("error"),
  resultContainer: document.getElementById("resultContainer"),
  statusBadge: document.getElementById("statusBadge"),
  locationValue: document.getElementById("locationValue"),
  routeValue: document.getElementById("routeValue"),
  statusValue: document.getElementById("statusValue"),
  distanceValue: document.getElementById("distanceValue"),
  feeValue: document.getElementById("feeValue"),
  etaValue: document.getElementById("etaValue"),
  countdownValue: document.getElementById("countdownValue"),
  statusNotification: document.getElementById("statusNotification"),
  loadingSkeleton: document.getElementById("loadingSkeleton"),
  timelineContainer: document.getElementById("timelineContainer"),
  trackButton: document.querySelector(".btn-track"),
  themeToggle: document.getElementById("themeToggle")
};

let activeTrackingId = "";
let pollingTimer;
let simulationTimer;
let countdownTimer;
let mapController;
let shipmentState;
let notificationTimer;

function setTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("theme-light", isLight);
  refs.themeToggle.textContent = isLight ? "🌞" : "🌙";
  localStorage.setItem("hyperion-theme", theme);
}

function initializeThemeToggle() {
  const savedTheme = localStorage.getItem("hyperion-theme");
  const preferred = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  setTheme(savedTheme || preferred);

  refs.themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("theme-light") ? "dark" : "light";
    setTheme(nextTheme);
  });
}

function clearTimers() {
  clearInterval(pollingTimer);
  clearInterval(simulationTimer);
  clearInterval(countdownTimer);
}

function stopTrackingSession() {
  clearTimers();
  activeTrackingId = "";
  shipmentState = undefined;
  if (mapController) {
    mapController.destroy();
    mapController = null;
  }
}

function showSkeleton(show) {
  refs.loadingSkeleton.classList.toggle("show", show);
}

function showNotification(message) {
  refs.statusNotification.textContent = message;
  refs.statusNotification.classList.add("show");
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => {
    refs.statusNotification.classList.remove("show");
  }, 4_000);
}

function interpolate(origin, destination, progress) {
  const safeProgress = Math.max(0, Math.min(progress, 1));
  return {
    lat: origin.lat + (destination.lat - origin.lat) * safeProgress,
    lng: origin.lng + (destination.lng - origin.lng) * safeProgress
  };
}

function normalizeCoordinates(value, fallback) {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return fallback;
}

function generateDefaultHistory(data) {
  const now = Date.now();
  const milestones = [
    { status: "Picked Up", location: data.origin, timestamp: new Date(now - 36 * 60 * 60 * 1000).toISOString() },
    { status: "In Transit", location: data.location || data.origin, timestamp: new Date(now - 16 * 60 * 60 * 1000).toISOString() }
  ];

  if (/out for delivery/i.test(data.status || "")) {
    milestones.push({
      status: "Out for Delivery",
      location: data.location || data.destination,
      timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString()
    });
  }

  if (/delivered/i.test(data.status || "")) {
    milestones.push({
      status: "Delivered",
      location: data.destination,
      timestamp: new Date(now - 30 * 60 * 1000).toISOString()
    });
  }

  return milestones;
}

function normalizeShipmentData(rawData, id) {
  const origin = rawData.origin || "London Distribution Hub";
  const destination = rawData.destination || "Paris Delivery Center";
  const distance = Math.max(Number(rawData.distance) || 620, 1);
  const initialDistance = Math.max(Number(rawData.currentDistance) || distance * 0.35, 0);
  const currentDistance = Math.min(initialDistance, distance);

  const originCoordinates = normalizeCoordinates(rawData.originCoordinates || rawData.originCoords, { lat: 51.5072, lng: -0.1276 });
  const destinationCoordinates = normalizeCoordinates(rawData.destinationCoordinates || rawData.destinationCoords, { lat: 48.8566, lng: 2.3522 });
  const coordinates = normalizeCoordinates(rawData.coordinates, interpolate(originCoordinates, destinationCoordinates, currentDistance / distance));

  const payload = {
    ...rawData,
    id,
    origin,
    destination,
    distance,
    currentDistance,
    location: rawData.location || rawData.currentLocation || "Shipment in transit",
    status: rawData.status || "In Transit",
    fee: rawData.fee || "$0.00",
    speedKmH: Math.max(Number(rawData.speedKmH) || 58, 8),
    trafficFactor: Math.min(Math.max(Number(rawData.trafficFactor) || 1, 0.7), 1.6),
    originCoordinates,
    destinationCoordinates,
    coordinates,
    history: Array.isArray(rawData.history) && rawData.history.length
      ? rawData.history
      : generateDefaultHistory({ ...rawData, origin, destination, status: rawData.status || "In Transit", location: rawData.location })
  };

  const eta = calculateEtaData(payload);
  payload.estimatedDelivery = rawData.estimatedDelivery || eta.etaISO;

  return payload;
}

function getStatusClass(status) {
  return `status-${(status || "processing").toLowerCase().replace(/\s+/g, "-")}`;
}

function updateStatusNotification(nextStatus) {
  if (!shipmentState || shipmentState.status === nextStatus) {
    return;
  }

  showNotification(`Status changed: ${shipmentState.status} → ${nextStatus}`);
}

function renderShipment(data) {
  const eta = calculateEtaData(data);
  data.estimatedDelivery = eta.etaISO;

  refs.statusBadge.className = `status-badge ${getStatusClass(data.status)}`;
  refs.statusBadge.textContent = data.status;
  refs.locationValue.textContent = data.location;
  refs.routeValue.textContent = `${data.origin} → ${data.destination}`;
  refs.statusValue.textContent = data.status;
  refs.distanceValue.textContent = `${Math.round(data.currentDistance)} km / ${Math.round(data.distance)} km`;
  refs.feeValue.textContent = data.fee;
  refs.etaValue.textContent = formatEtaCountdown(data.estimatedDelivery);

  renderTimeline(refs.timelineContainer, data.history, data.status);

  if (!mapController) {
    mapController = createTrackingMap("map", data);
  } else {
    mapController.updateShipment(data);
  }

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    refs.countdownValue.textContent = formatEtaCountdown(data.estimatedDelivery);
  }, 1_000);
  refs.countdownValue.textContent = eta.countdownText;
}

function stepSimulation() {
  if (!shipmentState) {
    return;
  }

  const traffic = 0.85 + Math.random() * 0.4;
  shipmentState.trafficFactor = Math.min(Math.max(traffic, 0.7), 1.6);

  const distanceGain = shipmentState.speedKmH * shipmentState.trafficFactor * (SIMULATION_INTERVAL / 3_600_000);
  shipmentState.currentDistance = Math.min(shipmentState.distance, shipmentState.currentDistance + distanceGain);

  const progress = shipmentState.currentDistance / shipmentState.distance;
  shipmentState.coordinates = interpolate(shipmentState.originCoordinates, shipmentState.destinationCoordinates, progress);

  if (progress >= 0.85 && !/out for delivery|delivered/i.test(shipmentState.status)) {
    shipmentState.status = "Out for Delivery";
    shipmentState.location = "Final delivery route";
    shipmentState.history.push({
      status: "Out for Delivery",
      location: shipmentState.location,
      timestamp: new Date().toISOString()
    });
    showNotification("Shipment is now out for delivery.");
  }

  if (progress >= 1 && !/delivered/i.test(shipmentState.status)) {
    shipmentState.status = "Delivered";
    shipmentState.location = shipmentState.destination;
    shipmentState.history.push({
      status: "Delivered",
      location: shipmentState.destination,
      timestamp: new Date().toISOString()
    });
    showNotification("Shipment delivered successfully.");
  }

  renderShipment(shipmentState);
}

async function fetchShipment(id) {
  const reference = doc(db, "shipments", id);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeShipmentData(snapshot.data(), id);
}

async function refreshFromServer() {
  if (!activeTrackingId) {
    return;
  }

  try {
    const latest = await fetchShipment(activeTrackingId);
    if (!latest) {
      showNotification("Shipment record is no longer available.");
      return;
    }

    if (shipmentState) {
      latest.currentDistance = Math.max(latest.currentDistance, shipmentState.currentDistance);
    }

    updateStatusNotification(latest.status);
    shipmentState = latest;
    renderShipment(shipmentState);
  } catch (error) {
    console.error("Refresh failed", error);
  }
}

function startRealtimeUpdates() {
  clearInterval(pollingTimer);
  clearInterval(simulationTimer);

  pollingTimer = setInterval(refreshFromServer, POLLING_INTERVAL);
  simulationTimer = setInterval(stepSimulation, SIMULATION_INTERVAL);
}

window.track = async function track() {
  const id = refs.trackingInput.value.trim();

  refs.error.classList.remove("show");
  refs.error.textContent = "";

  if (!id) {
    refs.error.textContent = "❌ Please enter a tracking code";
    refs.error.classList.add("show");
    return;
  }

  refs.trackButton.disabled = true;
  refs.trackButton.innerHTML = '<span class="spinner"></span>Tracking...';
  showSkeleton(true);

  try {
    stopTrackingSession();

    const shipment = await fetchShipment(id);
    if (!shipment) {
      refs.error.textContent = "❌ Tracking code not found. Please check and try again.";
      refs.error.classList.add("show");
      refs.resultContainer.style.display = "none";
      return;
    }

    activeTrackingId = id;
    shipmentState = shipment;

    refs.resultContainer.style.display = "block";
    renderShipment(shipmentState);
    showNotification("Live tracking started. Updates every 30 seconds.");

    startRealtimeUpdates();
  } catch (error) {
    refs.error.textContent = "⚠️ An error occurred. Please try again.";
    refs.error.classList.add("show");
    console.error(error);
  } finally {
    refs.trackButton.disabled = false;
    refs.trackButton.textContent = "Track";
    showSkeleton(false);
  }
};

refs.trackingInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    window.track();
  }
});

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (event) {
    event.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  });
});

initializeThemeToggle();
