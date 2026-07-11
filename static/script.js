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
  answers: {},
  currentQuestionIndex: 0,
  proposalId: null,
  chart: null,
};

const PROFILING_QUESTIONS = [
  {
    id: "etapa_vida",
    title: "¿Cuál es tu etapa de vida actual?",
    options: [
      { id: "empezando", text: "Estudiante / Empezando carrera", type: "Conservative" },
      { id: "consolidacion", text: "Consolidación profesional", type: "Dynamic" },
      { id: "retiro", text: "Preparando el retiro / Jubilado", type: "Conservative" }
    ]
  },
  {
    id: "objetivo",
    title: "¿Cuál es el objetivo principal de esta inversión?",
    options: [
      { id: "proteger", text: "Proteger mi dinero contra la inflación", type: "Conservative" },
      { id: "ingresos", text: "Generar ingresos periódicos", type: "Balanced" },
      { id: "crecimiento", text: "Crecimiento a largo plazo o agresivo", type: "Dynamic" }
    ]
  },
  {
    id: "retiro_fondos",
    title: "¿Cuándo estimas que necesitarás retirar una parte significativa de este dinero?",
    options: [
      { id: "corto", text: "En menos de 2 años", type: "Conservative" },
      { id: "medio", text: "Entre 3 y 5 años", type: "Balanced" },
      { id: "largo", text: "En más de 5 años", type: "Dynamic" }
    ]
  },
  {
    id: "conocimiento",
    title: "¿Cómo calificarías tu nivel de conocimiento financiero?",
    options: [
      { id: "novato", text: "Novato (no he invertido antes)", type: "Conservative" },
      { id: "intermedio", text: "Intermedio (conozco acciones y bonos)", type: "Balanced" },
      { id: "avanzado", text: "Avanzado (invierto activamente)", type: "Dynamic" }
    ]
  },
  {
    id: "experiencia_productos",
    title: "¿En cuáles de los siguientes productos has invertido anteriormente?",
    options: [
      { id: "ahorro", text: "Solo cuentas de ahorro o plazo fijo", type: "Conservative" },
      { id: "fondos", text: "Fondos mutuos o ETFs", type: "Balanced" },
      { id: "acciones", text: "Acciones individuales o criptomonedas", type: "Dynamic" }
    ]
  },
  {
    id: "reaccion_caida",
    title: "¿Cómo reaccionarías si tu portafolio baja un 20% en un solo mes?",
    options: [
      { id: "vender", text: "Vendería todo para evitar más pérdidas", type: "Conservative" },
      { id: "esperar", text: "No haría nada, esperaría a que se recupere", type: "Balanced" },
      { id: "comprar", text: "Compraría más, es una oportunidad", type: "Dynamic" }
    ]
  },
  {
    id: "preferencia_riesgo",
    title: "Si tuvieras que elegir entre estas opciones, ¿cuál prefieres?",
    options: [
      { id: "bajo", text: "Ganancias bajas pero sin riesgo de pérdida", type: "Conservative" },
      { id: "medio", text: "Ganancias moderadas con algo de fluctuación", type: "Balanced" },
      { id: "alto", text: "Ganancias altas asumiendo riesgo de perder capital", type: "Dynamic" }
    ]
  },
  {
    id: "estabilidad_ingresos",
    title: "¿Cómo describirías la estabilidad de tus ingresos actuales?",
    options: [
      { id: "variable", text: "Variables / Inestables", type: "Conservative" },
      { id: "estable", text: "Estables pero ajustados", type: "Balanced" },
      { id: "muy_estable", text: "Muy estables y superan mis gastos", type: "Dynamic" }
    ]
  },
  {
    id: "porcentaje_ahorros",
    title: "¿Qué porcentaje de tus ahorros totales representa esta inversión?",
    options: [
      { id: "alto", text: "Más del 50%", type: "Conservative" },
      { id: "medio", text: "Entre 20% y 50%", type: "Balanced" },
      { id: "bajo", text: "Menos del 20%", type: "Dynamic" }
    ]
  },
  {
    id: "emergencia",
    title: "Si tuvieras una emergencia médica o pérdida de empleo, ¿necesitarías tocar este dinero?",
    options: [
      { id: "si", text: "Sí, inmediatamente", type: "Conservative" },
      { id: "probablemente", text: "Probablemente una parte", type: "Balanced" },
      { id: "no", text: "No, tengo un fondo de emergencia separado", type: "Dynamic" }
    ]
  }
];

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
  appState.answers = {};
  appState.currentQuestionIndex = 0;

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

  // Iniciar flujo de preguntas
  renderQuestionState();
}

// ─── PASO 2: Preguntas iterativas ─────────────────────────────────────────────
function renderQuestionState() {
  setState("profiling-question");
  const q = PROFILING_QUESTIONS[appState.currentQuestionIndex];
  const progress = Math.round((appState.currentQuestionIndex / PROFILING_QUESTIONS.length) * 100);

  getPanel().innerHTML = `
    <div class="view">
      <div class="flex items-center justify-between mb-2">
        <span class="eyebrow">
          <span class="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
          Pregunta ${appState.currentQuestionIndex + 1} de ${PROFILING_QUESTIONS.length}
        </span>
        <span class="text-sm font-bold text-slate-400">${progress}% completado</span>
      </div>
      
      <!-- Progress bar -->
      <div class="w-full bg-slate-200 rounded-full h-1.5 mb-6">
        <div class="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
      </div>

      <h2 class="mt-4 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-4xl">
        ${q.title}
      </h2>

      <div class="choice-grid mt-8">
        ${q.options.map(opt => `
          <button class="choice-button" type="button" data-option-id="${opt.id}">
            <span class="block text-base">${opt.text}</span>
          </button>
        `).join("")}
      </div>

      <button class="secondary-button mt-6" type="button" id="back-button">
        ← Atrás
      </button>
    </div>
  `;

  document.querySelectorAll("[data-option-id]").forEach((btn) => {
    btn.addEventListener("click", () => handleQuestionAnswer(q.id, btn.dataset.optionId, q.options.find(o => o.id === btn.dataset.optionId).text));
  });
  
  document.getElementById("back-button").addEventListener("click", () => {
    if (appState.currentQuestionIndex > 0) {
      appState.currentQuestionIndex--;
      renderQuestionState();
    } else {
      renderIcebreakerState();
    }
  });
}

function handleQuestionAnswer(questionId, optionId, optionText) {
  appState.answers[questionId] = optionText;
  appState.currentQuestionIndex++;

  if (appState.currentQuestionIndex < PROFILING_QUESTIONS.length) {
    renderQuestionState();
  } else {
    submitProfiling();
  }
}

// ─── PASO 3: El usuario respondió todo → llamar a los 3 agentes ──────────────────────
async function submitProfiling() {

  renderLoaderState(
    `Tus agentes IA están trabajando: perfilando tu riesgo, diseñando tu portafolio y preparando el resumen para el asesor... (puede tomar ~20 segundos)`
  );

  try {
    const response = await fetch("/api/analizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalText: appState.goalText,
        answers: appState.answers,
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
