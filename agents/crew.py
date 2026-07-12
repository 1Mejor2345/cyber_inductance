import json
import os
import time
import logging
from datetime import datetime
from crewai import Agent, Crew, Process, Task, LLM
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURACIÓN DEL MODELO - MODELOS ACTUALES DEL FREE TIER (Julio 2026)
# ============================================================================
# Los modelos viejos (gemini-2.0-flash, gemini-2.5-flash-lite) fueron RETIRADOS.
# Modelos disponibles en free tier actualmente:
#   - gemini/gemini-3.5-flash       (recomendado, más capaz)
#   - gemini/gemini-3.1-flash-lite  (más rápido, menos tokens)
#
# El prefijo "gemini/" es OBLIGATORIO para usar API Key en vez de Vertex AI.
# ============================================================================

MODELO_PRINCIPAL = "gemini/gemini-3.5-flash"
MODELO_FALLBACK = "gemini/gemini-3.1-flash-lite"

# Free tier: ~10-15 RPM, ~1500 RPD. Ponemos max_rpm bajo para no saturar.
MAX_RPM_SEGURO = 2


def _crear_llm(modelo: str = None) -> LLM:
    """Crea una instancia de LLM con el modelo especificado."""
    return LLM(
        model=modelo or MODELO_PRINCIPAL,
        api_key=os.getenv("GEMINI_API_KEY"),
        temperature=0.2,
    )


def _ejecutar_con_retry(crew: Crew, max_intentos: int = 5) -> str:
    """
    Ejecuta un Crew con reintentos y backoff exponencial para manejar
    errores 429 (rate limit) del free tier de Gemini.
    
    Espera progresivamente más tiempo entre intentos:
      Intento 1: espera 30s
      Intento 2: espera 60s
      Intento 3: espera 120s
      Intento 4: espera 240s
    """
    for intento in range(max_intentos):
        try:
            logger.info(f"🚀 Intento {intento + 1}/{max_intentos}...")
            resultado = crew.kickoff()
            logger.info(f"✅ Éxito en intento {intento + 1}")
            return resultado
        except Exception as e:
            error_str = str(e).lower()
            es_rate_limit = any(keyword in error_str for keyword in [
                "429", "rate_limit", "ratelimit", "resource_exhausted",
                "quota", "exceeded", "too many requests"
            ])
            
            if es_rate_limit and intento < max_intentos - 1:
                # Backoff exponencial: 30s, 60s, 120s, 240s...
                espera = 30 * (2 ** intento)
                logger.warning(
                    f"⚠️  Rate limit alcanzado. Esperando {espera}s antes "
                    f"de reintentar (intento {intento + 1}/{max_intentos})..."
                )
                time.sleep(espera)
            elif es_rate_limit and intento == max_intentos - 1:
                raise Exception(
                    f"❌ Se agotaron los {max_intentos} intentos por rate limit. "
                    f"El free tier de Gemini tiene límites estrictos por minuto y por día. "
                    f"Espera unos minutos e intenta de nuevo. "
                    f"Error original: {str(e)[:200]}"
                )
            else:
                # Error no relacionado con rate limit, lanzar directamente
                raise


# ============================================================================
# CATÁLOGOS Y REGLAS (sin cambios)
# ============================================================================

CATALOGO_INSTRUMENTOS = """
Catálogo Oficial de Instrumentos — v1.0
1. Bonos del Estado AAA (Riesgo Muy Bajo)
2. ETFs S&P 500 ej. SPY (Riesgo Medio)
3. Fondos Monetarios Líquidos (Riesgo Muy Bajo)
4. ETFs Tecnología ej. QQQ (Riesgo Alto)
5. Bonos Corporativos Grado Inversión (Riesgo Bajo)
6. Alternativos Líquidos (Riesgo Medio-Bajo)
"""

REGLAS_PERFILAMIENTO = """
Sistema de Perfilamiento v2.0
- Respuestas CONSERVADORAS → -10 pts
- Respuestas BALANCEADAS  →   0 pts
- Respuestas DINÁMICAS    → +10 pts
Clasificación: <=-20 (Conservador), -19 a 20 (Moderado), >20 (Agresivo)
"""

# ============================================================================
# AGENTES - Ahora usan función factory para poder recrear con fallback
# ============================================================================

def _crear_agentes(modelo: str = None):
    """Crea los 4 agentes con el modelo especificado."""
    llm = _crear_llm(modelo)
    
    perfilador = Agent(
        role="Asesor de Perfilamiento",
        goal="Clasificar al cliente en un perfil de riesgo usando las reglas del sistema.",
        backstory=f"Eres transparente. Reglas:\n{REGLAS_PERFILAMIENTO}",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    analista = Agent(
        role="Analista de Portafolios",
        goal="Diseñar una distribución de activos coherente usando solo el catálogo.",
        backstory=f"No prometes rentabilidades. Solo usas este catálogo:\n{CATALOGO_INSTRUMENTOS}",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    explicador = Agent(
        role="Comunicador Financiero",
        goal="Traducir la propuesta a lenguaje claro para el cliente y asesor.",
        backstory="Eres el puente entre la IA y las personas.",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    revisor = Agent(
        role="Auditor de Cumplimiento",
        goal="Registrar cada decisión del asesor humano para trazabilidad.",
        backstory="Tu función es estructurar el log de auditoría.",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    return perfilador, analista, explicador, revisor


def _limpiar_json(texto: str) -> dict:
    import re
    match = re.search(r'\{.*\}', texto, re.DOTALL)
    if match:
        try: return json.loads(match.group(0))
        except: pass
    return {}


def run_crew_completo(goal_text: str, risk_answers: dict) -> dict:
    """Ejecuta los 3 agentes en cadena para alimentar el script.js"""
    
    agente_perfilador, agente_analista, agente_explicador, _ = _crear_agentes()
    
    tarea_perfil = Task(
        description=f"Meta: {goal_text}. Respuestas: {json.dumps(risk_answers)}. Asigna perfil. Responde SOLO con JSON exacto: {{\"perfil\": \"Conservador o Moderado o Agresivo\", \"score\": 20, \"reglas_usadas\": [\"Suma pts...\"], \"explicacion_perfil\": \"...\"}}",
        expected_output="JSON de perfil",
        agent=agente_perfilador
    )

    tarea_propuesta = Task(
        description="Crea propuesta de portafolio para el perfil asignado. Responde SOLO con JSON exacto: {\"asignacion\": [{\"nombre\": \"Nombre activo\", \"porcentaje\": 40, \"color\": \"#2563eb\"}], \"riesgo\": \"...\", \"justificacion\": \"...\", \"disclaimer\": \"...\"}. Suma de porcentajes debe ser 100. Colores a usar: #2563eb, #10b981, #38bdf8, #a7f3d0",
        expected_output="JSON de propuesta",
        agent=agente_analista,
        context=[tarea_perfil]
    )

    tarea_explicacion = Task(
        description="Genera explicaciones. Responde SOLO con JSON exacto: {\"explicacion_cliente\": \"...\", \"resumen_asesor\": \"...\", \"alertas\": [\"alerta 1 si la hay\"], \"version_reglas\": \"v1.0\"}",
        expected_output="JSON de explicaciones",
        agent=agente_explicador,
        context=[tarea_perfil, tarea_propuesta]
    )

    crew = Crew(
        agents=[agente_perfilador, agente_analista, agente_explicador], 
        tasks=[tarea_perfil, tarea_propuesta, tarea_explicacion], 
        process=Process.sequential, 
        verbose=True,
        max_rpm=MAX_RPM_SEGURO
    )
    
    # Ejecutar con retry automático para rate limits
    _ejecutar_con_retry(crew)
    
    # Combinamos las 3 respuestas JSON en un solo mega diccionario
    out1 = _limpiar_json(tarea_perfil.output.raw)
    out2 = _limpiar_json(tarea_propuesta.output.raw)
    out3 = _limpiar_json(tarea_explicacion.output.raw)
    
    return {**out1, **out2, **out3}


def registrar_auditoria(propuesta: dict, accion: str, asesor_nombre: str) -> dict:
    _, _, _, agente_revisor = _crear_agentes()
    
    tarea_auditoria = Task(
        description=f"Asesor: {asesor_nombre} tomó accion: {accion} sobre perfil {propuesta.get('perfil')}. Genera JSON: {{'fecha': '{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}', 'responsable': '{asesor_nombre}', 'accion': '{accion}', 'version_reglas': 'v1.0 Q3-2026', 'observaciones': 'Ninguna'}}",
        expected_output="JSON de auditoria",
        agent=agente_revisor,
    )
    crew = Crew(
        agents=[agente_revisor], 
        tasks=[tarea_auditoria], 
        process=Process.sequential,
        max_rpm=MAX_RPM_SEGURO
    )
    
    resultado = _ejecutar_con_retry(crew)
    return _limpiar_json(resultado.raw)