function save() {
  const id = document.getElementById("id").value.trim();
  const status = document.getElementById("status").value.trim();
  const location = document.getElementById("location").value.trim();
  const fee = document.getElementById("fee").value.trim();

  if (!id || !status || !location || !fee) {
    alert("Please fill all fields");
    return;
  }

  const shipment = {
    status,
    location,
    fee
  };

  localStorage.setItem("shipment_" + id, JSON.stringify(shipment));

  alert("Shipment saved successfully ✅");

  document.getElementById("id").value = "";
  document.getElementById("status").value = "";
  document.getElementById("location").value = "";
  document.getElementById("fee").value = "";
}


function track() {
  const id = document.getElementById("tracking").value.trim();
  const result = document.getElementById("result");

  if (!id) {
    result.innerHTML = "<p style='color:red'>Enter tracking ID</p>";
    return;
  }

  const data = localStorage.getItem("shipment_" + id);

  if (!data) {
    result.innerHTML = "<p style='color:red'>Tracking ID not found.</p>";
    return;
  }

  const shipment = JSON.parse(data);

  result.innerHTML = `
    <div class="result-box">
      <p><strong>Status:</strong> ${shipment.status}</p>
      <p><strong>Location:</strong> ${shipment.location}</p>
      <p><strong>Outstanding Fee:</strong> $${shipment.fee}</p>
    </div>
  `;
}
