const state = {
  batchId: null,
  rows: [],
  summary: null,
  companies: [],
  activeCompanyId: null,
  savedPurchases: [],
  salesBatchId: null,
  salesRows: [],
  savedSales: [],
  withholdings: [],
  savedPages: { purchase: 1, sales: 1, withholding: 1 },
};
const $ = (selector) => document.querySelector(selector);
const months = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const statusLabels = {
  PENDIENTE: "Pendiente",
  DESCARGADO: "Descargado",
  YA_DESCARGADO: "Ya descargado",
  XML_CARGADO_MANUAL: "XML manual",
  FUERA_DE_RANGO: "Fuera de rango",
  NO_ENCONTRADO: "No encontrado",
  NO_AUTORIZADO: "No autorizado",
  ERROR: "Error",
};

initialize();
async function initialize() {
  const now = new Date();
  $("#salesMethod").insertAdjacentHTML(
    "beforeend",
    '<option value="PUNTO_DOC">Punto Doc</option><option value="CONTIFICO">Contífico</option>',
  );
  $("#salesMethod")
    .closest(".form-grid")
    .insertAdjacentHTML(
      "beforeend",
      '<label id="sriSourceField"><span>Fuente del Facturador SRI</span><select id="sriSource"><option value="TXT">TXT para consultar al SRI</option><option value="XML">XML directos</option></select></label><label class="hidden" id="pointDocSourceField"><span>Fuente de Punto Doc</span><select id="pointDocSource"><option value="EXCEL">Excel de emitidos</option><option value="XML">XML directos</option></select></label>',
    );
  $("#reportYear").innerHTML = Array.from(
    { length: 7 },
    (_, i) => now.getFullYear() - i,
  )
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("");
  $("#semesterYear").innerHTML = $("#reportYear").innerHTML;
  $("#reportMonth").innerHTML = months
    .map(
      (m, i) =>
        `<option value="${i + 1}" ${i === now.getMonth() ? "selected" : ""}>${m}</option>`,
    )
    .join("");
  $("#reportFrom").value = `${now.getFullYear()}-01-01`;
  $("#reportTo").value = now.toISOString().slice(0, 10);
  $("#statusFilter").innerHTML += Object.entries(statusLabels)
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");
  try {
    const { user } = await api("/api/auth/me");
    $("#accountName").textContent = user.name;
  } catch {
    return;
  }
  await loadCompanies();
  try {
    const h = await api("/api/health");
    $(".connection").classList.add("online");
    $("#connectionText").textContent = `Conectado · ${h.environment}`;
  } catch {
    $("#connectionText").textContent = "Sin conexión";
  }
}

async function loadCompanies(preferredId) {
  try {
    const data = await api("/api/companies");
    state.companies = data.companies;
    state.activeCompanyId =
      preferredId || data.activeCompanyId || data.companies[0]?.id || null;
    $("#companySelect").innerHTML = data.companies.length
      ? data.companies
          .map(
            (c) =>
              `<option value="${c.id}" ${c.id === state.activeCompanyId ? "selected" : ""}>${esc(c.businessName)}</option>`,
          )
          .join("")
      : '<option value="">Primero registra una empresa</option>';
    updateSelectedCompany();
  } catch (err) {
    toast(`Base de datos: ${err.message}`);
  }
}
function updateSelectedCompany() {
  const id = Number($("#companySelect").value) || null;
  const company = state.companies.find((c) => c.id === id);
  $("#batchCompanyId").value = id || "";
  $("#salesCompanyId").value = id || "";
  $("#companyTaxId").value = company?.taxId || "";
  $("#editCompanyButton").disabled = !company;
  $("#reportCompany").textContent = company
    ? `Empresa: ${company.businessName} · ${company.taxId}`
    : "Selecciona una empresa para generar el reporte.";
  if (company) {
    loadCompanySummary(company.id);
    loadSavedPurchases();
    loadSavedSales();
    loadWithholdings();
  } else {
    $("#purchaseCount").textContent = "0 facturas guardadas";
    $("#saleCount").textContent = "0 facturas guardadas";
  }
}
async function loadCompanySummary(id) {
  try {
    const summary = await api(`/api/companies/${id}/summary`);
    $("#purchaseCount").textContent = `${summary.purchases} facturas guardadas`;
    $("#saleCount").textContent = `${summary.sales} facturas guardadas`;
  } catch {}
}
async function loadSavedPurchases() {
  const id = Number($("#companySelect").value);
  if (!id) return;
  try {
    const data = await api(`/api/companies/${id}/purchases`);
    state.savedPurchases = data.invoices;
    renderSavedPurchases();
  } catch (err) {
    toast(err.message);
  }
}
async function loadSavedSales() {
  const id = Number($("#companySelect").value);
  if (!id) return;
  try {
    const data = await api(`/api/companies/${id}/sales`);
    state.savedSales = data.invoices;
    renderSavedSales();
  } catch (err) {
    toast(err.message);
  }
}
async function loadWithholdings() {
  const id = Number($("#companySelect").value);
  if (!id) return;
  try {
    const data = await api(`/api/companies/${id}/withholdings`);
    state.withholdings = data.withholdings;
    renderWithholdings();
  } catch (err) {
    toast(err.message);
  }
}
$("#companySelect").addEventListener("change", async (e) => {
  clearPendingFiles();
  updateSelectedCompany();
  const id = Number(e.target.value);
  if (!id) return;
  try {
    await api(`/api/companies/active/${id}`, { method: "PUT" });
    state.activeCompanyId = id;
  } catch (err) {
    toast(err.message);
  }
});
$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    location.replace("/login");
  } catch (error) {
    toast(error.message);
  }
});
function clearPendingFiles() {
  for (const id of [
    "txtFile",
    "purchaseXmlFiles",
    "salesTxtFile",
    "salesXmlFiles",
    "withholdingTxt",
    "xmlFiles",
  ]) {
    const input = $("#" + id);
    if (input) input.value = "";
  }
  $("#txtLabel").textContent = "Seleccionar archivo del SRI";
  $("#purchaseXmlLabel").textContent = "Seleccionar XML de compras";
  configureSalesImport();
  const withholdingXml = $("#withholdingImportMethod").value === "XML";
  $("#withholdingTxtLabel").textContent = withholdingXml
    ? "Seleccionar XML de retenciones"
    : "Seleccionar TXT de retenciones";
}
$("#newCompanyButton").addEventListener("click", () => openCompanyDialog());
$("#editCompanyButton").addEventListener("click", () =>
  openCompanyDialog(
    state.companies.find((c) => c.id === Number($("#companySelect").value)),
  ),
);
$("#closeCompanyDialog").addEventListener("click", () =>
  $("#companyDialog").close(),
);
$("#cancelCompanyButton").addEventListener("click", () =>
  $("#companyDialog").close(),
);
$("#companyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  busy(button, true, "Guardando");
  try {
    const company = await api(id ? `/api/companies/${id}` : "/api/companies", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    await api(`/api/companies/active/${company.id}`, { method: "PUT" });
    await loadCompanies(company.id);
    $("#companyDialog").close();
    toast("Empresa guardada y seleccionada.");
  } catch (err) {
    toast(err.message);
  } finally {
    busy(button, false, "Guardar empresa");
  }
});
function openCompanyDialog(company) {
  const form = $("#companyForm");
  form.reset();
  form.elements.id.value = company?.id || "";
  form.elements.taxId.value = company?.taxId || "";
  form.elements.businessName.value = company?.businessName || "";
  form.elements.tradeName.value = company?.tradeName || "";
  form.elements.email.value = company?.email || "";
  form.elements.phone.value = company?.phone || "";
  $("#companyDialogTitle").textContent = company
    ? "Editar empresa"
    : "Nueva empresa";
  $("#companyDialog").showModal();
  form.elements.taxId.focus();
}

$("#txtFile").addEventListener("change", (e) => {
  $("#txtLabel").textContent =
    e.target.files[0]?.name || "Seleccionar archivo del SRI";
});
$("#purchaseImportMethod").addEventListener("change", (e) => {
  const directXml = e.target.value === "XML";
  $("#batchForm").classList.toggle("hidden", directXml);
  $("#purchaseXmlForm").classList.toggle("hidden", !directXml);
});
$("#batchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  busy(button, true, "Importando");
  try {
    const data = await api("/api/batches", {
      method: "POST",
      body: new FormData(e.currentTarget),
    });
    state.batchId = data.id;
    state.rows = data.rows;
    state.summary = {
      total: data.total,
      downloaded: 0,
      existing: data.omitted || 0,
      manual: 0,
      outsideRange: 0,
      errors: data.invalid,
    };
    $("#workspace").classList.remove("hidden");
    render();
    toast(`${data.total} nuevas; consultando automáticamente al SRI…`);
    busy(button, true, "Consultando SRI");
    await processPurchaseBatch();
  } catch (err) {
    toast(err.message);
  } finally {
    busy(button, false, "Importar lote");
  }
});
$("#purchaseXmlFiles").addEventListener("change", (e) => {
  const count = e.target.files.length;
  $("#purchaseXmlLabel").textContent = count
    ? `${count} XML seleccionado${count === 1 ? "" : "s"}`
    : "Seleccionar XML de compras";
});
$("#purchaseXmlForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const companyId = Number($("#companySelect").value);
  if (!companyId) return toast("Selecciona primero una empresa.");
  const button = e.submitter;
  busy(button, true, "Importando XML");
  try {
    const data = await api(`/api/companies/${companyId}/purchases/direct-xml`, {
      method: "POST",
      body: new FormData(e.currentTarget),
    });
    await Promise.all([loadSavedPurchases(), loadCompanySummary(companyId)]);
    toast(
      `${data.accepted} compras guardadas; ${data.omitted} duplicadas omitidas; ${data.rejected.length} rechazadas.`,
    );
    if (data.rejected.length) console.warn(data.rejected);
    e.currentTarget.reset();
    $("#purchaseXmlLabel").textContent = "Seleccionar XML de compras";
  } catch (err) {
    toast(err.message);
  } finally {
    busy(button, false, "Importar XML");
  }
});
async function processPurchaseBatch() {
  $("#processHint").textContent =
    "Procesando el lote con concurrencia controlada…";
  try {
    const data = await api(`/api/batches/${state.batchId}/process`, {
      method: "POST",
    });
    state.rows = data.results;
    state.summary = data.summary;
    enableExports();
    render();
    const companyId = Number($("#companySelect").value);
    await Promise.all([loadSavedPurchases(), loadCompanySummary(companyId)]);
    toast(`Proceso terminado: ${data.summary.downloaded} descargadas.`);
    $("#processHint").textContent =
      "Proceso terminado. Carga los XML que continúan pendientes o genera el Excel disponible.";
  } catch (err) {
    toast(err.message);
    $("#processHint").textContent = "No se pudo completar el proceso.";
  }
}
$("#xmlFiles").addEventListener("change", async (e) => {
  if (!e.target.files.length) return;
  const form = new FormData();
  for (const file of e.target.files) form.append("xmls", file);
  try {
    toast("Validando XML…");
    const data = await api(`/api/batches/${state.batchId}/xml`, {
      method: "POST",
      body: form,
    });
    state.rows = data.result.results;
    state.summary = data.result.summary;
    enableExports();
    render();
    toast(
      `${data.accepted.length} XML aceptados; ${data.rejected.length} rechazados.`,
    );
    if (data.rejected.length) console.warn(data.rejected);
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.value = "";
  }
});
$("#excelButton").addEventListener("click", () => {
  if (!state.batchId) return;
  toast("Generando Excel…");
  window.location.href = `/api/batches/${state.batchId}/excel`;
});
$("#salesTxtFile").addEventListener("change", (e) => {
  $("#salesTxtLabel").textContent =
    e.target.files[0]?.name || "Seleccionar TXT de ventas";
});
$("#salesMethod").addEventListener("change", configureSalesImport);
$("#sriSource").addEventListener("change", configureSalesImport);
$("#pointDocSource").addEventListener("change", configureSalesImport);
function configureSalesImport() {
  const method = $("#salesMethod").value;
  const sri = method === "SRI";
  const pointDoc = method === "PUNTO_DOC";
  const contifico = method === "CONTIFICO";
  const sriXml = sri && $("#sriSource").value === "XML";
  const pointXml = pointDoc && $("#pointDocSource").value === "XML";
  const directXml = method === "SECURITY_DATA" || sriXml || pointXml;
  const excel = (pointDoc && !pointXml) || contifico;
  $("#sriSourceField").classList.toggle("hidden", !sri);
  $("#pointDocSourceField").classList.toggle("hidden", !pointDoc);
  const input = $("#salesTxtFile");
  input.value = "";
  input.multiple = directXml;
  input.accept = directXml
    ? ".xml,text/xml,application/xml"
    : excel
      ? ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : ".txt,.tsv,text/plain";
  $("#salesFileIcon").textContent = directXml ? "XML" : excel ? "EXCEL" : "TXT";
  const provider =
    method === "SRI"
      ? "Facturador SRI"
      : method === "SECURITY_DATA"
        ? "Security Data"
        : "Punto Doc";
  $("#salesTxtLabel").textContent = directXml
    ? `Seleccionar XML de ${provider}`
    : excel
      ? `Seleccionar Excel de ${contifico ? "Contífico" : "Punto Doc"}`
      : "Seleccionar TXT de ventas";
  $("#salesFileHint").textContent = directXml
    ? "Puedes seleccionar varios XML autorizados"
    : excel
      ? contifico
        ? "Reporte de Documentos de Contífico (.xls o .xlsx)"
        : "Hoja Emitidos con bases e impuestos"
      : "Exportación del Facturador SRI";
  $("#salesImportButton").textContent = directXml
    ? "Importar XML"
    : excel
      ? "Importar Excel"
      : "Importar ventas";
}
$("#salesBatchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  const method = $("#salesMethod").value;
  const sri = method === "SRI";
  const pointDoc = method === "PUNTO_DOC";
  const contifico = method === "CONTIFICO";
  const sriXml = sri && $("#sriSource").value === "XML";
  const pointXml = pointDoc && $("#pointDocSource").value === "XML";
  const directXml = method === "SECURITY_DATA" || sriXml || pointXml;
  const excel = (pointDoc && !pointXml) || contifico;
  busy(button, true, "Importando");
  try {
    let data;
    if (directXml) {
      const source = new FormData(e.currentTarget);
      const form = new FormData();
      form.set("companyId", source.get("companyId"));
      form.set(
        "provider",
        sri ? "SRI" : pointDoc ? "PUNTO_DOC" : "SECURITY_DATA",
      );
      for (const file of $("#salesTxtFile").files) form.append("xmls", file);
      data = await api("/api/sales/direct-xml", { method: "POST", body: form });
      toast(
        `${data.accepted} XML guardados; ${data.omitted || 0} existentes; ${data.rejected.length} rechazados.`,
      );
    } else if (excel) {
      const source = new FormData(e.currentTarget);
      const form = new FormData();
      form.set("companyId", source.get("companyId"));
      form.set("excel", $("#salesTxtFile").files[0]);
      data = await api(
        contifico ? "/api/sales/contifico/excel" : "/api/sales/punto-doc/excel",
        {
          method: "POST",
          body: form,
        },
      );
      toast(
        `${data.accepted} ventas guardadas; ${data.omitted || 0} existentes omitidas.`,
      );
    } else {
      data = await api("/api/sales/batches", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      state.salesBatchId = data.id;
      state.salesRows = data.rows;
      $("#salesWorkspace").classList.remove("hidden");
      renderSalesProcess();
      toast(`${data.total} ventas nuevas; consultando automáticamente al SRI…`);
      busy(button, true, "Consultando SRI");
      await processSalesBatch();
      return;
    }
    await loadSavedSales();
    await loadCompanySummary(Number($("#companySelect").value));
    document.querySelector('[data-sales-view="saved"]').click();
  } catch (err) {
    toast(err.message);
  } finally {
    busy(
      button,
      false,
      directXml ? "Importar XML" : excel ? "Importar Excel" : "Importar ventas",
    );
  }
});
async function processSalesBatch() {
  try {
    const data = await api(`/api/batches/${state.salesBatchId}/process`, {
      method: "POST",
    });
    state.salesRows = data.results;
    renderSalesProcess();
    $("#salesXmlFiles").disabled = false;
    $("#salesXmlButton").classList.remove("disabled");
    await loadSavedSales();
    await loadCompanySummary(Number($("#companySelect").value));
    toast(`${data.summary.downloaded} ventas descargadas.`);
  } catch (err) {
    toast(err.message);
  }
}
$("#salesXmlFiles").addEventListener("change", async (e) => {
  if (!e.target.files.length) return;
  const form = new FormData();
  for (const file of e.target.files) form.append("xmls", file);
  try {
    const data = await api(`/api/batches/${state.salesBatchId}/xml`, {
      method: "POST",
      body: form,
    });
    state.salesRows = data.result.results;
    renderSalesProcess();
    const companyId = Number($("#companySelect").value);
    await Promise.all([loadSavedSales(), loadCompanySummary(companyId)]);
    toast(`${data.accepted.length} XML aceptados.`);
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.value = "";
  }
});
$("#withholdingTxt").addEventListener("change", (e) => {
  const directXml = $("#withholdingImportMethod").value === "XML";
  const count = e.target.files.length;
  $("#withholdingTxtLabel").textContent = count
    ? directXml
      ? `${count} XML seleccionado${count === 1 ? "" : "s"}`
      : e.target.files[0].name
    : directXml
      ? "Seleccionar XML de retenciones"
      : "Seleccionar TXT de retenciones";
});
$("#withholdingImportMethod").addEventListener("change", (e) => {
  const directXml = e.target.value === "XML";
  const input = $("#withholdingTxt");
  input.value = "";
  input.multiple = directXml;
  input.accept = directXml
    ? ".xml,text/xml,application/xml"
    : ".txt,.tsv,text/plain";
  $("#withholdingFileIcon").textContent = directXml ? "XML" : "TXT";
  $("#withholdingTxtLabel").textContent = directXml
    ? "Seleccionar XML de retenciones"
    : "Seleccionar TXT de retenciones";
  $("#withholdingFileHint").textContent = directXml
    ? "Puedes seleccionar varios comprobantes autorizados"
    : "Debe contener la columna CLAVE_ACCESO";
  $("#withholdingForm button").textContent = directXml
    ? "Importar XML"
    : "Consultar e importar";
});
$("#withholdingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  const companyId = Number($("#companySelect").value);
  const directXml = $("#withholdingImportMethod").value === "XML";
  busy(button, true, directXml ? "Importando XML" : "Consultando SRI");
  try {
    let body = new FormData(e.currentTarget);
    if (directXml) {
      body = new FormData();
      for (const file of $("#withholdingTxt").files) body.append("xmls", file);
    }
    const data = await api(
      `/api/companies/${companyId}/withholdings/${directXml ? "direct-xml" : "import"}`,
      { method: "POST", body },
    );
    $("#withholdingSummary").classList.remove("hidden");
    $("#withholdingSummary").innerHTML = [
      ["Procesadas", data.results.length + data.omitted],
      ["Guardadas", data.accepted],
      ["Existentes", data.omitted],
      ["Rechazadas", data.rejected.length],
    ]
      .map(
        ([label, value]) =>
          `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`,
      )
      .join("");
    $("#withholdingResultsWrap").classList.remove("hidden");
    $("#withholdingResultsBody").innerHTML = data.results
      .map(
        (item) =>
          `<tr><td class="key">${esc(item.key)}</td><td><span class="badge ${item.status === "GUARDADA" ? "success" : "error"}">${esc(item.status)}</span></td><td>${esc((item.invoices || []).join(", ") || "—")}</td><td>${esc(item.message || `Renta ${money(item.incomeTaxWithheld)} · IVA ${money(item.vatWithheld)}`)}</td></tr>`,
      )
      .join("");
    await loadWithholdings();
    toast(
      `${data.accepted} retenciones guardadas; ${data.rejected.length} rechazadas.`,
    );
    e.currentTarget.reset();
    $("#withholdingTxtLabel").textContent = directXml
      ? "Seleccionar XML de retenciones"
      : "Seleccionar TXT de retenciones";
  } catch (err) {
    toast(err.message);
  } finally {
    busy(button, false, directXml ? "Importar XML" : "Consultar e importar");
  }
});
document.querySelectorAll("[data-sales-view]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-sales-view]")
      .forEach((item) => item.classList.toggle("active", item === button));
    const view = button.dataset.salesView;
    $("#savedSalesView").classList.toggle("hidden", view !== "saved");
    $("#importSalesView").classList.toggle("hidden", view !== "import");
    $("#savedWithholdingsView").classList.toggle(
      "hidden",
      view !== "withholdings",
    );
    $("#importWithholdingsView").classList.toggle(
      "hidden",
      view !== "import-withholdings",
    );
    if (view === "saved") loadSavedSales();
    if (view === "withholdings") loadWithholdings();
  }),
);
$("#search").addEventListener("input", renderTable);
$("#statusFilter").addEventListener("change", renderTable);
[
  ["purchase", "savedSearch", renderSavedPurchases],
  ["sales", "salesSearch", renderSavedSales],
  ["withholding", "withholdingSearch", renderWithholdings],
].forEach(([prefix, searchId, render]) => {
  $("#" + searchId).addEventListener("input", () => {
    state.savedPages[prefix] = 1;
    render();
  });
  for (const suffix of ["From", "To", "Limit"]) {
    const element = $("#" + prefix + suffix);
    element.addEventListener(
      element.tagName === "SELECT" ? "change" : "input",
      () => {
        state.savedPages[prefix] = 1;
        render();
      },
    );
  }
  $("#" + prefix + "Prev").addEventListener("click", () => {
    state.savedPages[prefix]--;
    render();
  });
  $("#" + prefix + "Next").addEventListener("click", () => {
    state.savedPages[prefix]++;
    render();
  });
});
document.querySelectorAll("[data-purchase-view]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-purchase-view]")
      .forEach((item) => item.classList.toggle("active", item === button));
    const saved = button.dataset.purchaseView === "saved";
    $("#savedPurchasesView").classList.toggle("hidden", !saved);
    $("#importPurchasesView").classList.toggle("hidden", saved);
    if (saved) loadSavedPurchases();
  }),
);
$("#reportMode").addEventListener("change", (e) => {
  const mode = e.target.value;
  $("#monthlyReportFields").classList.toggle("hidden", mode !== "month");
  $("#semesterReportFields").classList.toggle("hidden", mode !== "semester");
  $("#customReportFields").classList.toggle("hidden", mode !== "custom");
});
$("#reportForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = Number($("#companySelect").value);
  if (!id) return toast("Seleccione una empresa.");
  const movement = String(new FormData(e.currentTarget).get("movement"));
  const mode = $("#reportMode").value;
  let from, to;
  if (mode === "custom") {
    from = $("#reportFrom").value;
    to = $("#reportTo").value;
  } else if (mode === "semester") {
    const year = Number($("#semesterYear").value),
      semester = Number($("#reportSemester").value);
    from = semester === 1 ? `${year}-01-01` : `${year}-07-01`;
    to = semester === 1 ? `${year}-06-30` : `${year}-12-31`;
  } else {
    const year = Number($("#reportYear").value),
      month = Number($("#reportMonth").value);
    from = `${year}-${String(month).padStart(2, "0")}-01`;
    to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  if (!from || !to) return toast("Completa las fechas del reporte.");
  if (from > to)
    return toast("La fecha inicial no puede superar la fecha final.");
  const params = new URLSearchParams({ movement, from, to });
  window.location.href = `/api/companies/${id}/reports?${params}`;
});
document.querySelectorAll(".module-tab").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".module-tab")
      .forEach((tab) => tab.classList.toggle("active", tab === button));
    const module = button.dataset.module;
    $("#purchasesModule").classList.toggle("hidden", module !== "purchases");
    $("#salesModule").classList.toggle("hidden", module !== "sales");
    $("#reportsModule").classList.toggle("hidden", module !== "reports");
  }),
);

function render() {
  renderSummary();
  renderTable();
}
function renderSummary() {
  const s = state.summary || {};
  const stats = [
    ["Total", s.total || state.rows.length],
    ["Descargadas", s.downloaded || 0],
    ["Ya existentes", s.existing || 0],
    ["XML manual", s.manual || 0],
    ["Fuera de rango", s.outsideRange || 0],
    ["Errores", s.errors || 0],
  ];
  $("#summary").innerHTML = stats
    .map(
      ([l, v]) =>
        `<div class="stat"><small>${l}</small><strong>${v}</strong></div>`,
    )
    .join("");
}
function renderTable() {
  const q = $("#search").value.toLowerCase();
  const filter = $("#statusFilter").value;
  const rows = state.rows.filter(
    (r) =>
      (!filter || r.status === filter) &&
      (!q ||
        `${r.documentNumber} ${r.issuerBusinessName} ${r.accessKey}`
          .toLowerCase()
          .includes(q)),
  );
  $("#emptyState").style.display = rows.length ? "none" : "block";
  $("#resultsBody").innerHTML = rows
    .map(
      (r) =>
        `<tr><td><strong>${esc(r.documentNumber)}</strong></td><td class="provider">${esc(r.issuerBusinessName)}</td><td class="key">${esc(r.accessKey)}</td><td><span class="badge ${badge(r.status)}">${statusLabels[r.status] || r.status}</span></td><td class="result">${esc(r.message || resultText(r.status))}</td></tr>`,
    )
    .join("");
}
function renderSavedPurchases() {
  const q = $("#savedSearch").value.toLowerCase();
  const rows = filterSavedRows(
    state.savedPurchases.filter(
      (r) =>
        !q ||
        `${r.documentNumber} ${r.issuerTaxId} ${r.issuerBusinessName}`
          .toLowerCase()
          .includes(q),
    ),
    "purchase",
  );
  $("#savedEmpty").style.display = rows.length ? "none" : "block";
  $("#savedPurchasesBody").innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.issueDate)}</td><td><strong>${esc(r.documentNumber)}</strong></td><td class="key">${esc(r.issuerTaxId)}</td><td class="provider">${esc(r.issuerBusinessName)}</td><td class="money">${money(r.subtotal)}</td><td class="money">${money(r.vatTotal)}</td><td class="money"><strong>${money(r.total)}</strong></td></tr>`,
    )
    .join("");
}
function renderSavedSales() {
  const q = $("#salesSearch").value.toLowerCase();
  const rows = filterSavedRows(
    state.savedSales.filter(
      (r) =>
        !q ||
        `${r.documentNumber} ${r.issuerTaxId} ${r.issuerBusinessName}`
          .toLowerCase()
          .includes(q),
    ),
    "sales",
  );
  $("#salesEmpty").style.display = rows.length ? "none" : "block";
  $("#savedSalesBody").innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.issueDate)}</td><td><strong>${esc(r.documentNumber)}</strong></td><td class="key">${esc(r.issuerTaxId)}</td><td>${esc(r.issuerBusinessName)}</td><td class="money">${money(r.subtotal)}</td><td class="money">${money(r.vatTotal)}</td><td class="money"><strong>${money(r.total)}</strong></td><td class="money">${r.incomeTaxWithheld == null ? "" : money(r.incomeTaxWithheld)}</td><td class="money">${r.vatWithheld == null ? "" : money(r.vatWithheld)}</td></tr>`,
    )
    .join("");
}
function renderWithholdings() {
  const q = $("#withholdingSearch").value.toLowerCase();
  const rows = filterSavedRows(
    state.withholdings.filter(
      (r) =>
        !q ||
        `${r.documentNumber} ${r.issuerTaxId} ${r.issuerBusinessName} ${r.supportDocuments}`
          .toLowerCase()
          .includes(q),
    ),
    "withholding",
  );
  $("#withholdingsEmpty").style.display = rows.length ? "none" : "block";
  $("#savedWithholdingsBody").innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.issueDate)}</td><td><strong>${esc(r.documentNumber)}</strong></td><td><span class="key">${esc(r.issuerTaxId)}</span><br>${esc(r.issuerBusinessName)}</td><td>${esc(r.supportDocuments)}<br><small>${r.linkedDocumentCount === r.documentCount ? "Factura vinculada" : "Pendiente: factura aún no guardada"}</small></td><td class="money">${money(r.incomeTaxWithheld)}</td><td class="money">${money(r.vatWithheld)}</td><td class="money"><strong>${money(r.totalWithheld)}</strong></td><td>${r.lineCount}</td></tr>`,
    )
    .join("");
}
function filterSavedRows(rows, prefix) {
  const from = $("#" + prefix + "From").value;
  const to = $("#" + prefix + "To").value;
  const filtered = rows.filter((row) => {
    const [day, month, year] = String(row.issueDate || "").split("/");
    const date =
      year && month && day
        ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
        : "";
    return (!from || date >= from) && (!to || date <= to);
  });
  const limit = Number($("#" + prefix + "Limit").value);
  const pageCount = Math.max(1, Math.ceil(filtered.length / limit));
  const page = Math.min(Math.max(1, state.savedPages[prefix]), pageCount);
  state.savedPages[prefix] = page;
  const visible = filtered.slice((page - 1) * limit, page * limit);
  $("#" + prefix + "FilterCount").textContent =
    `Total: ${filtered.length} ${prefix === "withholding" ? "retenciones" : "facturas"}`;
  if (prefix === "sales") {
    const keys = new Set(
      filtered.flatMap((row) =>
        String(row.withholdingKeys || "")
          .split(",")
          .filter(Boolean),
      ),
    );
    $("#salesRetentionCount").textContent =
      `Retenciones asociadas: ${keys.size}`;
  }
  $("#" + prefix + "Page").textContent = `Página ${page} de ${pageCount}`;
  $("#" + prefix + "Prev").disabled = page <= 1;
  $("#" + prefix + "Next").disabled = page >= pageCount;
  return visible;
}
function renderSalesProcess() {
  const count = (s) => state.salesRows.filter((r) => r.status === s).length;
  $("#salesSummary").innerHTML = [
    ["Total", state.salesRows.length],
    ["Descargadas", count("DESCARGADO")],
    ["Existentes", count("YA_DESCARGADO")],
    ["XML manual", count("XML_CARGADO_MANUAL")],
    ["Fuera de rango", count("FUERA_DE_RANGO")],
    ["Errores", count("ERROR")],
  ]
    .map(
      ([l, v]) =>
        `<div class="stat"><small>${l}</small><strong>${v}</strong></div>`,
    )
    .join("");
  $("#salesResultsBody").innerHTML = state.salesRows
    .map(
      (r) =>
        `<tr><td><strong>${esc(r.documentNumber)}</strong></td><td>${esc(r.issuerBusinessName)}</td><td class="key">${esc(r.accessKey)}</td><td><span class="badge ${badge(r.status)}">${statusLabels[r.status] || r.status}</span></td><td>${esc(r.message || resultText(r.status))}</td></tr>`,
    )
    .join("");
}
function enableExports() {
  $("#xmlFiles").disabled = false;
  $("#xmlButton").classList.remove("disabled");
  const ready = state.rows.some((r) =>
    ["DESCARGADO", "YA_DESCARGADO", "XML_CARGADO_MANUAL"].includes(r.status),
  );
  $("#excelButton").disabled = !ready;
  $("#excelButton").classList.toggle("disabled", !ready);
}
function resultText(s) {
  return s === "DESCARGADO"
    ? "XML recuperado del SRI"
    : s === "YA_DESCARGADO"
      ? "Archivo local verificado"
      : s === "XML_CARGADO_MANUAL"
        ? "Archivo manual validado"
        : "";
}
function badge(s) {
  return ["DESCARGADO", "YA_DESCARGADO", "XML_CARGADO_MANUAL"].includes(s)
    ? "ok"
    : s === "FUERA_DE_RANGO"
      ? "warn"
      : s === "ERROR" || s === "NO_AUTORIZADO"
        ? "error"
        : "info";
}
function busy(button, on, label) {
  button.disabled = on;
  button.innerHTML = on ? `<span class="spinner"></span>${label}` : label;
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3500);
}
async function api(url, options) {
  const headers = new Headers(options?.headers);
  headers.set("X-Defac-Request", "1");
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (res.status === 401) location.replace("/login");
  const data = await res.json().catch(() => ({ error: "Respuesta inválida" }));
  if (!res.ok) throw new Error(data.error || "Error en la solicitud");
  return data;
}
function esc(v) {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function money(v) {
  return new Intl.NumberFormat("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
}
