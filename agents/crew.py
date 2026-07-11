"""
agents/crew.py
==============
Define los 4 agentes especializados del sistema Robo-Advisor.

Todos usan el mismo modelo Gemini 1.5 Flash (recomendación del mentor).
Se comunican en cadena mediante el mecanismo de contexto de CrewAI:
  Agente 1 (Perfilador)  → HU1: clasifica el perfil de riesgo
  Agente 2 (Analista)    → HU2: genera propuesta de portafolio
  Agente 3 (Explicador)  → HU2+HU3: prepara explicación y resumen para el asesor
  Agente 4 (Revisor)     → HU3: registra la decisión de auditoría del asesor humano
"""

import json
import os
from datetime import datetime

from crewai import LLM, Agent, Crew, Process, Task
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# LLM COMPARTIDO — mismo modelo para los 4 agentes (recomendación del mentor)
# ─────────────────────────────────────────────────────────────────────────────
_llm = LLM(
    model="gpt-4o-mini",
    api_key=os.getenv("OPENAI_API_KEY"),
    temperature=0.2,
)

# ─────────────────────────────────────────────────────────────────────────────
# CATÁLOGO OFICIAL DE INSTRUMENTOS — v1.0 Q3-2026 (visible y versionado)
# ─────────────────────────────────────────────────────────────────────────────
CATALOGO_INSTRUMENTOS = """
Catálogo Oficial de Instrumentos — v1.0 Q3-2026
================================================
1. Bonos del Estado AAA
   Riesgo: Muy Bajo | Proyección histórica: 3-4% anual

2. ETFs S&P 500 (ej. SPY)
   Riesgo: Medio | Proyección histórica: 7-9% anual

3. Fondos Monetarios Líquidos
   Riesgo: Muy Bajo | Proyección histórica: 2-3% anual

4. ETFs Tecnología (ej. QQQ)
   Riesgo: Alto | Proyección histórica: 12-15% anual

5. Bonos Corporativos Grado Inversión
   Riesgo: Bajo | Proyección histórica: 4-6% anual

6. Alternativos Líquidos
   Riesgo: Medio-Bajo | Proyección histórica: 5-6% anual
"""

# ─────────────────────────────────────────────────────────────────────────────
# REGLAS DE PERFILAMIENTO — v1.0 Q3-2026 (visibles y versionadas)
# ─────────────────────────────────────────────────────────────────────────────
REGLAS_PERFILAMIENTO = """
Sistema de Perfilamiento de Riesgo Integral — v2.0 Q3-2026
==========================================================
Analiza las 10 respuestas provistas por el cliente y asigna puntos:

1. Respuestas de sesgo CONSERVADOR → -10 puntos cada una
2. Respuestas de sesgo BALANCEADO  →   0 puntos cada una
3. Respuestas de sesgo DINÁMICO    → +10 puntos cada una

Considera la meta general del cliente y su horizonte implícito como un factor adicional (±10 puntos).

Clasificación Final basada en el score total:
  Score <= -20          → Perfil: Conservador
  -20 < Score <= 20     → Perfil: Balanceado
  Score > 20            → Perfil: Dinámico
"""

# ─────────────────────────────────────────────────────────────────────────────
# DEFINICIÓN DE LOS 4 AGENTES
# ─────────────────────────────────────────────────────────────────────────────

agente_perfilador = Agent(
    role="Asesor de Perfilamiento de Riesgo Financiero",
    goal=(
        "Analizar la meta e información del cliente para clasificarlo en un "
        "perfil de riesgo usando las reglas visibles y versionadas del sistema."
    ),
    backstory=(
        "Eres el primer punto de contacto del proceso de inversión. "
        "Tu responsabilidad es clasificar al cliente con total transparencia, "
        "explicando paso a paso cómo cada factor influyó en el resultado. "
        "Siempre aplicas este sistema de reglas:\n" + REGLAS_PERFILAMIENTO
    ),
    llm=_llm,
    verbose=True,
    allow_delegation=False,
)

agente_analista = Agent(
    role="Analista de Portafolio de Inversiones",
    goal=(
        "Diseñar una propuesta de distribución de activos coherente con el "
        "perfil recibido, usando únicamente instrumentos del catálogo oficial."
    ),
    backstory=(
        "Eres un analista de portafolios con experiencia en mercados globales. "
        "Solo usas instrumentos del catálogo aprobado. Nunca prometes rentabilidades "
        "ni ejecutas órdenes. Tu propuesta siempre es para revisión del asesor humano.\n"
        + CATALOGO_INSTRUMENTOS
    ),
    llm=_llm,
    verbose=True,
    allow_delegation=False,
)

agente_explicador = Agent(
    role="Comunicador Financiero y Preparador de Revisión",
    goal=(
        "Traducir el perfil y la propuesta técnica a lenguaje claro para el cliente "
        "y preparar un resumen ejecutivo completo para el asesor humano."
    ),
    backstory=(
        "Eres el puente entre la IA y las personas. Explicas conceptos financieros "
        "de forma simple y sin jerga. También preparas documentación estructurada "
        "para revisión del asesor, destacando señales de alerta si las hubiera."
    ),
    llm=_llm,
    verbose=True,
    allow_delegation=False,
)

agente_revisor = Agent(
    role="Registrador de Auditoría y Cumplimiento Regulatorio",
    goal=(
        "Registrar de forma estructurada y completa cada decisión del asesor humano "
        "para garantizar trazabilidad y cumplimiento regulatorio."
    ),
    backstory=(
        "Eres el sistema de auditoría del proceso. Tu única función es registrar con "
        "precisión cada acción del asesor: quién decidió, qué decidió, cuándo, "
        "con qué versión de reglas y con qué observaciones."
    ),
    llm=_llm,
    verbose=True,
    allow_delegation=False,
)


# ─────────────────────────────────────────────────────────────────────────────
# UTILIDAD INTERNA
# ─────────────────────────────────────────────────────────────────────────────

def _limpiar_json(texto: str) -> dict:
    """Extrae el primer bloque JSON del texto, ignorando el texto que lo rodea."""
    import re
    match = re.search(r'\{.*\}', texto, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# FUNCIÓN PRINCIPAL: corre los agentes 1, 2 y 3 en cadena
# ─────────────────────────────────────────────────────────────────────────────

def run_crew(goal_text: str, risk_answers: dict) -> dict:
    """
    Ejecuta la cadena de 3 agentes de forma secuencial.
    El output de cada agente se pasa como contexto al siguiente.
    Devuelve un diccionario consolidado con perfil, propuesta y explicación.
    """
    
    respuestas_str = json.dumps(risk_answers, indent=2, ensure_ascii=False) if isinstance(risk_answers, dict) else str(risk_answers)

    tarea_perfil = Task(
        description=f"""
Analiza al siguiente cliente y clasifícalo en un perfil de riesgo.

Datos del cliente:
- Meta de inversión: {goal_text}
- Respuestas del cuestionario KYC de 10 preguntas: {respuestas_str}

Aplica el sistema de reglas de perfilamiento paso a paso y de forma transparente.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown:
{{
    "perfil": "Conservador|Balanceado|Dinámico",
    "score": <número entero calculado>,
    "reglas_usadas": [
        "Suma de puntos conservadores: X",
        "Suma de puntos dinámicos: Y",
        "Ajuste por meta: Z",
        "Score final: W -> Perfil"
    ],
    "explicacion_perfil": "Explicación clara de 2-3 oraciones de por qué este perfil."
}}
""",
        expected_output="JSON: perfil, score, reglas_usadas, explicacion_perfil",
        agent=agente_perfilador,
    )

    tarea_propuesta = Task(
        description=f"""
Con el perfil de riesgo del agente anterior, diseña una propuesta de portafolio.

Meta del cliente: {goal_text}

REGLAS OBLIGATORIAS:
- Usa ÚNICAMENTE instrumentos del catálogo oficial.
- Los porcentajes de la asignación DEBEN sumar exactamente 100.
- No prometas rentabilidades futuras.
- Incluye entre 3 y 5 instrumentos.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown:
{{
    "asignacion": [
        {{"nombre": "Nombre del instrumento", "porcentaje": 40, "color": "#2563eb"}},
        {{"nombre": "Nombre del instrumento", "porcentaje": 35, "color": "#10b981"}},
        {{"nombre": "Nombre del instrumento", "porcentaje": 25, "color": "#38bdf8"}}
    ],
    "riesgo": "Descripción del nivel de riesgo y volatilidad esperada",
    "justificacion": "Justificación de por qué esta distribución es adecuada para el perfil y la meta.",
    "disclaimer": "Esta es una propuesta estratégica para revisión humana. No se ejecutan órdenes ni se garantizan rentabilidades futuras."
}}

Colores disponibles (úsalos en este orden preferente):
#2563eb (azul), #10b981 (verde), #38bdf8 (celeste), #a7f3d0 (verde claro), #f59e0b (naranja)
""",
        expected_output="JSON: asignacion (lista), riesgo, justificacion, disclaimer",
        agent=agente_analista,
        context=[tarea_perfil],
    )

    tarea_explicacion = Task(
        description=f"""
Con el perfil y la propuesta generados por los agentes anteriores, produce dos textos:

1. Explicación para el CLIENTE: amigable, sin jerga, motivadora, máximo 3 oraciones.
2. Resumen para el ASESOR HUMANO: conciso, técnico, con datos clave.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown:
{{
    "explicacion_cliente": "Texto amigable que explica por qué este portafolio conviene al cliente.",
    "resumen_asesor": "Perfil: X (score: Y). Meta: {goal_text}. Distribución principal: ... Señales de atención: ...",
    "alertas": ["alerta si la hay", "otra alerta si existe"],
    "version_reglas": "v1.0 - Catálogo Q3-2026"
}}

Si no hay alertas, usa lista vacía [].
Posibles alertas: horizonte muy corto para el monto, inconsistencia entre tolerancia declarada y meta, etc.
""",
        expected_output="JSON: explicacion_cliente, resumen_asesor, alertas, version_reglas",
        agent=agente_explicador,
        context=[tarea_perfil, tarea_propuesta],
    )

    crew = Crew(
        agents=[agente_perfilador, agente_analista, agente_explicador],
        tasks=[tarea_perfil, tarea_propuesta, tarea_explicacion],
        process=Process.sequential,
        verbose=True,
    )

    resultado = crew.kickoff()

    # Extraer y parsear el output de cada tarea
    outputs = resultado.tasks_output
    datos_perfil = _limpiar_json(outputs[0].raw)
    datos_propuesta = _limpiar_json(outputs[1].raw)
    datos_explicacion = _limpiar_json(outputs[2].raw)

    return {**datos_perfil, **datos_propuesta, **datos_explicacion}


# ─────────────────────────────────────────────────────────────────────────────
# AGENTE 4: Revisor — se activa solo cuando el asesor toma una acción
# ─────────────────────────────────────────────────────────────────────────────

def run_revisor(
    propuesta: dict,
    accion: str,
    asesor_nombre: str,
    observaciones: str = "",
) -> dict:
    """
    Ejecuta el Agente Revisor al registrar una decisión del asesor humano.
    Devuelve el log de auditoría estructurado.
    """
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    version = propuesta.get("version_reglas", "v1.0 - Catálogo Q3-2026")

    tarea_auditoria = Task(
        description=f"""
Registra esta decisión del asesor humano para trazabilidad regulatoria.

Datos de la decisión:
- Asesor responsable: {asesor_nombre}
- Acción tomada: {accion}
- Fecha y hora: {ahora}
- Observaciones del asesor: {observaciones or "Sin observaciones adicionales"}
- Perfil del cliente en la propuesta: {propuesta.get("perfil", "N/A")}
- Score de perfilamiento: {propuesta.get("score", "N/A")}
- Versión de reglas aplicadas: {version}

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni markdown:
{{
    "fecha": "{ahora}",
    "responsable": "{asesor_nombre}",
    "accion": "{accion}",
    "version_reglas": "{version}",
    "observaciones": "{observaciones or 'Sin observaciones'}"
}}
""",
        expected_output="JSON de auditoría: fecha, responsable, accion, version_reglas, observaciones",
        agent=agente_revisor,
    )

    crew_revision = Crew(
        agents=[agente_revisor],
        tasks=[tarea_auditoria],
        process=Process.sequential,
        verbose=True,
    )

    resultado = crew_revision.kickoff()

    try:
        return _limpiar_json(resultado.raw)
    except Exception:
        # Fallback determinístico si el JSON no es parseable
        return {
            "fecha": ahora,
            "responsable": asesor_nombre,
            "accion": accion,
            "version_reglas": version,
            "observaciones": observaciones or "Sin observaciones",
        }
