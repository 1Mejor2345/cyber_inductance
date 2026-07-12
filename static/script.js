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
  isLoggedIn: false,
  userName: "",
  pollingInterval: null,  // Para el polling en tiempo real
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
  initializeApp();
});

function initializeApp() {
  // Verificar si ya está logueado (session storage)
  const savedUser = sessionStorage.getItem("userName");
  if (savedUser) {
    appState.isLoggedIn = true;
    appState.userName = savedUser;
    showLoggedInState();
    renderIcebreakerState();
  } else {
    showLoginState();
  }
}

// ─── LOGIN STATE MANAGEMENT ──────────────────────────────────────────────────
function showLoginState() {
  // Mostrar login box
  document.getElementById("login-box").classList.remove("hidden");
  document.getElementById("user-info").classList.add("hidden");
  
  // Mostrar blocker en panel derecho
  document.getElementById("login-blocker").classList.remove("hidden");
  
  // Setup login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }
}

function showLoggedInState() {
  // Ocultar login box
  document.getElementById("login-box").classList.add("hidden");
  document.getElementById("user-info").classList.remove("hidden");
  
  // Mostrar dashboard de propuestas
  document.getElementById("dashboard-propuestas").classList.remove("hidden");
  
  // Actualizar nombre de usuario
  document.getElementById("user-name").textContent = appState.userName;
  
  // Ocultar blocker en panel derecho
  document.getElementById("login-blocker").classList.add("hidden");
  
  // Setup logout button
  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }

  // Setup refresh dashboard button
  const refreshButton = document.getElementById("refresh-dashboard");
  if (refreshButton) {
    refreshButton.addEventListener("click", cargarDashboard);
  }

  // Cargar dashboard inicial
  cargarDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("login-error");
  const errorMessage = document.getElementById("login-error-message");
  const submitButton = event.target.querySelector('button[type="submit"]');
  
  // Validación básica
  if (!username || !password) {
    showLoginError("Por favor completa todos los campos");
    return;
  }
  
  // Deshabilitar botón
  submitButton.disabled = true;
  submitButton.textContent = "Verificando...";
  
  try {
    const response = await fetch("/api/login_cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      // Login exitoso
      appState.isLoggedIn = true;
      appState.userName = data.nombre || username;
      
      // Guardar en session storage
      sessionStorage.setItem("userName", appState.userName);
      
      // Ocultar error si estaba visible
      errorDiv.classList.add("hidden");
      
      // Actualizar UI
      showLoggedInState();
      renderIcebreakerState();
      
      // Mostrar mensaje de éxito breve
      submitButton.textContent = "✓ ¡Bienvenido!";
      submitButton.classList.add("!bg-emerald-600");
      
    } else {
      // Login fallido
      showLoginError(data.error || "Credenciales incorrectas");
      submitButton.disabled = false;
      submitButton.textContent = "Ingresar →";
    }
    
  } catch (error) {
    showLoginError("Error de conexión. Intenta nuevamente.");
    submitButton.disabled = false;
    submitButton.textContent = "Ingresar →";
  }
}

function showLoginError(message) {
  const errorDiv = document.getElementById("login-error");
  const errorMessage = document.getElementById("login-error-message");
  
  errorMessage.textContent = message;
  errorDiv.classList.remove("hidden");
  
  // Auto-hide después de 5 segundos
  setTimeout(() => {
    errorDiv.classList.add("hidden");
  }, 5000);
}

function handleLogout() {
  if (!confirm("¿Estás seguro de que deseas cerrar sesión?")) {
    return;
  }
  
  // Detener polling si está activo
  stopPolling();
  
  // Limpiar estado
  appState.isLoggedIn = false;
  appState.userName = "";
  appState.currentStep = "icebreaker";
  appState.goalText = "";
  appState.answers = {};
  appState.currentQuestionIndex = 0;
  appState.proposalId = null;
  
  // Limpiar session storage
  sessionStorage.removeItem("userName");
  
  // Destruir chart si existe
  destroyPortfolioChart();
  
  // Limpiar panel dinámico
  getPanel().innerHTML = "";
  
  // Ocultar dashboard
  document.getElementById("dashboard-propuestas").classList.add("hidden");
  
  // Volver a estado de login
  showLoginState();
}

// ─── DASHBOARD DE PROPUESTAS ─────────────────────────────────────────────────
async function cargarDashboard() {
  const listContainer = document.getElementById("propuestas-list");
  if (!listContainer) return;

  try {
    // CORRECCIÓN: Usar nombre de usuario correcto
    const usuario = appState.userName || sessionStorage.getItem("userName") || "cliente_demo";
    const response = await fetch(`/api/mis_propuestas?usuario=${usuario}`);
    
    if (!response.ok) {
      throw new Error("Error al cargar propuestas");
    }

    const data = await response.json();
    console.log(`📊 Dashboard: ${data.propuestas.length} propuestas para ${usuario}`);
    renderDashboard(data.propuestas);

  } catch (error) {
    console.error("Error al cargar dashboard:", error);
    listContainer.innerHTML = `
      <div class="rounded-xl bg-red-50 border border-red-200 p-4 text-center">
        <p class="text-xs font-semibold text-red-700">
          Error al cargar propuestas: ${error.message}
        </p>
      </div>
    `;
  }
}

function renderDashboard(propuestas) {
  const listContainer = document.getElementById("propuestas-list");
  if (!listContainer) return;

  if (propuestas.length === 0) {
    listContainer.innerHTML = `
      <div class="rounded-xl bg-slate-50 border border-slate-200 p-6 text-center">
        <div class="text-3xl mb-2">📋</div>
        <p class="text-sm font-bold text-slate-600">No tienes propuestas aún</p>
        <p class="text-xs text-slate-500 mt-1">Completa el cuestionario para generar una</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = propuestas.map((prop) => {
    const estadoConfig = getEstadoConfig(prop.estado_revision);
    const fechaCreacion = formatearFechaCorta(prop.fecha_creacion);

    return `
      <div class="rounded-xl bg-white border-2 ${estadoConfig.borderClass} p-4 shadow-sm transition-all hover:shadow-md">
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-mono font-bold text-slate-400">#${prop.id}</span>
              <span class="${estadoConfig.badgeClass}">
                ${estadoConfig.icon} ${prop.estado_revision}
              </span>
            </div>
            <p class="text-sm font-bold text-slate-950 line-clamp-1">${prop.perfil || "—"}</p>
          </div>
        </div>

        <p class="text-xs text-slate-600 line-clamp-2 mb-2">
          ${prop.goal || "Sin descripción"}
        </p>

        <div class="flex items-center justify-between text-xs text-slate-400">
          <span>📅 ${fechaCreacion}</span>
          ${prop.asesor ? `<span>👤 ${prop.asesor}</span>` : ""}
        </div>

        ${prop.observaciones && prop.observaciones !== "Sin observaciones" && !prop.observaciones.includes("panel standalone") 
          ? `<div class="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              <span class="font-bold">💬 Nota:</span> ${prop.observaciones}
            </div>`
          : ""
        }
      </div>
    `;
  }).join("");
}

function getEstadoConfig(estado) {
  const configs = {
    "Pendiente": {
      icon: "⏳",
      badgeClass: "inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-bold text-yellow-700",
      borderClass: "border-yellow-200"
    },
    "Aprobada": {
      icon: "✅",
      badgeClass: "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700",
      borderClass: "border-emerald-200"
    },
    "Rechazada": {
      icon: "❌",
      badgeClass: "inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700",
      borderClass: "border-red-200"
    },
    "Generada": {
      icon: "📝",
      badgeClass: "inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600",
      borderClass: "border-slate-200"
    }
  };

  return configs[estado] || configs["Generada"];
}

function formatearFechaCorta(isoString) {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const dia = date.getDate();
    const mes = date.getMonth() + 1;
    const hora = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return `${dia}/${mes} ${hora}:${min}`;
  } catch {
    return isoString;
  }
}

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
  const total = PROFILING_QUESTIONS.length;
  const actual = appState.currentQuestionIndex + 1; // 1-indexed para mostrar al usuario
  const progress = Math.round((actual / total) * 100);

  getPanel().innerHTML = `
    <div class="view">
      <div class="flex items-center justify-between mb-2">
        <span class="eyebrow">
          <span class="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
          Pregunta ${actual} de ${total}
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
  // Iniciar loader con mensajes dinámicos
  renderDynamicLoaderState();

  try {
    const response = await fetch("/api/analizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalText: appState.goalText,
        answers: appState.answers,
      }),
    });

    // Detener el loader dinámico
    stopDynamicLoader();

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detalle || err.error || "Error del servidor");
    }

    const data = await response.json();
    appState.proposalId = data.id;
    renderPortfolioState(data);
  } catch (error) {
    stopDynamicLoader();
    renderErrorState(error.message);
  }
}

// ─── PASO 3b: Loading Dinámico con frases rotativas ─────────────────────────────────
let loaderInterval = null;
let currentLoadingPhrase = 0;

const LOADING_PHRASES = [
  "Analizando tu perfil financiero...",
  "Evaluando tu tolerancia al riesgo...",
  "Consultando las mejores estrategias de inversión...",
  "Validando compatibilidad con instrumentos financieros...",
  "Calculando la distribución óptima de activos...",
  "Preparando tu propuesta personalizada...",
  "Verificando normativas de cumplimiento...",
  "Generando recomendaciones adaptadas a tu meta..."
];

function renderDynamicLoaderState() {
  setState("loading");
  currentLoadingPhrase = 0;

  getPanel().innerHTML = `
    <div class="view loader-wrap">
      <div class="orb-loader" aria-hidden="true"></div>
      <div>
        <h2 class="text-3xl font-black tracking-normal text-slate-950">Agentes IA trabajando</h2>
        <p id="loading-message" class="mt-3 max-w-md text-lg leading-8 text-slate-500 transition-opacity duration-500">
          ${LOADING_PHRASES[0]}
        </p>
        <p class="mt-2 text-sm text-slate-400">Esto puede tomar entre 15-30 segundos</p>
      </div>
    </div>
  `;

  // Iniciar rotación de frases cada 3.5 segundos
  loaderInterval = setInterval(() => {
    currentLoadingPhrase = (currentLoadingPhrase + 1) % LOADING_PHRASES.length;
    
    const messageElement = document.getElementById("loading-message");
    if (messageElement) {
      // Fade out
      messageElement.style.opacity = "0";
      
      // Cambiar texto después de la animación
      setTimeout(() => {
        messageElement.textContent = LOADING_PHRASES[currentLoadingPhrase];
        // Fade in
        messageElement.style.opacity = "1";
      }, 300);
    }
  }, 3500);
}

function stopDynamicLoader() {
  if (loaderInterval) {
    clearInterval(loaderInterval);
    loaderInterval = null;
  }
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

      <div class="mt-5">
        <h2 class="text-4xl font-black leading-tight tracking-normal text-slate-950">
          Perfil: <span style="color:#2563eb">${data.perfil}</span>
        </h2>
        <p class="mt-2 text-base text-slate-500">${data.explicacion_perfil || ""}</p>
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
            Enviar propuesta a revisión →
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

// ─── PASO 5: Enviar propuesta a cola de asesores ──
async function handleSendToAdvisor() {
  const button = document.getElementById("send-advisor-button");
  if (!button) return;

  // Deshabilitar botón y mostrar estado de carga
  button.disabled = true;
  button.textContent = "Enviando...";
  button.style.cursor = "wait";

  try {
    // CORRECCIÓN: Usar nombre de usuario correcto
    const usuario = appState.userName || sessionStorage.getItem("userName") || "cliente_demo";
    
    const response = await fetch("/api/enviar_propuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_propuesta: appState.proposalId,
        usuario: usuario  // Vincular al usuario
      }),
    });

    const data = await response.json();

    if (response.status === 429) {
      // Cola llena (límite de 5 alcanzado)
      renderColaLlenaState(data.error);
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || "Error al enviar la propuesta");
    }

    console.log(`✅ Propuesta ${appState.proposalId} enviada por ${usuario}`);

    // Éxito: Propuesta enviada a la cola
    renderExitoEnvioState(data);

    // NUEVO: Iniciar polling en tiempo real
    startPolling(appState.proposalId);

    // NUEVO: Actualizar dashboard
    cargarDashboard();

  } catch (error) {
    // Error de red u otro error
    console.error("Error al enviar propuesta:", error);
    button.disabled = false;
    button.textContent = "Enviar propuesta a revisión →";
    button.style.cursor = "pointer";
    
    showErrorMessage(`Error: ${error.message}`);
  }
}

// ─── POLLING EN TIEMPO REAL ──────────────────────────────────────────────────
function startPolling(propuestaId) {
  // Detener cualquier polling anterior
  stopPolling();

  console.log(`🔄 Iniciando polling para propuesta ${propuestaId}...`);

  // Polling cada 5 segundos
  appState.pollingInterval = setInterval(async () => {
    try {
      // CORRECCIÓN: Usar nombre de usuario correcto
      const usuario = appState.userName || sessionStorage.getItem("userName") || "cliente_demo";
      const response = await fetch(`/api/mis_propuestas?usuario=${usuario}`);
      
      if (!response.ok) {
        console.error("Error en response:", response.status);
        return;
      }

      const data = await response.json();
      console.log(`📊 Polling: ${data.propuestas.length} propuestas encontradas`);
      
      const propuesta = data.propuestas.find(p => p.id === propuestaId);

      if (propuesta) {
        console.log(`📝 Estado actual de ${propuestaId}: ${propuesta.estado_revision}`);
        
        if (propuesta.estado_revision !== "Pendiente" && propuesta.estado_revision !== "Generada") {
          // ¡Estado cambió! Detener polling y actualizar UI
          console.log(`✅ Estado cambió a: ${propuesta.estado_revision}`);
          stopPolling();
          
          // Actualizar panel derecho con estado actualizado
          renderEstadoActualizado(propuesta);
          
          // Actualizar dashboard en panel izquierdo
          cargarDashboard();
        }
      } else {
        console.warn(`⚠️  Propuesta ${propuestaId} no encontrada en respuesta`);
      }
    } catch (error) {
      console.error("Error en polling:", error);
    }
  }, 5000);
}

function stopPolling() {
  if (appState.pollingInterval) {
    clearInterval(appState.pollingInterval);
    appState.pollingInterval = null;
    console.log("⏹️  Polling detenido");
  }
}

function renderEstadoActualizado(propuesta) {
  setState("estado-actualizado");

  const esAprobada = propuesta.estado_revision === "Aprobada";
  const icon = esAprobada ? "✅" : "❌";
  const color = esAprobada ? "emerald" : "red";
  const titulo = esAprobada ? "¡Propuesta Aprobada!" : "Propuesta Rechazada";
  const mensaje = esAprobada 
    ? "Tu propuesta ha sido revisada y aprobada por nuestro equipo de asesores." 
    : "Tu propuesta ha sido revisada. Puedes crear una nueva consulta ajustando tus preferencias.";

  getPanel().innerHTML = `
    <div class="view">
      <div class="flex items-center justify-center mb-6 animate-bounce">
        <div class="w-24 h-24 rounded-full bg-${color}-100 flex items-center justify-center shadow-lg">
          <span class="text-5xl">${icon}</span>
        </div>
      </div>

      <h2 class="text-center text-4xl font-black leading-tight tracking-normal text-slate-950 mb-3">
        ${titulo}
      </h2>

      <div class="glass-card mt-8 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <p class="text-lg text-slate-700 text-center leading-relaxed mb-4">
          ${mensaje}
        </p>
        
        <div class="justification-box mt-6" style="background:#${color === "emerald" ? "f0fdf4" : "fef2f2"};">
          <p class="text-sm font-bold" style="color:#${color === "emerald" ? "16a34a" : "dc2626"};">
            📋 Propuesta ID: <span class="font-mono">${propuesta.id}</span>
          </p>
          <p class="text-sm mt-2 text-slate-600">
            Estado: <strong>${propuesta.estado_revision}</strong>
          </p>
          ${propuesta.asesor ? `<p class="text-sm text-slate-600">Asesor: <strong>${propuesta.asesor}</strong></p>` : ""}
        </div>

        ${propuesta.observaciones && propuesta.observaciones !== "Sin observaciones" && !propuesta.observaciones.includes("panel standalone")
          ? `<div class="justification-box mt-4" style="background:#eff6ff;">
              <p class="text-sm font-bold text-blue-700">💬 Observaciones del asesor:</p>
              <p class="text-sm mt-2 text-slate-700">${propuesta.observaciones}</p>
            </div>`
          : ""
        }

        <div class="mt-6 text-center text-sm text-slate-500">
          <p>Puedes consultar el historial completo en el panel izquierdo.</p>
        </div>

        <div class="mt-8 flex justify-center gap-3">
          <button class="primary-button" type="button" id="nueva-consulta-button">
            Crear nueva consulta
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("nueva-consulta-button")?.addEventListener("click", renderIcebreakerState);
}

function renderExitoEnvioState(data) {
  setState("enviado");

  getPanel().innerHTML = `
    <div class="view">
      <div class="flex items-center justify-center mb-6">
        <div class="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <span class="text-4xl">✅</span>
        </div>
      </div>

      <h2 class="text-center text-4xl font-black leading-tight tracking-normal text-slate-950">
        ¡Propuesta enviada!
      </h2>

      <div class="glass-card mt-8 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <p class="text-lg text-slate-700 text-center leading-relaxed">
          Tu propuesta está ahora en revisión por nuestro equipo de asesores financieros.
        </p>
        
        <div class="justification-box mt-6" style="background:#f0fdf4;">
          <p class="text-sm font-bold" style="color:#16a34a;">
            📋 Propuesta ID: <span class="font-mono">${appState.proposalId}</span>
          </p>
          <p class="text-sm mt-2 text-slate-600">
            Posición en cola: <strong>${data.posicion_en_cola}</strong> de ${data.total_en_cola}
          </p>
        </div>

        <div class="justification-box mt-4" style="background:#eff6ff;">
          <p class="text-sm font-bold text-blue-700">
            🔄 Sincronización en tiempo real activada
          </p>
          <p class="text-sm mt-2 text-slate-600">
            Te notificaremos automáticamente cuando un asesor revise tu propuesta. 
            <strong>No necesitas recargar la página.</strong>
          </p>
        </div>

        <div class="mt-6 text-center text-sm text-slate-500">
          <p>Tiempo estimado de revisión: <strong>2-4 horas hábiles</strong></p>
          <p class="mt-2">Puedes consultar el estado en el panel izquierdo.</p>
        </div>

        <div class="mt-8 flex justify-center">
          <button class="secondary-button" type="button" id="nueva-consulta-button">
            ← Crear otra consulta
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("nueva-consulta-button")?.addEventListener("click", renderIcebreakerState);
}

function renderColaLlenaState(mensajeError) {
  setState("cola-llena");

  getPanel().innerHTML = `
    <div class="view">
      <div class="flex items-center justify-center mb-6">
        <div class="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
          <span class="text-4xl">⚠️</span>
        </div>
      </div>

      <h2 class="text-center text-3xl font-black leading-tight tracking-normal text-slate-950">
        Asesores ocupados
      </h2>

      <div class="glass-card mt-8 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <div class="justification-box" style="background:#fff7ed;">
          <p class="text-sm font-black uppercase tracking-normal" style="color:#ea580c;">
            ⚠️ Cola de revisión llena
          </p>
          <p class="mt-3 text-base text-slate-700 leading-relaxed">
            ${mensajeError}
          </p>
        </div>

        <div class="mt-6 text-center text-sm text-slate-600">
          <p>Nuestros asesores están revisando el máximo de propuestas permitidas (5 simultáneas).</p>
          <p class="mt-3 font-semibold">Por favor, intenta enviar tu propuesta en unos minutos.</p>
        </div>

        <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button class="primary-button" type="button" id="reintentar-envio-button">
            🔄 Reintentar envío
          </button>
          <button class="secondary-button" type="button" id="volver-propuesta-button">
            ← Ver mi propuesta
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("reintentar-envio-button")?.addEventListener("click", handleSendToAdvisor);
  document.getElementById("volver-propuesta-button")?.addEventListener("click", () => {
    // Volver a renderizar el portafolio con los datos guardados
    if (appState.proposalId) {
      // Aquí podrías hacer un fetch para obtener los datos actualizados
      // Por simplicidad, recargamos la página o mostramos mensaje
      renderIcebreakerState();
    }
  });
}

function showErrorMessage(message) {
  const panel = getPanel();
  const errorDiv = document.createElement("div");
  errorDiv.className = "justification-box mt-4";
  errorDiv.style.cssText = "background:#fff1f2; border-left: 4px solid #e11d48;";
  errorDiv.innerHTML = `
    <p class="text-sm font-bold" style="color:#e11d48;">
      ⚠️ ${message}
    </p>
  `;
  panel.appendChild(errorDiv);

  setTimeout(() => errorDiv.remove(), 5000);
}
