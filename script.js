
function track(){
  const id = document.getElementById("tracking").value;
  const data = JSON.parse(localStorage.getItem(id));

  if(!data){
    document.getElementById("result").innerHTML = "Tracking ID not found.";
    return;
  }

  document.getElementById("result").innerHTML = `
    <div class='card'>
      <b>Status:</b> ${data.status}<br/>
      <b>Location:</b> ${data.location}<br/>
      <b>Outstanding Fee:</b> $${data.fee}
    </div>
  `;
}

function save(){
  const id = document.getElementById("id").value;
  const status = document.getElementById("status").value;
  const location = document.getElementById("location").value;
  const fee = document.getElementById("fee").value;

  localStorage.setItem(id, JSON.stringify({status, location, fee}));
  alert("Shipment saved successfully");
}
