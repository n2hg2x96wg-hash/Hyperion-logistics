function track() {
  const id = document.getElementById("tracking").value.trim();
  const result = document.getElementById("result");

  const data = JSON.parse(localStorage.getItem(id));

  if (!id) {
    result.innerHTML = `<div class="status error">Please enter a tracking ID.</div>`;
    return;
  }

  if (!data) {
    result.innerHTML = `<div class="status error">Tracking ID not found.</div>`;
    return;
  }

  const statusColor = getStatusColor(data.status);

  result.innerHTML = `
    <div class="result-card">
      <div class="row">
        <span>📦 Status</span>
        <span class="badge ${statusColor}">${data.status}</span>
      </div>

      <div class="row">
        <span>📍 Location</span>
        <a href="${data.location}" target="_blank">View Map</a>
      </div>

      <div class="row">
        <span>💳 Outstanding Fee</span>
        <strong>$${data.fee}</strong>
      </div>
    </div>
  `;
}

function getStatusColor(status) {
  const map = {
    "Processing": "blue",
    "Shipped": "purple",
    "In transit": "cyan",
    "Out for delivery": "orange",
    "Delivered": "green",
    "On hold": "red",
    "Payment pending": "yellow"
  };

  return map[status] || "cyan";
}
