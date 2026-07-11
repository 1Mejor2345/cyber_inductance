/**
 * script.js — Flujo del cliente en el Robo-Advisor multi-agente.
 *
 * Pasos:
 *  1. El usuario describe su meta (icebreaker)
 *  2. Se muestra la pregunta de tolerancia al riesgo (estática, sin API)
 *  3. El usuario elige → se llama a POST /api/analizar con los 3 agentes
 *  4. Se renderiza la propuesta real generada por la IA
 *  5. "Enviar al Asesor" confirma que la propuesta ya fue guardada
 */

const appState = {
  currentStep: "icebreaker",
  goalText: "",
  selectedAnswer: null,
  proposalId: null,
  chart: null,
};

// ─── Inicialización ──────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  renderIcebreakerState();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setState(nextState) {
  appState.currentStep = nextState;
}

function getPanel() {
  return document.getElementById("dynamic-panel");
}

function destroyPortfolioChart() {
  if (appState.chart) {
    appState.chart.destroy();
    appState.chart = null;
  }
}

// ─── PASO 1: Icebreaker — el usuario describe su meta ────────────────────────
function renderIcebreakerState() {
  setState("icebreaker");
  destroyPortfolioChart();

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow">
        <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
        Empecemos con tu meta
      </span>

      <h2 class="mt-6 text-4xl font-black leading-tight tracking-normal text-slate-950 md:text-5xl">
        Cuéntame para qué quieres invertir.
      </h2>

      <p class="mt-4 max-w-xl text-lg leading-8 text-slate-500">
        Escríbelo como se lo dirías a una persona: monto, plazo, objetivo o cualquier detalle que tengas en mente.
      </p>

      <form id="goal-form" class="glass-card mt-8 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <textarea
          id="goal-input"
          class="goal-input"
          placeholder="Ej. Quiero comprar un departamento en 5 años y puedo ahorrar $500 al mes..."
        >${appState.goalText}</textarea>

        <button class="primary-button mt-4" type="submit">
          Analizar mi objetivo
          <span aria-hidden="true">→</span>
        </button>
      </form>
    </div>
  `;

  document.getElementById("goal-form").addEventListener("submit", handleGoalSubmit);
}

function handleGoalSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("goal-input");
  appState.goalText = input.value.trim();

  if (!appState.goalText) {
    input.focus();
    input.placeholder = "Escribe tu meta para que la IA pueda ayudarte...";
    return;
  }

  // Sin llamada a API aquí — mostramos directamente la pregunta de riesgo
  renderRiskQuestionState();
}

// ─── PASO 2: Pregunta de tolerancia al riesgo (estática) ─────────────────────
function renderRiskQuestionState() {
  setState("risk-question");

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow">
        <span class="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
        Pregunta del Asesor IA
      </span>

      <h2 class="mt-6 text-4xl font-black leading-tight tracking-normal text-slate-950">
        ¿Cómo reaccionarías si tu portafolio baja un 20% en un mes?
      </h2>

      <p class="mt-4 text-lg leading-8 text-slate-500">
        Esta respuesta, junto con tu meta, determinará tu perfil de inversión.
      </p>

      <div class="choice-grid mt-8">
        <button class="choice-button" type="button" data-option-id="conservative">
          <span class="block text-base">Vendería para no perder más y esperaría oportunidad</span>
          <span class="mt-2 block text-sm font-extrabold text-blue-600">Perfil Conservador</span>
        </button>
        <button class="choice-button" type="button" data-option-id="balanced">
          <span class="block text-base">No haría nada — sé que el mercado se recupera a largo plazo</span>
          <span class="mt-2 block text-sm font-extrabold text-blue-600">Perfil Balanceado</span>
        </button>
        <button class="choice-button" type="button" data-option-id="dynamic">
          <span class="block text-base">Compraría más, es una oportunidad de precio bajo</span>
          <span class="mt-2 block text-sm font-extrabold text-blue-600">Perfil Dinámico</span>
        </button>
      </div>

      <button class="secondary-button mt-6" type="button" id="back-button">
        ← Cambiar mi meta
      </button>
    </div>
  `;

  document.querySelectorAll("[data-option-id]").forEach((btn) => {
    btn.addEventListener("click", () => handleRiskAnswer(btn.dataset.optionId));
  });
  document.getElementById("back-button").addEventListener("click", renderIcebreakerState);
}

// ─── PASO 3: El usuario eligió → llamar a los 3 agentes ──────────────────────
async function handleRiskAnswer(optionId) {
  appState.selectedAnswer = optionId;

  const etiquetas = {
    conservative: "Conservador",
    balanced: "Balanceado",
    dynamic: "Dinámico",
  };

  renderLoaderState(
    `Tus agentes IA están trabajando: perfilando tu riesgo, diseñando tu portafolio y preparando el resumen para el asesor... (puede tomar ~20 segundos)`
  );

  try {
    const response = await fetch("/api/analizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalText: appState.goalText,
        riskAnswer: optionId,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detalle || err.error || "Error del servidor");
    }

    const data = await response.json();
    appState.proposalId = data.id;
    renderPortfolioState(data);
  } catch (error) {
    renderErrorState(error.message);
  }
}

// ─── PASO 3b: Loading ─────────────────────────────────────────────────────────
function renderLoaderState(message) {
  setState("loading");

  getPanel().innerHTML = `
    <div class="view loader-wrap">
      <div class="orb-loader" aria-hidden="true"></div>
      <div>
        <h2 class="text-3xl font-black tracking-normal text-slate-950">Agentes trabajando</h2>
        <p class="mt-3 max-w-md text-lg leading-8 text-slate-500">${message}</p>
      </div>
    </div>
  `;
}

// ─── PASO 3c: Error ───────────────────────────────────────────────────────────
function renderErrorState(message) {
  setState("error");

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow" style="background:#fff1f2;color:#e11d48;">
        ⚠ Ocurrió un error
      </span>
      <h2 class="mt-6 text-3xl font-black text-slate-950">No se pudo generar la propuesta</h2>
      <p class="mt-4 text-lg text-slate-500">${message}</p>
      <button class="primary-button mt-8" type="button" id="retry-button">
        ← Intentar de nuevo
      </button>
    </div>
  `;

  document.getElementById("retry-button").addEventListener("click", renderIcebreakerState);
}

// ─── PASO 4: Mostrar propuesta real de la IA ─────────────────────────────────
function renderPortfolioState(data) {
  setState("portfolio");

  // Construir filas de activos
  const assetRows = (data.asignacion || [])
    .map(
      (asset) => `
      <div class="asset-row">
        <div class="flex items-center gap-3">
          <span class="asset-dot" style="background:${asset.color}"></span>
          <span class="text-sm font-extrabold text-slate-700">${asset.nombre}</span>
        </div>
        <span class="text-sm font-black text-slate-950">${asset.porcentaje}%</span>
      </div>
    `
    )
    .join("");

  // Mostrar reglas usadas en el perfilamiento (HU1 — transparencia)
  const reglasUsadas = (data.reglas_usadas || [])
    .map((r) => `<li class="text-xs text-slate-500">${r}</li>`)
    .join("");

  // Alertas (si las hay)
  const alertasHTML =
    data.alertas && data.alertas.length > 0
      ? `<div class="justification-box mt-4" style="background:#fff7ed;">
          <p class="text-sm font-black uppercase tracking-normal" style="color:#ea580c;">⚠ Alertas detectadas</p>
          <ul class="mt-2 list-disc list-inside">
            ${data.alertas.map((a) => `<li class="text-sm text-slate-600">${a}</li>`).join("")}
          </ul>
        </div>`
      : "";

  getPanel().innerHTML = `
    <div class="view">
      <span class="projection-label">Propuesta generada por IA · ID: ${appState.proposalId}</span>

      <div class="mt-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-4xl font-black leading-tight tracking-normal text-slate-950">
            Perfil: <span style="color:#2563eb">${data.perfil}</span>
          </h2>
          <p class="mt-2 text-base text-slate-500">${data.explicacion_perfil || ""}</p>
        </div>
        <span class="text-sm font-bold text-slate-400">Score: ${data.score ?? "—"}/50</span>
      </div>

      <!-- Reglas visibles — HU1 -->
      <details class="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500 cursor-pointer">
        <summary class="font-bold text-slate-600">📋 Ver reglas de perfilamiento aplicadas</summary>
        <ul class="mt-2 list-disc list-inside space-y-1">${reglasUsadas}</ul>
      </details>

      <!-- Propuesta de portafolio — HU2 -->
      <div class="glass-card mt-6 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <div class="portfolio-grid">
          <div class="chart-shell">
            <canvas id="portfolio-chart" aria-label="Distribución de activos" role="img"></canvas>
          </div>
          <div class="space-y-3">${assetRows}</div>
        </div>

        <div class="justification-box mt-5">
          <p class="text-sm font-black uppercase tracking-normal text-blue-600">Justificación de la IA</p>
          <p class="mt-2 text-sm">${data.justificacion || ""}</p>
        </div>

        <div class="justification-box mt-3" style="background:#f0fdf4;">
          <p class="text-sm font-black uppercase tracking-normal" style="color:#16a34a;">Nivel de riesgo</p>
          <p class="mt-1 text-sm">${data.riesgo || ""}</p>
        </div>

        ${alertasHTML}

        <div class="justification-box mt-3" style="font-size:0.75rem;">
          <strong>⚖ Aviso legal: </strong>${data.disclaimer || ""}
        </div>

        <!-- Explicación para el cliente -->
        <div class="justification-box mt-3" style="background:#eff6ff;">
          <p class="text-sm font-black uppercase tracking-normal text-blue-600">Tu resumen personal</p>
          <p class="mt-2 text-sm">${data.explicacion_cliente || ""}</p>
        </div>

        <div class="mt-5 flex flex-col gap-3 sm:flex-row">
          <button class="primary-button" type="button" id="send-advisor-button">
            Enviar al Asesor Humano →
          </button>
          <button class="secondary-button" type="button" id="restart-button">
            Crear otra meta
          </button>
        </div>
      </div>
    </div>
  `;

  renderPortfolioChart(data.asignacion || []);
  document.getElementById("restart-button").addEventListener("click", renderIcebreakerState);
  document
    .getElementById("send-advisor-button")
    .addEventListener("click", handleSendToAdvisor);
}

// ─── Renderizar gráfica de donut ─────────────────────────────────────────────
function renderPortfolioChart(asignacion) {
  const canvas = document.getElementById("portfolio-chart");
  if (!canvas) return;

  const labels = asignacion.map((a) => a.nombre);
  const values = asignacion.map((a) => a.porcentaje);
  const colors = asignacion.map((a) => a.color);

  destroyPortfolioChart();

  appState.chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 14,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: {
        animateRotate: true,
        animateScale: true,
        duration: 950,
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

// ─── PASO 5: Enviar al asesor (la propuesta ya está guardada en el servidor) ──
function handleSendToAdvisor() {
  const button = document.getElementById("send-advisor-button");
  if (!button) return;

  button.disabled = true;
  button.textContent = "✅ Propuesta enviada al asesor";
  button.style.background = "linear-gradient(135deg, #16a34a, #15803d)";

  // Insertar link al panel del asesor
  const linkWrapper = document.createElement("div");
  linkWrapper.style.cssText = "text-align:center; margin-top:0.75rem;";
  linkWrapper.innerHTML = `
    <a href="/asesor"
       style="font-size:0.85rem;font-weight:700;color:#2563eb;text-decoration:underline;"
       target="_blank">
      Abrir panel del asesor →
    </a>
  `;
  button.parentElement.appendChild(linkWrapper);
}
