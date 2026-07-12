/* ═══════════════════════════════════════════════════════════════
   CYBER INDUCTANCE — Script del Dashboard del Asesor
   Lógica de interacción, filtrado, modales y llamadas API
   ═══════════════════════════════════════════════════════════════ */

// ─── ESTADO GLOBAL ──────────────────────────────────────────────
const state = {
  propuestas: [],
  stats: {},
  filtroActual: "todos",
  chart: null,
};

// ─── INICIALIZACIÓN ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  if (page === "dashboard") {
    initDashboard();
  } else if (page === "detalle") {
    initDetalle();
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function initDashboard() {
  setupFiltros();
  await cargarPropuestas();
}

function setupFiltros() {
  document.querySelectorAll("[data-filtro]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filtro]").forEach((b) =>
        b.classList.remove("filter-btn--active")
      );
      btn.classList.add("filter-btn--active");
      state.filtroActual = btn.dataset.filtro;
      cargarPropuestas();
    });
  });
}

async function cargarPropuestas() {
  try {
    const url = state.filtroActual === "todos"
      ? "/api/asesor/propuestas"
      : `/api/asesor/propuestas?estado=${state.filtroActual}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("Error al cargar propuestas");

    const data = await res.json();
    state.propuestas = data.propuestas;
    state.stats = data.stats;

    renderKPIs(data.stats);
    renderTabla(data.propuestas);
  } catch (err) {
    console.error("Error cargando propuestas:", err);
    showToast("Error al cargar datos del servidor", "error");
  }
}

function renderKPIs(stats) {
  const el = (id) => document.getElementById(id);
  if (el("kpi-pendientes")) el("kpi-pendientes").textContent = stats.pendientes;
  if (el("kpi-aprobadas"))  el("kpi-aprobadas").textContent = stats.aprobadas;
  if (el("kpi-rechazadas")) el("kpi-rechazadas").textContent = stats.rechazadas;
  if (el("kpi-total"))      el("kpi-total").textContent = stats.total;
}

function renderTabla(propuestas) {
  const tbody = document.getElementById("proposals-tbody");
  if (!tbody) return;

  if (propuestas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="table-empty">
            <div class="table-empty__icon">📋</div>
            <div class="table-empty__text">No hay propuestas con este filtro</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = propuestas
    .map((p) => {
      const estadoClass = {
        pendiente: "pending",
        aprobada: "approved",
        rechazada: "rejected",
      }[p.estado] || "pending";

      const estadoTexto = {
        pendiente: "Pendiente",
        aprobada: "Aprobada",
        rechazada: "Rechazada",
      }[p.estado] || p.estado;

      const fecha = formatearFecha(p.fecha_creacion);
      const meta = p.meta_usuario || p.goal || "Sin meta registrada";
      const metaCorta = meta.length > 55 ? meta.substring(0, 55) + "…" : meta;

      return `
        <tr>
          <td><span class="table-id">#${p.id}</span></td>
          <td><span class="table-meta" title="${escapeHtml(meta)}">${escapeHtml(metaCorta)}</span></td>
          <td><span class="table-profile">${escapeHtml(p.perfil_ia || "N/A")}</span></td>
          <td><span class="table-date">${fecha}</span></td>
          <td>
            <span class="status-badge status-badge--${estadoClass}">
              <span class="status-badge__dot"></span>
              ${estadoTexto}
            </span>
          </td>
          <td>
            <a href="/asesor/propuesta/${p.id}" class="table-action-btn">
              Ver Detalle →
            </a>
          </td>
        </tr>
      `;
    })
    .join("");
}


// ═══════════════════════════════════════════════════════════════
// DETALLE DE PROPUESTA
// ═══════════════════════════════════════════════════════════════

async function initDetalle() {
  const propuestaId = document.body.dataset.propuestaId;
  if (!propuestaId) return;

  try {
    const res = await fetch(`/api/asesor/propuesta/${propuestaId}`);
    if (!res.ok) throw new Error("Error al cargar detalle");

    const data = await res.json();
    renderDetalleData(data.propuesta);
    renderHistorial(data.historial);
    renderChart(data.propuesta);
    setupAcciones(data.propuesta);
  } catch (err) {
    console.error("Error cargando detalle:", err);
    showToast("Error al cargar el detalle de la propuesta", "error");
  }
}

function renderDetalleData(p) {
  const el = (id) => document.getElementById(id);

  if (el("det-meta"))       el("det-meta").textContent = p.meta_usuario || p.goal || "—";
  if (el("det-perfil"))     el("det-perfil").textContent = p.perfil_ia || "—";
  if (el("det-proyeccion")) el("det-proyeccion").textContent = p.proyeccion_anual || "—";
  if (el("det-fecha"))      el("det-fecha").textContent = formatearFecha(p.fecha_creacion);
  if (el("det-version"))    el("det-version").textContent = p.version_reglas || "—";
  if (el("det-modelo"))     el("det-modelo").textContent = p.modelo_ia || "—";
  if (el("det-justificacion")) el("det-justificacion").textContent = p.aiJustification || "—";

  // Estado badge
  const badgeEl = el("det-estado-badge");
  if (badgeEl) {
    const estadoClass = { pendiente: "pending", aprobada: "approved", rechazada: "rejected" }[p.estado] || "pending";
    const estadoTexto = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" }[p.estado] || p.estado;
    badgeEl.className = `status-badge status-badge--${estadoClass}`;
    badgeEl.innerHTML = `<span class="status-badge__dot"></span>${estadoTexto}`;
  }

  // Assets
  const assetsEl = el("det-assets");
  if (assetsEl && p.assets) {
    assetsEl.innerHTML = p.assets
      .map(
        (a) => `
        <div class="detail-asset-row">
          <div class="detail-asset-row__left">
            <span class="detail-asset-dot" style="background:${a.color}"></span>
            <span class="detail-asset-name">${escapeHtml(a.name)}</span>
          </div>
          <span class="detail-asset-value">${a.value}%</span>
        </div>
      `
      )
      .join("");
  }

  // Ocultar botones si ya no está pendiente
  if (p.estado !== "pendiente") {
    const btnAprobar = el("btn-aprobar");
    const btnRechazar = el("btn-rechazar");
    if (btnAprobar) btnAprobar.disabled = true;
    if (btnRechazar) btnRechazar.disabled = true;
  }
}

function renderChart(p) {
  const canvas = document.getElementById("portfolio-chart");
  if (!canvas || !p.assets) return;

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  state.chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: p.assets.map((a) => a.name),
      datasets: [
        {
          data: p.assets.map((a) => a.value),
          backgroundColor: p.assets.map((a) => a.color),
          borderWidth: 0,
          hoverOffset: 10,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: 800,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed}%`,
          },
        },
      },
    },
  });
}

function renderHistorial(historial) {
  const container = document.getElementById("det-historial");
  if (!container) return;

  if (!historial || historial.length === 0) {
    container.innerHTML = `<div class="audit-log-empty">📝 Sin registros de auditoría aún</div>`;
    return;
  }

  container.innerHTML = historial
    .map((log) => {
      const actionClass = log.accion === "aprobada" ? "approved" : "rejected";
      const actionIcon = log.accion === "aprobada" ? "✅" : "❌";
      return `
        <div class="audit-log-item">
          <div class="audit-log-item__header">
            <span class="audit-log-item__action audit-log-item__action--${actionClass}">
              ${actionIcon} ${log.accion}
            </span>
            <span class="audit-log-item__timestamp">${formatearFecha(log.timestamp)}</span>
          </div>
          <div class="audit-log-item__detail">
            <strong>${escapeHtml(log.asesor)}</strong> (${escapeHtml(log.cargo || "")})
            · Firma: <code>${log.firma_id}</code>
            · Reglas: ${log.version_reglas}
          </div>
          ${log.nota ? `<div class="audit-log-item__detail" style="margin-top:0.35rem;font-style:italic;">"${escapeHtml(log.nota)}"</div>` : ""}
        </div>
      `;
    })
    .join("");
}

function setupAcciones(propuesta) {
  const btnAprobar = document.getElementById("btn-aprobar");
  const btnRechazar = document.getElementById("btn-rechazar");

  if (btnAprobar) {
    btnAprobar.addEventListener("click", () => abrirModal("modal-aprobar"));
  }
  if (btnRechazar) {
    btnRechazar.addEventListener("click", () => abrirModal("modal-rechazar"));
  }

  // Cerrar modales
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.dataset.closeModal;
      cerrarModal(modalId);
    });
  });

  // Click fuera del modal para cerrar
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cerrarModal(overlay.id);
      }
    });
  });

  // Form de aprobación
  const formAprobar = document.getElementById("form-aprobar");
  if (formAprobar) {
    formAprobar.addEventListener("submit", (e) => {
      e.preventDefault();
      ejecutarAprobacion(propuesta.id);
    });
  }

  // Form de rechazo
  const formRechazar = document.getElementById("form-rechazar");
  if (formRechazar) {
    formRechazar.addEventListener("submit", (e) => {
      e.preventDefault();
      ejecutarRechazo(propuesta.id);
    });
  }

  // Contador de caracteres para rechazo
  const textareaRechazo = document.getElementById("nota-rechazo");
  const charCount = document.getElementById("char-count-rechazo");
  if (textareaRechazo && charCount) {
    textareaRechazo.addEventListener("input", () => {
      const len = textareaRechazo.value.length;
      charCount.textContent = `${len}/20 caracteres mínimo`;
      charCount.className = len >= 20
        ? "modal-char-count"
        : "modal-char-count modal-char-count--error";
    });
  }
}


// ─── ACCIONES DE APROBACIÓN / RECHAZO ───────────────────────────

async function ejecutarAprobacion(idPropuesta) {
  const nota = document.getElementById("nota-aprobacion")?.value || "";
  const btnConfirm = document.querySelector("#form-aprobar .modal-btn-confirm");

  try {
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = "Procesando...";
    }

    const res = await fetch("/api/asesor/aprobar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_propuesta: idPropuesta, nota }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Error al aprobar");
    }

    cerrarModal("modal-aprobar");
    showToast("✅ Propuesta aprobada exitosamente", "success");

    // Recargar datos después de un breve momento
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (err) {
    showToast(err.message, "error");
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = "Confirmar Aprobación";
    }
  }
}

async function ejecutarRechazo(idPropuesta) {
  const motivo = document.querySelector('input[name="motivo"]:checked')?.value || "";
  const nota = document.getElementById("nota-rechazo")?.value || "";
  const btnConfirm = document.querySelector("#form-rechazar .modal-btn-confirm");

  if (nota.length < 20) {
    showToast("La nota debe tener al menos 20 caracteres", "error");
    return;
  }

  try {
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = "Procesando...";
    }

    const res = await fetch("/api/asesor/rechazar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_propuesta: idPropuesta, motivo, nota }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Error al rechazar");
    }

    cerrarModal("modal-rechazar");
    showToast("❌ Propuesta rechazada y registrada", "success");

    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (err) {
    showToast(err.message, "error");
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.textContent = "Registrar Rechazo";
    }
  }
}


// ─── MODALES ────────────────────────────────────────────────────

function abrirModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("modal-overlay--active");
    document.body.style.overflow = "hidden";
  }
}

function cerrarModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("modal-overlay--active");
    document.body.style.overflow = "";
  }
}


// ─── TOAST NOTIFICATION ─────────────────────────────────────────

function showToast(message, type = "success") {
  // Remover toast existente
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const icon = type === "success" ? "✅" : "⚠️";
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 300ms ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}


// ─── UTILIDADES ─────────────────────────────────────────────────

function formatearFecha(isoString) {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const dia = date.getDate();
    const mes = meses[date.getMonth()];
    const hora = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return `${dia} ${mes}, ${hora}:${min}`;
  } catch {
    return isoString;
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
