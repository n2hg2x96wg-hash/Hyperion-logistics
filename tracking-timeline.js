function formatEventTime(timestamp) {
  const value = Date.parse(timestamp || "");
  if (!Number.isFinite(value)) {
    return "Just now";
  }
  return new Date(value).toLocaleString();
}

function createEventNode(event, isCurrent) {
  const item = document.createElement("div");
  item.className = `timeline-item${isCurrent ? " is-current" : ""}`;

  const dot = document.createElement("span");
  dot.className = "timeline-dot";

  const content = document.createElement("div");
  content.className = "timeline-content";

  const title = document.createElement("p");
  title.className = "timeline-title";
  title.textContent = event.status || "In Transit";

  const location = document.createElement("p");
  location.className = "timeline-location";
  location.textContent = event.location || "Location update pending";

  const time = document.createElement("p");
  time.className = "timeline-time";
  time.textContent = formatEventTime(event.timestamp);

  content.append(title, location, time);
  item.append(dot, content);
  return item;
}

export function renderTimeline(container, history, currentStatus) {
  container.innerHTML = "";

  const records = Array.isArray(history) ? [...history] : [];
  records.sort((a, b) => Date.parse(a.timestamp || "") - Date.parse(b.timestamp || ""));

  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "timeline-empty";
    empty.textContent = "Timeline updates will appear as the shipment moves.";
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const normalizedCurrent = (currentStatus || "").toLowerCase();

  records.forEach((event, index) => {
    const normalizedEvent = (event.status || "").toLowerCase();
    const isCurrent = normalizedCurrent && normalizedCurrent === normalizedEvent
      ? true
      : index === records.length - 1;

    fragment.appendChild(createEventNode(event, isCurrent));
  });

  container.appendChild(fragment);
}
