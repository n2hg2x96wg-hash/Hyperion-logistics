function toLatLng(point) {
  return [point.lat, point.lng];
}

function lerp(from, to, progress) {
  return {
    lat: from.lat + (to.lat - from.lat) * progress,
    lng: from.lng + (to.lng - from.lng) * progress
  };
}

function animateMarker(marker, from, to, duration = 1000) {
  let startTime;

  const step = (time) => {
    if (!startTime) {
      startTime = time;
    }

    const progress = Math.min((time - startTime) / duration, 1);
    const point = lerp(from, to, progress);
    marker.setLatLng(toLatLng(point));

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };

  requestAnimationFrame(step);
}

function createLiveIcon() {
  return L.divIcon({
    className: "live-marker",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: '<span class="marker-pulse"></span><span class="marker-core"></span>'
  });
}

export function createTrackingMap(containerId, shipment) {
  const map = L.map(containerId, { zoomControl: true, scrollWheelZoom: false });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const originMarker = L.circleMarker(toLatLng(shipment.originCoordinates), {
    radius: 6,
    color: "#10b981",
    weight: 2,
    fillOpacity: 0.8
  }).addTo(map);

  const destinationMarker = L.circleMarker(toLatLng(shipment.destinationCoordinates), {
    radius: 6,
    color: "#f59e0b",
    weight: 2,
    fillOpacity: 0.8
  }).addTo(map);

  const routeLine = L.polyline(
    [
      toLatLng(shipment.originCoordinates),
      toLatLng(shipment.coordinates),
      toLatLng(shipment.destinationCoordinates)
    ],
    { color: "#3b82f6", weight: 4, opacity: 0.75 }
  ).addTo(map);

  const completedLine = L.polyline(
    [toLatLng(shipment.originCoordinates), toLatLng(shipment.coordinates)],
    { color: "#10b981", weight: 4, opacity: 0.9 }
  ).addTo(map);

  const marker = L.marker(toLatLng(shipment.coordinates), { icon: createLiveIcon() }).addTo(map);

  const bounds = L.latLngBounds([
    toLatLng(shipment.originCoordinates),
    toLatLng(shipment.coordinates),
    toLatLng(shipment.destinationCoordinates)
  ]);
  map.fitBounds(bounds, { padding: [30, 30] });

  let lastCoordinates = { ...shipment.coordinates };

  function updateShipment(nextShipment) {
    routeLine.setLatLngs([
      toLatLng(nextShipment.originCoordinates),
      toLatLng(nextShipment.coordinates),
      toLatLng(nextShipment.destinationCoordinates)
    ]);

    completedLine.setLatLngs([
      toLatLng(nextShipment.originCoordinates),
      toLatLng(nextShipment.coordinates)
    ]);

    originMarker.setLatLng(toLatLng(nextShipment.originCoordinates));
    destinationMarker.setLatLng(toLatLng(nextShipment.destinationCoordinates));

    animateMarker(marker, lastCoordinates, nextShipment.coordinates, 1200);
    lastCoordinates = { ...nextShipment.coordinates };
    map.panTo(toLatLng(nextShipment.coordinates), { animate: true, duration: 0.8 });
  }

  function destroy() {
    map.remove();
  }

  return { updateShipment, destroy };
}
