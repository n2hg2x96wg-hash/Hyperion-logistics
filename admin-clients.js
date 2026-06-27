import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const CLIENT_APP_NAME = "hyperion-client-provisioner";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function hashPassword(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function setupAdminClients({ db, firebaseConfig, showToast }) {
  const form = document.getElementById("clientForm");
  const table = document.getElementById("clientsTableBody");
  const title = document.getElementById("clientFormTitle");
  const submitBtn = document.getElementById("clientSubmitText");
  const cancelBtn = document.getElementById("clientCancelEdit");
  const exportBtn = document.getElementById("exportClientsBtn");
  const stats = document.getElementById("clientsSummary");

  let unsubscribeClients = null;
  let editingClientId = null;
  let clients = [];
  let prices = { xrp: 0, tsla: 0 };

  function getProvisionerAuth() {
    const provisionerApp = getApps().find((app) => app.name === CLIENT_APP_NAME) || initializeApp(firebaseConfig, CLIENT_APP_NAME);
    return getAuth(provisionerApp);
  }

  function calculatePortfolioValue(client) {
    const holdings = client.portfolios || {};
    return (toNumber(holdings.xrp_holdings) * prices.xrp) + (toNumber(holdings.tsla_holdings) * prices.tsla);
  }

  function renderSummary() {
    const activeCount = clients.filter((client) => client.status === "active").length;
    const inactiveCount = clients.length - activeCount;
    const totalValue = clients.reduce((acc, client) => acc + calculatePortfolioValue(client), 0);

    stats.innerHTML = `
      <div class="courier-stat"><span>Total Clients</span><strong>${clients.length}</strong></div>
      <div class="courier-stat"><span>Active</span><strong>${activeCount}</strong></div>
      <div class="courier-stat"><span>Inactive</span><strong>${inactiveCount}</strong></div>
      <div class="courier-stat"><span>Portfolio Value</span><strong>$${totalValue.toFixed(2)}</strong></div>
    `;
  }

  function renderClients() {
    if (!clients.length) {
      table.innerHTML = '<tr><td colspan="8" class="empty-row">No clients created yet.</td></tr>';
      renderSummary();
      return;
    }

    table.innerHTML = clients.map((client) => {
      const value = calculatePortfolioValue(client);
      const statusClass = client.status === "active" ? "positive" : "negative";
      return `
        <tr>
          <td>${safeText(client.name || "--")}</td>
          <td>${safeText(client.email || "--")}</td>
          <td><span class="status-badge ${statusClass}">${safeText(client.status || "inactive")}</span></td>
          <td>${toNumber(client.portfolios?.xrp_holdings).toFixed(4)}</td>
          <td>${toNumber(client.portfolios?.tsla_holdings).toFixed(4)}</td>
          <td>$${value.toFixed(2)}</td>
          <td>XRP: ${toNumber(client.restrictions?.max_xrp).toFixed(2)}<br>TSLA: ${toNumber(client.restrictions?.max_tsla).toFixed(2)}</td>
          <td>
            <div class="courier-actions">
              <button class="btn-action" data-action="quick" data-id="${safeText(client.id)}">Quick Edit</button>
              <button class="btn-action" data-action="toggle" data-id="${safeText(client.id)}">${client.status === "active" ? "Disable" : "Enable"}</button>
              <button class="btn-action" data-action="edit" data-id="${safeText(client.id)}">Edit</button>
              <button class="btn-action btn-danger" data-action="delete" data-id="${safeText(client.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    renderSummary();
  }

  function loadClientToForm(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;

    editingClientId = selected.id;
    title.innerText = "Edit Client";
    submitBtn.innerText = "Update Client";
    cancelBtn.style.display = "inline-flex";

    document.getElementById("clientName").value = selected.name || "";
    document.getElementById("clientEmail").value = selected.email || "";
    document.getElementById("clientPassword").value = "";
    document.getElementById("clientStatus").value = selected.status || "active";
    document.getElementById("clientXrpHoldings").value = toNumber(selected.portfolios?.xrp_holdings);
    document.getElementById("clientTslaHoldings").value = toNumber(selected.portfolios?.tsla_holdings);
    document.getElementById("clientMaxXrp").value = toNumber(selected.restrictions?.max_xrp);
    document.getElementById("clientMaxTsla").value = toNumber(selected.restrictions?.max_tsla);

    document.getElementById("clientEmail").readOnly = true;
  }

  function resetForm() {
    form.reset();
    editingClientId = null;
    title.innerText = "Create Client";
    submitBtn.innerText = "Save Client";
    cancelBtn.style.display = "none";
    document.getElementById("clientEmail").readOnly = false;
    document.getElementById("clientStatus").value = "active";
  }

  async function persistHistory(clientId, payload) {
    const dateKey = new Date().toISOString().slice(0, 10);
    const xrpHoldings = toNumber(payload.portfolios?.xrp_holdings);
    const tslaHoldings = toNumber(payload.portfolios?.tsla_holdings);
    const xrpValue = xrpHoldings * prices.xrp;
    const tslaValue = tslaHoldings * prices.tsla;
    await setDoc(doc(db, "portfolio_history", clientId, "history", dateKey), {
      xrp_value: xrpValue,
      tsla_value: tslaValue,
      total_value: xrpValue + tslaValue,
      timestamp: serverTimestamp()
    }, { merge: true });
  }

  async function refreshPrices() {
    try {
      const market = await window.HyperionInvestmentApi?.getMarketSnapshot?.();
      if (market?.xrp?.price && market?.tsla?.price) {
        prices = { xrp: market.xrp.price, tsla: market.tsla.price };
      }
    } catch (error) {
      console.error("Unable to refresh market prices for clients", error);
    }
  }

  async function saveClient(event) {
    event.preventDefault();

    const email = document.getElementById("clientEmail").value.trim().toLowerCase();
    const name = document.getElementById("clientName").value.trim();
    const password = document.getElementById("clientPassword").value;
    const status = document.getElementById("clientStatus").value;
    const xrpHoldings = toNumber(document.getElementById("clientXrpHoldings").value);
    const tslaHoldings = toNumber(document.getElementById("clientTslaHoldings").value);
    const maxXrp = toNumber(document.getElementById("clientMaxXrp").value);
    const maxTsla = toNumber(document.getElementById("clientMaxTsla").value);

    if (!email || !name) {
      showToast("Client name and email are required", "error");
      return;
    }

    if (!editingClientId && !password) {
      showToast("Password is required for new clients", "error");
      return;
    }

    try {
      await refreshPrices();
      let clientId = editingClientId;
      const currentClient = clients.find((client) => client.id === editingClientId);

      if (!clientId) {
        const provisionerAuth = getProvisionerAuth();
        const credential = await createUserWithEmailAndPassword(provisionerAuth, email, password);
        clientId = credential.user.uid;
        await signOut(provisionerAuth);
      }

      const payload = {
        email,
        name,
        status,
        portfolios: {
          xrp_holdings: xrpHoldings,
          tsla_holdings: tslaHoldings,
          last_updated: serverTimestamp()
        },
        restrictions: {
          max_xrp: maxXrp,
          max_tsla: maxTsla
        },
        updated_at: serverTimestamp(),
        created_at: currentClient?.created_at || serverTimestamp(),
        password_hash: password ? await hashPassword(password) : (currentClient?.password_hash || "managed-by-firebase-auth")
      };

      await setDoc(doc(db, "clients", clientId), payload, { merge: true });
      await persistHistory(clientId, payload);

      showToast(editingClientId ? "✅ Client updated" : "✅ Client created", "success");
      resetForm();
    } catch (error) {
      console.error(error);
      showToast(`Client save failed: ${error.message}`, "error");
    }
  }

  async function quickEdit(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;

    const xrpInput = prompt("Update XRP holdings", toNumber(selected.portfolios?.xrp_holdings));
    const tslaInput = prompt("Update TSLA holdings", toNumber(selected.portfolios?.tsla_holdings));
    if (xrpInput === null || tslaInput === null) return;

    const xrpHoldings = toNumber(xrpInput);
    const tslaHoldings = toNumber(tslaInput);
    try {
      await setDoc(doc(db, "clients", clientId), {
        portfolios: {
          xrp_holdings: xrpHoldings,
          tsla_holdings: tslaHoldings,
          last_updated: serverTimestamp()
        },
        updated_at: serverTimestamp()
      }, { merge: true });
      await persistHistory(clientId, {
        portfolios: { xrp_holdings: xrpHoldings, tsla_holdings: tslaHoldings }
      });
      showToast("✅ Holdings updated", "success");
    } catch (error) {
      console.error(error);
      showToast("Unable to update holdings", "error");
    }
  }

  async function toggleStatus(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;
    const nextStatus = selected.status === "active" ? "inactive" : "active";
    try {
      await setDoc(doc(db, "clients", clientId), { status: nextStatus, updated_at: serverTimestamp() }, { merge: true });
      showToast(`✅ Client ${nextStatus}`, "success");
    } catch (error) {
      console.error(error);
      showToast("Unable to update status", "error");
    }
  }

  async function removeClient(clientId) {
    if (!confirm("Delete this client? This removes profile and portfolio data.")) return;
    try {
      await deleteDoc(doc(db, "clients", clientId));
      showToast("✅ Client deleted", "success");
    } catch (error) {
      console.error(error);
      showToast("Unable to delete client", "error");
    }
  }

  function exportClients() {
    if (!clients.length) {
      showToast("No clients to export", "error");
      return;
    }
    const csv = [
      "Client ID,Name,Email,Status,XRP Holdings,TSLA Holdings,Max XRP,Max TSLA,Portfolio Value",
      ...clients.map((client) => [
        client.id,
        client.name,
        client.email,
        client.status,
        toNumber(client.portfolios?.xrp_holdings),
        toNumber(client.portfolios?.tsla_holdings),
        toNumber(client.restrictions?.max_xrp),
        toNumber(client.restrictions?.max_tsla),
        calculatePortfolioValue(client).toFixed(2)
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clients-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  table.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "edit") loadClientToForm(id);
    if (action === "quick") await quickEdit(id);
    if (action === "toggle") await toggleStatus(id);
    if (action === "delete") await removeClient(id);
  });

  form.addEventListener("submit", saveClient);
  cancelBtn.addEventListener("click", resetForm);
  exportBtn.addEventListener("click", exportClients);

  async function loadClientsRealtime() {
    await refreshPrices();
    if (unsubscribeClients) unsubscribeClients();
    unsubscribeClients = onSnapshot(collection(db, "clients"), (snapshot) => {
      clients = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      clients.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderClients();
    }, (error) => {
      console.error(error);
      showToast("Unable to load clients", "error");
    });
  }

  loadClientsRealtime();

  return {
    refreshClients: loadClientsRealtime
  };
}
