const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function formatEtaCountdown(targetTimestamp) {
  const targetTime = typeof targetTimestamp === "number" ? targetTimestamp : Date.parse(targetTimestamp);

  if (!Number.isFinite(targetTime)) {
    return "ETA unavailable";
  }

  const diff = targetTime - Date.now();
  if (diff <= 0) {
    return "Arrived";
  }

  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((diff % HOUR_MS) / (60 * 1000));

  if (days > 0) {
    return `Arrives in ${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (hours > 0) {
    return `Arrives in ${hours} hour${hours === 1 ? "" : "s"}, ${minutes} min`;
  }

  return `Arrives in ${Math.max(minutes, 1)} min`;
}

export function calculateEtaData(shipment) {
  const totalDistance = Math.max(Number(shipment.distance) || 0, 1);
  const travelled = Math.min(Math.max(Number(shipment.currentDistance) || 0, 0), totalDistance);
  const remainingDistance = Math.max(totalDistance - travelled, 0);

  if (remainingDistance <= 0 || /delivered/i.test(shipment.status || "")) {
    const etaISO = new Date().toISOString();
    return {
      etaISO,
      progress: 1,
      remainingDistance: 0,
      countdownText: "Arrived"
    };
  }

  const baseSpeed = Math.max(Number(shipment.speedKmH) || 58, 10);
  const trafficFactor = Number(shipment.trafficFactor) || 1;
  const effectiveSpeed = Math.max(baseSpeed * trafficFactor, 8);
  const remainingMs = (remainingDistance / effectiveSpeed) * HOUR_MS;

  const fallbackEtaMs = Date.now() + remainingMs;
  const incomingEtaMs = Date.parse(shipment.estimatedDelivery || "");
  const targetMs = Number.isFinite(incomingEtaMs)
    ? Math.max(incomingEtaMs, Date.now() + 60 * 1000)
    : fallbackEtaMs;

  const etaISO = new Date(targetMs).toISOString();

  return {
    etaISO,
    progress: travelled / totalDistance,
    remainingDistance,
    countdownText: formatEtaCountdown(targetMs)
  };
}
