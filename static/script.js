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
    dimension: "Horizonte Temporal",
    dimensionIcon: "🕐",
    dimensionDescription: "Define cuánto tiempo puedes mantener tu inversión",
    options: [
      { id: "empezando", text: "Estudiante / Empezando carrera", type: "Conservative" },
      { id: "consolidacion", text: "Consolidación profesional", type: "Dynamic" },
      { id: "retiro", text: "Preparando el retiro / Jubilado", type: "Conservative" }
    ]
  },
  {
    id: "objetivo",
    title: "¿Cuál es el objetivo principal de esta inversión?",
    dimension: "Objetivo de Inversión",
    dimensionIcon: "🎯",
    dimensionDescription: "Determina qué tipo de rendimiento buscas",
    options: [
      { id: "proteger", text: "Proteger mi dinero contra la inflación", type: "Conservative" },
      { id: "ingresos", text: "Generar ingresos periódicos", type: "Balanced" },
      { id: "crecimiento", text: "Crecimiento a largo plazo o agresivo", type: "Dynamic" }
    ]
  },
  {
    id: "retiro_fondos",
    title: "¿Cuándo estimas que necesitarás retirar una parte significativa de este dinero?",
    dimension: "Horizonte Temporal",
    dimensionIcon: "🕐",
    dimensionDescription: "Indica cuándo necesitarás acceder a tu dinero",
    options: [
      { id: "corto", text: "En menos de 2 años", type: "Conservative" },
      { id: "medio", text: "Entre 3 y 5 años", type: "Balanced" },
      { id: "largo", text: "En más de 5 años", type: "Dynamic" }
    ]
  },
  {
    id: "conocimiento",
    title: "¿Cómo calificarías tu nivel de conocimiento financiero?",
    dimension: "Experiencia Financiera",
    dimensionIcon: "📚",
    dimensionDescription: "Evalúa tu familiaridad con productos de inversión",
    options: [
      { id: "novato", text: "Novato (no he invertido antes)", type: "Conservative" },
      { id: "intermedio", text: "Intermedio (conozco acciones y bonos)", type: "Balanced" },
      { id: "avanzado", text: "Avanzado (invierto activamente)", type: "Dynamic" }
    ]
  },
  {
    id: "experiencia_productos",
    title: "¿En cuáles de los siguientes productos has invertido anteriormente?",
    dimension: "Experiencia Financiera",
    dimensionIcon: "📚",
    dimensionDescription: "Mide tu historial con distintos tipos de activos",
    options: [
      { id: "ahorro", text: "Solo cuentas de ahorro o plazo fijo", type: "Conservative" },
      { id: "fondos", text: "Fondos mutuos o ETFs", type: "Balanced" },
      { id: "acciones", text: "Acciones individuales o criptomonedas", type: "Dynamic" }
    ]
  },
  {
    id: "reaccion_caida",
    title: "¿Cómo reaccionarías si tu portafolio baja un 20% en un solo mes?",
    dimension: "Tolerancia al Riesgo",
    dimensionIcon: "📊",
    dimensionDescription: "Mide tu reacción emocional ante pérdidas del mercado",
    options: [
      { id: "vender", text: "Vendería todo para evitar más pérdidas", type: "Conservative" },
      { id: "esperar", text: "No haría nada, esperaría a que se recupere", type: "Balanced" },
      { id: "comprar", text: "Compraría más, es una oportunidad", type: "Dynamic" }
    ]
  },
  {
    id: "preferencia_riesgo",
    title: "Si tuvieras que elegir entre estas opciones, ¿cuál prefieres?",
    dimension: "Tolerancia al Riesgo",
    dimensionIcon: "📊",
    dimensionDescription: "Evalúa tu preferencia entre seguridad y rentabilidad",
    options: [
      { id: "bajo", text: "Ganancias bajas pero sin riesgo de pérdida", type: "Conservative" },
      { id: "medio", text: "Ganancias moderadas con algo de fluctuación", type: "Balanced" },
      { id: "alto", text: "Ganancias altas asumiendo riesgo de perder capital", type: "Dynamic" }
    ]
  },
  {
    id: "estabilidad_ingresos",
    title: "¿Cómo describirías la estabilidad de tus ingresos actuales?",
    dimension: "Capacidad Financiera",
    dimensionIcon: "💰",
    dimensionDescription: "Evalúa si tus ingresos permiten asumir riesgos",
    options: [
      { id: "variable", text: "Variables / Inestables", type: "Conservative" },
      { id: "estable", text: "Estables pero ajustados", type: "Balanced" },
      { id: "muy_estable", text: "Muy estables y superan mis gastos", type: "Dynamic" }
    ]
  },
  {
    id: "porcentaje_ahorros",
    title: "¿Qué porcentaje de tus ahorros totales representa esta inversión?",
    dimension: "Capacidad Financiera",
    dimensionIcon: "💰",
    dimensionDescription: "Indica cuánto de tu patrimonio estás arriesgando",
    options: [
      { id: "alto", text: "Más del 50%", type: "Conservative" },
      { id: "medio", text: "Entre 20% y 50%", type: "Balanced" },
      { id: "bajo", text: "Menos del 20%", type: "Dynamic" }
    ]
  },
  {
    id: "emergencia",
    title: "Si tuvieras una emergencia médica o pérdida de empleo, ¿necesitarías tocar este dinero?",
    dimension: "Capacidad Financiera",
    dimensionIcon: "💰",
    dimensionDescription: "Determina si tienes colchón financiero de respaldo",
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
  appState.viendoHistorial = false;
  
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
      <button type="button" onclick="revisarPropuesta('${prop.id}')" class="w-full text-left rounded-xl bg-white border-2 ${estadoConfig.borderClass} p-4 shadow-sm transition-all hover:shadow-md">
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
      </button>
    `;
  }).join("");
}

async function revisarPropuesta(idPropuesta) {
  try {
    const response = await fetch(`/api/mi_propuesta/${idPropuesta}`);
    if (!response.ok) {
      throw new Error("No se pudo cargar la propuesta");
    }
    const data = await response.json();
    appState.proposalId = data.id;
    appState.viendoHistorial = true;
    renderPortfolioState(data);
  } catch (error) {
    alert("Error al cargar la propuesta: " + error.message);
  }
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
  appState.viendoHistorial = false;

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

async function handleGoalSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("goal-input");
  const submitBtn = event.target.querySelector("button[type='submit']");
  appState.goalText = input.value.trim();

  if (!appState.goalText) {
    input.focus();
    input.placeholder = "Escribe tu meta para que la IA pueda ayudarte...";
    return;
  }
  
  // Deshabilitar UI durante la validación rápida
  input.disabled = true;
  submitBtn.disabled = true;
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = "Validando... <span class='orb-loader inline-block ml-2 !w-4 !h-4'></span>";

  try {
    const response = await fetch("/api/validar_meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalText: appState.goalText }),
    });
    
    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error("Respuesta inválida del servidor");
    }
    
    // Restaurar UI
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
    
    if (data.error && data.error_type === "meta_invalida") {
      renderMetaInvalidaState(data.mensaje, data.sugerencia);
      return;
    }
    
    if (!response.ok) {
      throw new Error(data.error || "Error al validar la meta");
    }
    
    // Guardar variables extraídas si es válida
    appState.variables_meta = data.variables_extraidas || {};
    
    // Iniciar flujo de preguntas
    renderQuestionState();
    
  } catch (error) {
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
    alert("Error validando meta: " + error.message);
  }
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

      <div class="mt-3 inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-4 py-2">
        <span class="text-lg">${q.dimensionIcon}</span>
        <span class="text-sm font-bold text-blue-700">Afecta: ${q.dimension}</span>
        <span class="text-xs text-blue-500">— ${q.dimensionDescription}</span>
      </div>

      <div class="choice-grid mt-8">
        ${q.options.map(opt => {
          const sesgoColor = opt.type === "Conservative" ? "emerald" : opt.type === "Dynamic" ? "amber" : "blue";
          const sesgoLabel = opt.type === "Conservative" ? "⛔ Conservador" : opt.type === "Dynamic" ? "🚀 Dinámico" : "⚖️ Moderado";
          return `
          <button class="choice-button" type="button" data-option-id="${opt.id}">
            <span class="block text-base">${opt.text}</span>
            <span class="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">
              ${sesgoLabel}
            </span>
          </button>
        `;
        }).join("")}
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
  // Also store the type for scoring
  const q = PROFILING_QUESTIONS[appState.currentQuestionIndex];
  const opt = q.options.find(o => o.id === optionId);
  appState.answers[questionId + "_type"] = opt ? opt.type : "Balanced";
  appState.currentQuestionIndex++;

  if (appState.currentQuestionIndex < PROFILING_QUESTIONS.length) {
    renderQuestionState();
  } else {
    renderProfileConfirmation();
  }
}

// ─── PASO 2.5: Confirmación del perfil preliminar con sliders ────────────────
function calcularScorePreliminar() {
  let horizonte = 0, tolerancia = 0, capacidad = 0;
  const qMap = {
    "etapa_vida": "horizonte", "objetivo": "horizonte", "retiro_fondos": "horizonte",
    "conocimiento": "tolerancia", "experiencia_productos": "tolerancia",
    "reaccion_caida": "tolerancia", "preferencia_riesgo": "tolerancia",
    "estabilidad_ingresos": "capacidad", "porcentaje_ahorros": "capacidad", "emergencia": "capacidad"
  };
  
  for (const [qId, dim] of Object.entries(qMap)) {
    const tipo = appState.answers[qId + "_type"] || "Balanced";
    const pts = tipo === "Conservative" ? -10 : tipo === "Dynamic" ? 10 : 0;
    if (dim === "horizonte") horizonte += pts;
    else if (dim === "tolerancia") tolerancia += pts;
    else capacidad += pts;
  }
  
  return { horizonte, tolerancia, capacidad };
}

function getPerfilLabel(totalScore) {
  if (totalScore <= -20) return { label: "Conservador", color: "#16a34a", emoji: "🛡️" };
  if (totalScore > 20) return { label: "Agresivo", color: "#dc2626", emoji: "🚀" };
  return { label: "Moderado", color: "#2563eb", emoji: "⚖️" };
}

function renderProfileConfirmation() {
  setState("profile-confirm");
  const scores = calcularScorePreliminar();
  
  // Normalize scores to 0-100 range for sliders (raw range is -30 to +30 per dimension)
  const toSlider = (val, maxAbs) => Math.round(((val + maxAbs) / (2 * maxAbs)) * 100);
  
  const hVal = toSlider(scores.horizonte, 30);
  const tVal = toSlider(scores.tolerancia, 40);
  const cVal = toSlider(scores.capacidad, 30);
  
  const totalScore = scores.horizonte + scores.tolerancia + scores.capacidad;
  const perfil = getPerfilLabel(totalScore);

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow">
        <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
        Confirmación del Perfil Preliminar
      </span>

      <h2 class="mt-6 text-3xl font-black leading-tight tracking-normal text-slate-950 md:text-4xl">
        Tu perfil preliminar: <span id="perfil-label" style="color:${perfil.color}">${perfil.emoji} ${perfil.label}</span>
      </h2>
      <p class="mt-2 text-base text-slate-500">
        Basado en tus respuestas, hemos calculado este perfil. Puedes ajustar los parámetros con los sliders antes de confirmar.
      </p>

      <div class="glass-card mt-6 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <div class="space-y-6">
          <!-- Slider 1: Horizonte -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-bold text-slate-700">🕐 Horizonte Temporal</label>
              <span id="horizonte-val" class="text-sm font-black text-blue-600">${hVal}%</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-400 w-14">Corto</span>
              <input type="range" id="slider-horizonte" min="0" max="100" value="${hVal}" 
                class="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600">
              <span class="text-xs text-slate-400 w-14 text-right">Largo</span>
            </div>
          </div>

          <!-- Slider 2: Tolerancia -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-bold text-slate-700">📊 Tolerancia al Riesgo</label>
              <span id="tolerancia-val" class="text-sm font-black text-blue-600">${tVal}%</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-400 w-14">Bajo</span>
              <input type="range" id="slider-tolerancia" min="0" max="100" value="${tVal}" 
                class="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600">
              <span class="text-xs text-slate-400 w-14 text-right">Alto</span>
            </div>
          </div>

          <!-- Slider 3: Capacidad -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm font-bold text-slate-700">💰 Capacidad Financiera</label>
              <span id="capacidad-val" class="text-sm font-black text-blue-600">${cVal}%</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-400 w-14">Baja</span>
              <input type="range" id="slider-capacidad" min="0" max="100" value="${cVal}" 
                class="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600">
              <span class="text-xs text-slate-400 w-14 text-right">Alta</span>
            </div>
          </div>
        </div>

        <!-- Score visual -->
        <div id="score-display" class="mt-6 rounded-2xl bg-slate-50 p-4 text-center">
          <p class="text-xs font-bold uppercase text-slate-400 tracking-wider">Score Total</p>
          <p id="score-number" class="text-4xl font-black" style="color:${perfil.color}">${totalScore}</p>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <button class="primary-button" type="button" id="confirm-profile-button">
          Confirmar perfil y generar propuesta →
        </button>
        <button class="secondary-button" type="button" id="back-to-questions-button">
          ← Volver a las preguntas
        </button>
      </div>
    </div>
  `;

  // Setup slider event listeners
  const sliders = ["horizonte", "tolerancia", "capacidad"];
  sliders.forEach(name => {
    const slider = document.getElementById(`slider-${name}`);
    slider.addEventListener("input", () => {
      document.getElementById(`${name}-val`).textContent = `${slider.value}%`;
      updatePerfilFromSliders();
    });
  });

  document.getElementById("confirm-profile-button").addEventListener("click", () => {
    // Store slider adjustments
    appState.sliderAdjustments = {
      horizonte: parseInt(document.getElementById("slider-horizonte").value),
      tolerancia: parseInt(document.getElementById("slider-tolerancia").value),
      capacidad: parseInt(document.getElementById("slider-capacidad").value),
    };
    submitProfiling();
  });
  
  document.getElementById("back-to-questions-button").addEventListener("click", () => {
    appState.currentQuestionIndex = PROFILING_QUESTIONS.length - 1;
    renderQuestionState();
  });
}

function updatePerfilFromSliders() {
  const h = parseInt(document.getElementById("slider-horizonte").value);
  const t = parseInt(document.getElementById("slider-tolerancia").value);
  const c = parseInt(document.getElementById("slider-capacidad").value);
  
  // Convert back from 0-100 to raw score
  const hScore = Math.round(((h / 100) * 60) - 30);
  const tScore = Math.round(((t / 100) * 80) - 40);
  const cScore = Math.round(((c / 100) * 60) - 30);
  const total = hScore + tScore + cScore;
  
  const perfil = getPerfilLabel(total);
  document.getElementById("perfil-label").innerHTML = `${perfil.emoji} ${perfil.label}`;
  document.getElementById("perfil-label").style.color = perfil.color;
  document.getElementById("score-number").textContent = total;
  document.getElementById("score-number").style.color = perfil.color;
}

// ─── PASO 3: El usuario confirmó → llamar a los 3 agentes ──────────────────────
async function submitProfiling() {
  // Iniciar loader con mensajes dinámicos
  renderDynamicLoaderState();

  try {
    const payload = {
      goalText: appState.goalText,
      answers: appState.answers,
    };
    
    // Add slider adjustments if they exist
    if (appState.sliderAdjustments) {
      payload.sliderAdjustments = appState.sliderAdjustments;
    }
    
    // Add variables extracted during initial goal validation
    if (appState.variables_meta) {
      payload.variables_meta = appState.variables_meta;
    }

    const response = await fetch("/api/analizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Detener el loader dinámico
    stopDynamicLoader();

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error("Respuesta inválida del servidor");
    }
    
    if (!response.ok) {
      throw new Error(data.detalle || data.error || "Error del servidor");
    }

    
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

// ─── PASO 3c: Error de Meta Inválida (CAMBIO 1) ─────────────────────────────────
function renderMetaInvalidaState(mensaje, sugerencia) {
  setState("meta-invalida");

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow" style="background:#fff7ed;color:#ea580c;">
        🚫 Meta no válida
      </span>
      <h2 class="mt-6 text-3xl font-black text-slate-950">No podemos procesar esta meta</h2>
      
      <div class="glass-card mt-6 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <div class="justification-box" style="background:#fff7ed;">
          <p class="text-sm font-black uppercase tracking-normal" style="color:#ea580c;">⚠ Razón del rechazo</p>
          <p class="mt-2 text-base text-slate-700">${mensaje}</p>
        </div>

        <div class="justification-box mt-4" style="background:#eff6ff;">
          <p class="text-sm font-bold text-blue-700">💡 Sugerencia</p>
          <p class="mt-2 text-sm text-slate-600">${sugerencia}</p>
        </div>

        <div class="mt-4 justification-box" style="background:#f0fdf4;">
          <p class="text-sm font-bold" style="color:#16a34a;">✅ Ejemplos de metas válidas:</p>
          <ul class="mt-2 text-sm text-slate-600 list-disc list-inside space-y-1">
            <li>Quiero ahorrar $50,000 para comprar una casa en 5 años</li>
            <li>Planear mi retiro para dentro de 20 años con ingresos pasivos</li>
            <li>Generar un fondo de emergencia de $10,000 en 2 años</li>
            <li>Invertir $1,000 mensuales para educación universitaria de mis hijos</li>
          </ul>
        </div>
      </div>

      <button class="primary-button mt-6" type="button" id="retry-button">
        ← Volver a intentar
      </button>
    </div>
  `;

  document.getElementById("retry-button").addEventListener("click", renderIcebreakerState);
}

// ─── PASO 3d: Error genérico ───────────────────────────────────────────────────────────
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

        <!-- CAMBIO 2: Gráfica de Proyección a 5 Años -->
        <div class="mt-8">
          <h3 class="text-lg font-black text-slate-950 mb-4">📈 Proyección de Inversión a 5 Años</h3>
          <div class="chart-shell" style="min-height: 280px;">
            <canvas id="projection-chart" aria-label="Proyección de crecimiento a 5 años" role="img"></canvas>
          </div>
          <p class="mt-3 text-xs text-slate-500 text-center">
            *Basado en $10,000 invertidos al inicio con rendimiento estimado del portafolio. 
            Los resultados reales pueden variar según condiciones del mercado.
          </p>
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
          <!-- CAMBIO 3: Botón de Exportación PDF -->
          <button class="secondary-button" type="button" id="download-pdf-button" style="background:#f0f9ff; color:#0369a1; box-shadow: 0 18px 35px rgba(3, 105, 161, 0.16);">
            📄 Descargar Propuesta Oficial
          </button>
          
          ${appState.viendoHistorial ? `
            <button class="primary-button" type="button" id="back-dashboard-button">
              ← Volver a Mis Propuestas
            </button>
          ` : `
            <button class="primary-button" type="button" id="send-advisor-button">
              Enviar propuesta a revisión →
            </button>
            <button class="secondary-button" type="button" id="restart-button">
              Crear otra meta
            </button>
          `}
        </div>
      </div>
    </div>
  `;

  renderPortfolioChart(data.asignacion || []);
  
  // CAMBIO 2: Renderizar gráfica de proyección a 5 años
  renderProjectionChart(data);
  
  // CAMBIO 3: Event listener para exportar PDF
  document.getElementById("download-pdf-button").addEventListener("click", exportToPDF);
  
  if (appState.viendoHistorial) {
    document.getElementById("back-dashboard-button").addEventListener("click", () => {
      appState.viendoHistorial = false;
      renderIcebreakerState();
    });
  } else {
    document.getElementById("restart-button").addEventListener("click", renderIcebreakerState);
    document
      .getElementById("send-advisor-button")
      .addEventListener("click", handleSendToAdvisor);
  }
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

// ─── CAMBIO 2: Renderizar gráfica de proyección a 5 años ─────────────────────────
function renderProjectionChart(data) {
  const canvas = document.getElementById("projection-chart");
  if (!canvas) return;

  // Extraer rendimiento anualizado del portafolio (si existe en la respuesta)
  // Si no, asumir 5% por defecto
  const rendimientoAnual = data.rendimiento_1y_pct || 5;
  
  // Inversión inicial de $10,000
  const inversionInicial = 10000;
  
  // Calcular proyecciones a 5 años usando interés compuesto
  const años = [0, 1, 2, 3, 4, 5];
  const valoresConRendimiento = años.map(año => 
    inversionInicial * Math.pow(1 + (rendimientoAnual / 100), año)
  );
  const valoresSinRendimiento = años.map(() => inversionInicial); // Siempre $10,000

  new Chart(canvas, {
    type: "line",
    data: {
      labels: años.map(a => `Año ${a}`),
      datasets: [
        {
          label: `Invertido (${rendimientoAnual.toFixed(1)}% anual)`,
          data: valoresConRendimiento,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderWidth: 3,
          tension: 0.3,
          fill: true,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
        {
          label: "Sin invertir (0%)",
          data: valoresSinRendimiento,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.05)",
          borderWidth: 3,
          borderDash: [8, 4],
          tension: 0,
          fill: false,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1200,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            usePointStyle: true,
            padding: 15,
            font: {
              size: 12,
              weight: "bold",
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = ctx.parsed.y;
              return `${ctx.dataset.label}: $${value.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: (value) => `$${(value / 1000).toFixed(0)}k`,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.1)",
          },
        },
        x: {
          grid: {
            display: false,
          },
        },
      },
    },
  });
}

// ─── CAMBIO 3: Exportar a PDF usando window.print() ──────────────────────────
function exportToPDF() {
  // Agregar clase temporal al body para activar estilos @media print
  document.body.classList.add("printing");
  
  // Trigger print dialog
  window.print();
  
  // Remover clase después de imprimir
  setTimeout(() => {
    document.body.classList.remove("printing");
  }, 500);
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
  const fueEditada = propuesta.fue_editada;
  
  const icon = esAprobada ? (fueEditada ? "✏️" : "✅") : "❌";
  const color = esAprobada ? (fueEditada ? "amber" : "emerald") : "red";
  const titulo = esAprobada 
    ? (fueEditada ? "Propuesta Modificada por Asesor" : "¡Propuesta Aprobada!") 
    : "Propuesta Rechazada";
    
  const mensaje = esAprobada 
    ? (fueEditada 
        ? "El asesor hizo unos cambios en tu propuesta para optimizarla. Verifica los detalles." 
        : "Tu propuesta ha sido revisada y aprobada por nuestro equipo de asesores.")
    : "Tu propuesta ha sido revisada. Puedes crear una nueva consulta ajustando tus preferencias.";

  let contentHTML = `
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
  `;

  if (esAprobada && fueEditada && propuesta.asignacion_original && propuesta.asignacion) {
    // Generar tabla comparativa
    let comparativoRows = "";
    
    // Crear mapa de activos originales para comparar
    const activosOriginales = {};
    propuesta.asignacion_original.forEach(a => {
      activosOriginales[a.nombre] = a.porcentaje;
    });
    
    // Iterar sobre asignacion final para ver qué quedó y qué cambió
    propuesta.asignacion.forEach(a => {
      const origPct = activosOriginales[a.nombre] || 0;
      const actPct = a.porcentaje;
      const diff = actPct - origPct;
      
      let badge = "";
      if (diff > 0) badge = `<span class="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">↑ +${diff}%</span>`;
      else if (diff < 0) badge = `<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">↓ ${diff}%</span>`;
      else badge = `<span class="text-xs font-bold text-slate-400">= Igual</span>`;
      
      comparativoRows += `
        <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
          <span class="text-sm font-semibold text-slate-700">${a.nombre}</span>
          <div class="flex items-center gap-3">
            <span class="text-sm text-slate-400 line-through">${origPct}%</span>
            <span class="text-sm font-black text-slate-900">${actPct}%</span>
            ${badge}
          </div>
        </div>
      `;
      
      // Eliminar del mapa original para encontrar eliminados
      delete activosOriginales[a.nombre];
    });
    
    // Activos que fueron eliminados totalmente por el asesor
    for (const [nombre, pct] of Object.entries(activosOriginales)) {
      comparativoRows += `
        <div class="flex justify-between items-center py-2 border-b border-slate-100 last:border-0 opacity-60">
          <span class="text-sm font-semibold text-slate-700 line-through">${nombre}</span>
          <div class="flex items-center gap-3">
            <span class="text-sm text-slate-400 line-through">${pct}%</span>
            <span class="text-sm font-black text-slate-900">0%</span>
            <span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">Eliminado</span>
          </div>
        </div>
      `;
    }

    contentHTML += `
        <div class="justification-box mt-6 mb-6" style="background:#fffbeb; border: 1px solid #fde68a;">
          <details class="cursor-pointer">
            <summary class="text-sm font-black uppercase tracking-normal" style="color:#d97706; list-style: none;">
              <span class="flex items-center justify-between">
                <span>🔍 Ver cambios realizados por el Asesor</span>
                <span class="text-lg">▾</span>
              </span>
            </summary>
            <div class="mt-4 pt-3 border-t border-amber-200 space-y-1">
              ${comparativoRows}
            </div>
          </details>
        </div>
    `;
  }
  
  contentHTML += `
        <div class="justification-box mt-6" style="background:#${color === "emerald" || color === "amber" ? "f0fdf4" : "fef2f2"};">
          <p class="text-sm font-bold" style="color:#${color === "emerald" || color === "amber" ? "16a34a" : "dc2626"};">
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
          ${esAprobada && fueEditada 
            ? `<button class="primary-button" type="button" id="aceptar-cambios-button" style="background-color: #d97706;">
                 ✅ Aceptar propuesta modificada
               </button>` 
            : ``}
          <button class="${esAprobada && fueEditada ? 'secondary-button' : 'primary-button'}" type="button" id="nueva-consulta-button">
            ${esAprobada && fueEditada ? 'Crear otra consulta' : 'Crear nueva consulta'}
          </button>
        </div>
      </div>
    </div>
  `;

  getPanel().innerHTML = contentHTML;

  document.getElementById("nueva-consulta-button")?.addEventListener("click", renderIcebreakerState);
  document.getElementById("aceptar-cambios-button")?.addEventListener("click", () => {
    showErrorMessage("¡Propuesta aceptada exitosamente! Empezaremos a gestionar tu portafolio.");
    setTimeout(renderIcebreakerState, 3000);
  });
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
