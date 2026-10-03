// Admin → Clients (registered client portfolio accounts).
// Every read and write goes through the authenticated server API (/api/admin → api/_lib/clients.js). The browser
// previously wrote Firestore directly, which the security rules reject because the browser has no Firebase
// admin sign-in. Deletion is permanent, keyed by the client's uid, and needs a typed "DELETE" confirmation.

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const fmtDate = (iso) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(+d) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };
const fmtDateTime = (iso) => { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(+d) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); };

export function setupAdminClients({ api, showToast }) {
  const $ = (id) => document.getElementById(id);
  const form = $("clientForm");
  const table = $("clientsTableBody");
  const title = $("clientFormTitle");
  const submitBtn = $("clientSubmitText");
  const cancelBtn = $("clientCancelEdit");
  const exportBtn = $("exportClientsBtn");
  const stats = $("clientsSummary");

  let editingClientId = null;
  let clients = [];
  let policy = null;
  let prices = { xrp: 0, tsla: 0 };
  let loading = false;
  let deleting = null; // client being deleted (prevents duplicate requests)

  const statusOption = $("clientStatus");
  if (statusOption) { statusOption.options[0].textContent = "Active"; statusOption.options[1].textContent = "Deactivated"; }

  function calculatePortfolioValue(client) {
    const holdings = client.portfolios || {};
    return (toNumber(holdings.xrp_holdings) * prices.xrp) + (toNumber(holdings.tsla_holdings) * prices.tsla);
  }

  function renderSummary() {
    const activeCount = clients.filter((client) => client.status === "active").length;
    const totalValue = clients.reduce((acc, client) => acc + calculatePortfolioValue(client), 0);
    stats.innerHTML = `
      <div class="courier-stat"><span>Total Clients</span><strong>${clients.length}</strong></div>
      <div class="courier-stat"><span>Active</span><strong>${activeCount}</strong></div>
      <div class="courier-stat"><span>Deactivated</span><strong>${clients.length - activeCount}</strong></div>
      <div class="courier-stat"><span>Portfolio Value</span><strong>$${totalValue.toFixed(2)}</strong></div>
    `;
  }

  function visibleClients() {
    const q = ($("clientSearch")?.value || "").trim().toLowerCase();
    const st = $("clientStatusFilter")?.value || "all";
    const sort = $("clientSort")?.value || "registered-desc";
    const rows = clients.filter((c) => (st === "all" || c.status === st) && (!q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)));
    const t = (c) => (c.registeredAt ? Date.parse(c.registeredAt) : 0);
    rows.sort(sort === "name-asc" ? (a, b) => a.name.localeCompare(b.name) : sort === "registered-asc" ? (a, b) => t(a) - t(b) : (a, b) => t(b) - t(a));
    return rows;
  }

  function renderClients() {
    renderSummary();
    const rows = visibleClients();
    if (!rows.length) {
      table.innerHTML = '<tr><td colspan="8" class="empty-row">No registered clients found.</td></tr>';
      return;
    }
    table.innerHTML = rows.map((client) => {
      const id = safeText(client.id);
      const active = client.status === "active";
      return `
        <tr data-client="${id}">
          <td class="client-name" data-label="Name">${safeText(client.name || "--")}</td>
          <td data-label="Email">${safeText(client.email || "--")}</td>
          <td data-label="Registered">${safeText(fmtDate(client.registeredAt))}</td>
          <td data-label="Status"><span class="client-state ${active ? "active" : "inactive"}">${active ? "Active" : "Deactivated"}</span></td>
          <td data-label="Shipments"><span title="Shipments are not linked to client accounts in the current data model">Not linked</span></td>
          <td data-label="Last activity">${safeText(fmtDateTime(client.lastActivityAt))}</td>
          <td data-label="Portfolio">$${calculatePortfolioValue(client).toFixed(2)}</td>
          <td data-label="Actions">
            <div class="courier-actions">
              <button type="button" class="btn-action" data-action="view" data-id="${id}">View</button>
              <button type="button" class="btn-action" data-action="edit" data-id="${id}">Edit</button>
              <button type="button" class="btn-action" data-action="quick" data-id="${id}">Quick Edit</button>
              <button type="button" class="btn-action" data-action="toggle" data-id="${id}">${active ? "Deactivate" : "Restore"}</button>
              <button type="button" class="btn-action btn-delete-client" data-action="delete" data-id="${id}">Delete Client</button>
            </div>
          </td>
        </tr>`;
    }).join("");
  }

  async function loadClients({ quiet = false } = {}) {
    if (loading) return;
    loading = true;
    if (!clients.length) table.innerHTML = '<tr><td colspan="8" class="empty-row">Loading clients...</td></tr>';
    try {
      await refreshPrices();
      const res = await api("listClients");
      clients = res.clients || [];
      policy = res.deletionPolicy || policy;
      renderClients();
    } catch (error) {
      if (error.silent) return;
      console.error("[clients] load failed", error.code || "", error.message);
      table.innerHTML = `<tr><td colspan="8" class="empty-row">Client accounts could not be loaded: ${safeText(error.message)}</td></tr>`;
      stats.innerHTML = "";
      if (!quiet) showToast(`Couldn't load clients: ${error.message}`, "error");
    } finally {
      loading = false;
    }
  }

  function loadClientToForm(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;
    editingClientId = selected.id;
    title.innerText = `Edit Client: ${selected.name || selected.email}`;
    submitBtn.innerText = "Update Client";
    cancelBtn.style.display = "inline-flex";
    $("clientName").value = selected.name || "";
    $("clientEmail").value = selected.email || "";
    $("clientPassword").value = "";
    $("clientPassword").placeholder = "New password (leave blank to keep)";
    $("clientStatus").value = selected.status || "active";
    $("clientXrpHoldings").value = toNumber(selected.portfolios?.xrp_holdings);
    $("clientTslaHoldings").value = toNumber(selected.portfolios?.tsla_holdings);
    $("clientMaxXrp").value = toNumber(selected.restrictions?.max_xrp);
    $("clientMaxTsla").value = toNumber(selected.restrictions?.max_tsla);
    $("clientEmail").readOnly = true;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetForm() {
    form.reset();
    editingClientId = null;
    title.innerText = "Create Client";
    submitBtn.innerText = "Save Client";
    cancelBtn.style.display = "none";
    $("clientEmail").readOnly = false;
    $("clientPassword").placeholder = "Password (required for new)";
    $("clientStatus").value = "active";
  }

  async function refreshPrices() {
    try {
      const market = await window.HyperionInvestmentApi?.getMarketSnapshot?.();
      if (market?.xrp?.price && market?.tsla?.price) prices = { xrp: market.xrp.price, tsla: market.tsla.price };
    } catch (error) {
      console.error("Unable to refresh market prices for clients", error);
    }
  }

  const historyFor = (xrp, tsla) => (prices.xrp || prices.tsla ? { xrp_value: xrp * prices.xrp, tsla_value: tsla * prices.tsla } : undefined);

  async function saveClient(event) {
    event.preventDefault();
    const client = {
      name: $("clientName").value.trim(), email: $("clientEmail").value.trim().toLowerCase(), password: $("clientPassword").value,
      status: $("clientStatus").value, xrp_holdings: toNumber($("clientXrpHoldings").value), tsla_holdings: toNumber($("clientTslaHoldings").value),
      max_xrp: toNumber($("clientMaxXrp").value), max_tsla: toNumber($("clientMaxTsla").value)
    };
    if (!client.name || (!editingClientId && !client.email)) { showToast("Client name and email are required", "error"); return; }
    if (!editingClientId && !client.password) { showToast("Password is required for new clients", "error"); return; }
    const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
    try {
      await refreshPrices();
      const res = await api("saveClient", editingClientId
        ? { mode: "update", id: editingClientId, client, history: historyFor(client.xrp_holdings, client.tsla_holdings) }
        : { mode: "create", client, history: historyFor(client.xrp_holdings, client.tsla_holdings) });
      showToast(res.message || "Client saved.", "success");
      resetForm();
      await loadClients({ quiet: true });
    } catch (error) {
      if (!error.silent) showToast(`Client save failed: ${error.message}`, "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function quickEdit(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;
    const xrpInput = prompt("Update XRP holdings", toNumber(selected.portfolios?.xrp_holdings));
    const tslaInput = prompt("Update TSLA holdings", toNumber(selected.portfolios?.tsla_holdings));
    if (xrpInput === null || tslaInput === null) return;
    const xrp = toNumber(xrpInput); const tsla = toNumber(tslaInput);
    try {
      await refreshPrices();
      await api("saveClient", { mode: "update", id: clientId, history: historyFor(xrp, tsla), client: {
        name: selected.name, status: selected.status, xrp_holdings: xrp, tsla_holdings: tsla,
        max_xrp: selected.restrictions?.max_xrp, max_tsla: selected.restrictions?.max_tsla } });
      showToast("✅ Holdings updated", "success");
      await loadClients({ quiet: true });
    } catch (error) {
      if (!error.silent) showToast(`Unable to update holdings: ${error.message}`, "error");
    }
  }

  async function toggleStatus(clientId) {
    const selected = clients.find((client) => client.id === clientId);
    if (!selected) return;
    const next = selected.status === "active" ? "inactive" : "active";
    if (next === "inactive" && !confirm(`Deactivate ${selected.name || selected.email}? They will be signed out and unable to sign in until restored. Nothing is deleted.`)) return;
    try {
      const res = await api("setClientStatus", { id: clientId, status: next });
      showToast(res.message, "success");
      await loadClients({ quiet: true });
    } catch (error) {
      if (!error.silent) showToast(`Unable to update status: ${error.message}`, "error");
    }
  }

  // ---------- view ----------
  function openModal(id) { $(id).classList.add("show"); }
  function closeModal(id) { $(id).classList.remove("show"); }
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));

  function viewClient(clientId) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    $("clientViewTitle").textContent = c.name || c.email;
    const rows = [
      ["Email", c.email], ["Status", c.status === "active" ? "Active" : "Deactivated (cannot sign in)"],
      ["Registered", fmtDateTime(c.registeredAt)], ["Last activity", fmtDateTime(c.lastActivityAt)], ["Last sign-in", fmtDateTime(c.lastSignInAt)],
      ["Sign-in account", c.hasSignIn ? (c.signInDisabled ? "Exists (disabled)" : "Exists (enabled)") : "Not found"],
      ["XRP holdings", toNumber(c.portfolios?.xrp_holdings).toFixed(4)], ["TSLA holdings", toNumber(c.portfolios?.tsla_holdings).toFixed(4)],
      ["Limits", `XRP ${toNumber(c.restrictions?.max_xrp).toFixed(2)} · TSLA ${toNumber(c.restrictions?.max_tsla).toFixed(2)}`],
      ["Portfolio value", `$${calculatePortfolioValue(c).toFixed(2)}`], ["Shipments", "Not linked to client accounts"], ["Client ID", c.id]
    ];
    $("clientViewBody").innerHTML = rows.map(([k, v]) => `<dt>${safeText(k)}</dt><dd>${safeText(v)}</dd>`).join("");
    openModal("clientViewModal");
  }

  // ---------- permanent delete ----------
  const confirmInput = $("clientDeleteConfirm");
  const goBtn = $("clientDeleteGo");
  const errBox = $("clientDeleteErr");
  function openDelete(clientId) {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    deleting = { id: c.id, email: c.email, busy: false };
    $("clientDeleteWho").textContent = `${c.name || "Unnamed client"} · ${c.email || "no email"}`;
    const p = policy || { removes: ["The client's sign-in account", "The client profile", "The client's portfolio history"], keeps: ["All shipments and tracking records"] };
    $("clientDeleteRemoves").innerHTML = p.removes.map((x) => `<li>${safeText(x)}</li>`).join("");
    $("clientDeleteKeeps").innerHTML = p.keeps.map((x) => `<li>${safeText(x)}</li>`).join("");
    confirmInput.value = ""; goBtn.disabled = true; goBtn.textContent = "Delete Client"; errBox.hidden = true; $("clientDeleteHint").hidden = false;
    $("clientDeleteCancel").disabled = false;
    openModal("clientDeleteModal");
    setTimeout(() => confirmInput.focus(), 50);
  }
  function closeDelete() { if (deleting?.busy) return; deleting = null; closeModal("clientDeleteModal"); }
  // Case-insensitive so phone keyboards that auto-capitalise or auto-correct "DELETE" still work.
  const typed = () => confirmInput.value.trim().toUpperCase() === "DELETE";
  confirmInput.addEventListener("input", () => { goBtn.disabled = !typed() || !!deleting?.busy; $("clientDeleteHint").hidden = typed(); });
  confirmInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && typed()) goBtn.click(); });
  $("clientDeleteCancel").addEventListener("click", closeDelete);
  $("clientDeleteModal").addEventListener("click", (e) => { if (e.target.id === "clientDeleteModal") closeDelete(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("clientDeleteModal").classList.contains("show")) closeDelete(); });

  goBtn.addEventListener("click", async () => {
    if (!deleting || deleting.busy || !typed()) return;
    deleting.busy = true;
    const target = deleting;
    goBtn.disabled = true; goBtn.textContent = "Deleting client…"; $("clientDeleteCancel").disabled = true; errBox.hidden = true;
    try {
      const res = await api("deleteClient", { id: target.id, confirm: "DELETE", expectEmail: target.email });
      target.busy = false; closeDelete();
      if (editingClientId === target.id) resetForm();
      // Drop the client from the list and counters right away; then re-read the database (the source of truth).
      clients = clients.filter((c) => c.id !== target.id);
      renderClients();
      showToast(res.partial ? res.message : "Client deleted successfully.", res.partial ? "error" : "success");
      await loadClients({ quiet: true });
    } catch (error) {
      target.busy = false;
      if (error.silent) { closeDelete(); return; }
      console.error("[clients] delete failed", error.code || "", error.status || "", error.message);
      if (error.status === 404) {
        // Already deleted (another tab or a double submit): say so and refresh instead of failing.
        closeDelete();
        showToast("This client no longer exists. The list has been refreshed.", "error");
        await loadClients({ quiet: true });
        return;
      }
      // Show the server's actual reason. Every failure path on the server removes nothing.
      const msg = error.code === "network" ? "Unable to delete client. No client data was removed. Check your connection and try again."
        : /^Unable to delete client/.test(error.message) ? error.message
        : `Unable to delete client. No client data was removed. ${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`;
      errBox.textContent = msg;
      errBox.hidden = false;
      goBtn.textContent = "Delete Client"; goBtn.disabled = !typed(); $("clientDeleteCancel").disabled = false;
      showToast(msg, "error");
    }
  });

  function exportClients() {
    if (!clients.length) { showToast("No clients to export", "error"); return; }
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "Client ID,Name,Email,Status,Registered,Last activity,XRP Holdings,TSLA Holdings,Max XRP,Max TSLA,Portfolio Value",
      ...clients.map((c) => [c.id, c.name, c.email, c.status, c.registeredAt || "", c.lastActivityAt || "", toNumber(c.portfolios?.xrp_holdings), toNumber(c.portfolios?.tsla_holdings),
        toNumber(c.restrictions?.max_xrp), toNumber(c.restrictions?.max_tsla), calculatePortfolioValue(c).toFixed(2)].map(cell).join(","))
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "clients-export.csv"; link.click();
    URL.revokeObjectURL(url);
  }

  table.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "view") viewClient(id);
    if (action === "edit") loadClientToForm(id);
    if (action === "quick") await quickEdit(id);
    if (action === "toggle") await toggleStatus(id);
    if (action === "delete") openDelete(id);
  });
  ["clientSearch", "clientSort", "clientStatusFilter"].forEach((id) => $(id)?.addEventListener("input", renderClients));
  $("clientRefresh")?.addEventListener("click", () => loadClients());

  form.addEventListener("submit", saveClient);
  cancelBtn.addEventListener("click", resetForm);
  exportBtn.addEventListener("click", exportClients);

  loadClients();

  return { refreshClients: () => loadClients({ quiet: true }) };
}
