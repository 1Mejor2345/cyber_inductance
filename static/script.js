const appState = {
  currentStep: "icebreaker",
  goalText: "",
  selectedAnswer: null,
  chart: null,
};

const mockQuestion = {
  
  title: "Para afinar la propuesta, necesito entender tu tolerancia al movimiento del mercado.",
  subtitle: "Si el portafolio baja temporalmente, que opcion se parece mas a ti?",
  options: [
    {
      id: "conservative",
      label: "Prefiero estabilidad, aunque el crecimiento sea menor",
      riskProfile: "Conservador",
    },
    {
      id: "balanced",
      label: "Acepto variaciones moderadas si la meta sigue clara",
      riskProfile: "Balanceado",
    },
    {
      id: "dynamic",
      label: "Puedo tolerar mas movimiento por mayor potencial",
      riskProfile: "Dinamico",
    },
  ],
};

const mockPortfolio = {
  label: "Proyección Histórica del Portafolio",
  aiJustification:
    "La IA sugiere una composicion balanceada porque tu objetivo combina horizonte corto con necesidad de liquidez. La distribucion prioriza instrumentos defensivos, mantiene exposicion controlada a crecimiento y reserva una porcion flexible para ajustes del asesor.",
  assets: [
    { name: "Bonos grado inversion", value: 40, color: "#2563eb" },
    { name: "ETF renta variable global", value: 30, color: "#10b981" },
    { name: "Fondos monetarios", value: 20, color: "#38bdf8" },
    { name: "Alternativos liquidos", value: 10, color: "#a7f3d0" },
  ],
};

document.addEventListener("DOMContentLoaded", () => {
  renderIcebreakerState();
});

function setState(nextState) {
  appState.currentStep = nextState;
}

function getPanel() {
  return document.getElementById("dynamic-panel");
}

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
        Cuentame para que quieres invertir.
      </h2>

      <p class="mt-4 max-w-xl text-lg leading-8 text-slate-500">
        Escribelo como se lo dirias a una persona: monto, plazo, objetivo o cualquier detalle que tengas en mente.
      </p>

      <form id="goal-form" class="glass-card mt-8 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <textarea
          id="goal-input"
          class="goal-input"
          placeholder="Ej. Quiero comprar una moto en 6 meses y puedo aportar cada mes..."
        >${appState.goalText}</textarea>

        <button class="primary-button mt-4" type="submit">
          Analizar mi objetivo
          <span aria-hidden="true">-></span>
        </button>
      </form>
    </div>
  `;

  document.getElementById("goal-form").addEventListener("submit", handleGoalSubmit);
}

async function handleGoalSubmit(event) {
  event.preventDefault();

  const input = document.getElementById("goal-input");
  appState.goalText = input.value.trim();

  if (!appState.goalText) {
    input.focus();
    input.placeholder = "Escribe una meta para que la IA pueda ayudarte...";
    return;
  }

  renderLoaderState("Estoy interpretando tu meta y preparando una pregunta inteligente...");

  const question = await mockFetchDynamicQuestion(appState.goalText);
  renderDynamicQuestionState(question);
}

function renderLoaderState(message) {
  setState("loading");

  getPanel().innerHTML = `
    <div class="view loader-wrap">
      <div class="orb-loader" aria-hidden="true"></div>
      <div>
        <h2 class="text-3xl font-black tracking-normal text-slate-950">Analizando contexto</h2>
        <p class="mt-3 max-w-md text-lg leading-8 text-slate-500">${message}</p>
      </div>
    </div>
  `;
}

function renderDynamicQuestionState(question) {
  setState("dynamic-question");

  const optionsMarkup = question.options
    .map(
      (option) => `
        <button class="choice-button" type="button" data-option-id="${option.id}">
          <span class="block text-base">${option.label}</span>
          <span class="mt-2 block text-sm font-extrabold text-blue-600">Perfil ${option.riskProfile}</span>
        </button>
      `
    )
    .join("");

  getPanel().innerHTML = `
    <div class="view">
      <span class="eyebrow">
        <span class="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
        Pregunta dinamica de la IA
      </span>

      <h2 class="mt-6 text-4xl font-black leading-tight tracking-normal text-slate-950">
        ${question.title}
      </h2>

      <p class="mt-4 text-lg leading-8 text-slate-500">${question.subtitle}</p>

      <div class="choice-grid mt-8">${optionsMarkup}</div>
    </div>
  `;

  document.querySelectorAll("[data-option-id]").forEach((button) => {
    button.addEventListener("click", () => handleQuestionAnswer(button.dataset.optionId));
  });
}

async function handleQuestionAnswer(optionId) {
  appState.selectedAnswer = optionId;
  renderLoaderState("Construyendo una propuesta visual de portafolio para revision...");

  const portfolio = await mockFetchPortfolioProposal({
    goal: appState.goalText,
    answer: optionId,
  });

  renderPortfolioState(portfolio);
}

function renderPortfolioState(portfolio) {
  setState("portfolio");

  const assetRows = portfolio.assets
    .map(
      (asset) => `
        <div class="asset-row">
          <div class="flex items-center gap-3">
            <span class="asset-dot" style="background:${asset.color}"></span>
            <span class="text-sm font-extrabold text-slate-700">${asset.name}</span>
          </div>
          <span class="text-sm font-black text-slate-950">${asset.value}%</span>
        </div>
      `
    )
    .join("");

  getPanel().innerHTML = `
    <div class="view">
      <span class="projection-label">Proyección Histórica del Portafolio</span>

      <div class="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-4xl font-black leading-tight tracking-normal text-slate-950">
            Propuesta lista para revision.
          </h2>
          <p class="mt-3 max-w-xl text-lg leading-8 text-slate-500">
            Este portafolio es una simulacion inicial basada en tu objetivo y respuesta de perfil.
          </p>
        </div>
      </div>

      <div class="glass-card mt-7 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.05)]">
        <div class="portfolio-grid">
          <div class="chart-shell">
            <canvas id="portfolio-chart" aria-label="Distribucion de activos" role="img"></canvas>
          </div>

          <div class="space-y-3">${assetRows}</div>
        </div>

        <div class="justification-box mt-5">
          <p class="text-sm font-black uppercase tracking-normal text-blue-600">Justificacion de la IA</p>
          <p class="mt-2">${portfolio.aiJustification}</p>
        </div>

        <div class="mt-5 flex flex-col gap-3 sm:flex-row">
          <button class="primary-button" type="button" id="send-advisor-button">
            Enviar al Asesor Humano
          </button>
          <button class="secondary-button" type="button" id="restart-button">
            Crear otra meta
          </button>
        </div>
      </div>
    </div>
  `;

  renderPortfolioChart(portfolio);
  document.getElementById("restart-button").addEventListener("click", renderIcebreakerState);
  document.getElementById("send-advisor-button").addEventListener("click", handleSendToAdvisor);
}

function renderPortfolioChart(portfolio) {
  const canvas = document.getElementById("portfolio-chart");
  const labels = portfolio.assets.map((asset) => asset.name);
  const values = portfolio.assets.map((asset) => asset.value);
  const colors = portfolio.assets.map((asset) => asset.color);

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
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.label}: ${context.parsed}%`,
          },
        },
      },
    },
  });
}

function destroyPortfolioChart() {
  if (appState.chart) {
    appState.chart.destroy();
    appState.chart = null;
  }
}

async function handleSendToAdvisor() {
  const button = document.getElementById("send-advisor-button");
  button.textContent = "Enviando...";
  button.disabled = true;

  await mockSendProposalToAdvisor({
    goal: appState.goalText,
    selectedAnswer: appState.selectedAnswer,
    portfolio: mockPortfolio,
  });

  button.textContent = "Enviado al Asesor Humano";
}

async function mockFetchDynamicQuestion(goalText) {
  try {
    const response = await fetch("/api/question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalText }),
    });

    if (!response.ok) {
      throw new Error("Respuesta no valida del servidor");
    }

    return await response.json();
  } catch (error) {
    console.warn("Usando pregunta mock por fallback:", error);
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(mockQuestion), 500);
    });
  }
}

async function mockFetchPortfolioProposal(payload) {
  try {
    const response = await fetch("/api/proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("Respuesta no valida del servidor");
    }

    return await response.json();
  } catch (error) {
    console.warn("Usando propuesta mock por fallback:", error);
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(mockPortfolio), 500);
    });
  }
}

async function mockSendProposalToAdvisor(payload) {
  try {
    const response = await fetch("/api/advisor-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("No se pudo guardar la propuesta");
    }

    return await response.json();
  } catch (error) {
    console.warn("Guardado mock por fallback:", error);
    return new Promise((resolve) => {
      window.setTimeout(() => resolve({ ok: true }), 500);
    });
  }
}
