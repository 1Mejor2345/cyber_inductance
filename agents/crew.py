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
# REGLAS ESTRICTAS DE SALIDA JSON - SIN TEXTOS LIBRES NI ALUCINACIONES
# ============================================================================
REGLAS_SALIDA_JSON = """
REGLAS ESTRICTAS DE FORMATO DE SALIDA:
1. TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN JSON VÁLIDO.
2. PROHIBIDO usar texto libre, markdown, explicaciones fuera del JSON.
3. PROHIBIDO inventar puntajes. El score debe calcularse SOLO de las reglas.
4. PROHIBIDO usar formatos como "Score: -30/50" o texto narrativo.
5. Los valores numéricos deben ser números reales, no strings.
6. Si no puedes calcular un valor, usa null, no inventes uno.
7. La suma de porcentajes de asignación debe ser EXACTAMENTE 100.
"""

# ============================================================================
# AGENTES - Ahora usan función factory para poder recrear con fallback
# ============================================================================

def _crear_agentes(modelo: str = None):
    """Crea los 4 agentes con el modelo especificado."""
    llm = _crear_llm(modelo)
    
    perfilador = Agent(
        role="Asesor de Perfilamiento",
        goal="Clasificar al cliente en un perfil de riesgo usando las reglas del sistema. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}

Eres transparente y riguroso. Reglas:
{REGLAS_PERFILAMIENTO}

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado, sin ningún texto adicional.""",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    analista = Agent(
        role="Analista de Portafolios",
        goal="Diseñar una distribución de activos coherente usando solo el catálogo. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}

No prometes rentabilidades. Solo usas este catálogo:
{CATALOGO_INSTRUMENTOS}

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado, sin ningún texto adicional.""",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    explicador = Agent(
        role="Comunicador Financiero",
        goal="Traducir la propuesta a lenguaje claro para el cliente y asesor. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}

Eres el puente entre la IA y las personas.

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado, sin ningún texto adicional.""",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    revisor = Agent(
        role="Auditor de Cumplimiento",
        goal="Registrar cada decisión del asesor humano para trazabilidad. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}

Tu función es estructurar el log de auditoría.

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado, sin ningún texto adicional.""",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    return perfilador, analista, explicador, revisor


def _limpiar_json(texto: str) -> dict:
    """
    Extrae y limpia un JSON de la respuesta del modelo.
    
    PROHIBIDO devolver texto libre. Si no se puede parsear, devuelve dict vacío.
    
    IMPORTANTE: Elimina textos basura como "Score: -30/50" o markdown antes de parsear.
    """
    import re
    
    if not texto:
        return {}
    
    # PASO 1: Limpiar texto basura común de Gemini
    # Eliminar markdown code blocks
    texto = re.sub(r'```(?:json)?\s*', '', texto)
    
    # Eliminar líneas que parecen alucinaciones de métricas
    # Ejemplos: "Score: -30/50", "Puntaje: 20/50", etc.
    texto = re.sub(r'(?m)^.*(?:Score|Puntaje|Rating|Calificación)\s*:\s*[-+]?\d+(?:/\d+)?\s*$', '', texto)
    
    # Eliminar otros textos narrativos comunes antes del JSON
    texto = re.sub(r'(?m)^(?:Aquí está|Here is|El resultado es|The result is).*$', '', texto)
    
    # PASO 2: Intentar parsear directamente si es JSON puro
    try:
        return json.loads(texto.strip())
    except:
        pass
    
    # PASO 3: Buscar el primer JSON válido en el texto
    # Patrón mejorado para manejar JSONs anidados
    patron_json = r'\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\})*)*\})*)*\}'
    matches = re.findall(patron_json, texto, re.DOTALL)
    
    for match in matches:
        try:
            resultado = json.loads(match)
            if isinstance(resultado, dict):
                logger.info("✅ JSON extraído exitosamente de la respuesta del modelo")
                return resultado
        except:
            continue
    
    logger.error(f"❌ No se pudo extraer JSON válido. Texto recibido: {texto[:300]}...")
    return {}


def run_crew_completo(goal_text: str, risk_answers: dict) -> dict:
    """Ejecuta los 3 agentes en cadena para alimentar el script.js
    
    IMPORTANTE: La respuesta debe ser EXCLUSIVAMENTE JSON válido, sin textos libres.
    Los puntajes se calculan según las reglas: Conservador=-10, Balanceado=0, Dinámico=+10
    Clasificación: <=-20 (Conservador), -19 a 20 (Moderado), >20 (Agresivo)
    """
    
    agente_perfilador, agente_analista, agente_explicador, _ = _crear_agentes()
    
    # Tarea 1: Perfilamiento con instrucciones JSON estrictas
    tarea_perfil = Task(
        description=f"""Analiza las respuestas del usuario y calcula el perfil de riesgo.

META DEL USUARIO: {goal_text}

RESPUESTAS DEL CUESTIONARIO:
{json.dumps(risk_answers, ensure_ascii=False, indent=2)}

REGLAS DE PUNTUACIÓN:
- Respuestas de tipo "Conservative" → -10 puntos cada una
- Respuestas de tipo "Balanced" → 0 puntos cada una  
- Respuestas de tipo "Dynamic" → +10 puntos cada una

CLASIFICACIÓN FINAL:
- Score <= -20 → Perfil "Conservador"
- Score entre -19 y 20 → Perfil "Moderado"
- Score > 20 → Perfil "Agresivo"

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown, sin texto adicional):
{{
  "perfil": "Conservador" | "Moderado" | "Agresivo",
  "score": <número entero entre -50 y 50>,
  "reglas_usadas": ["descripción de cada regla aplicada"],
  "explicacion_perfil": "explicación breve del resultado"
}}
""",
        expected_output="JSON con perfil, score, reglas_usadas y explicacion_perfil",
        agent=agente_perfilador
    )

    # Tarea 2: Propuesta de portafolio con instrucciones JSON estrictas
    tarea_propuesta = Task(
        description=f"""Diseña una propuesta de portafolio basada en el perfil calculado.

CATÁLOGO DE INSTRUMENTOS DISPONIBLES:
{CATALOGO_INSTRUMENTOS}

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown, sin texto adicional):
{{
  "asignacion": [
    {{"nombre": "Nombre del activo", "porcentaje": 40, "color": "#2563eb"}},
    {{"nombre": "Otro activo", "porcentaje": 35, "color": "#10b981"}}
  ],
  "riesgo": "descripción del nivel de riesgo del portafolio",
  "justificacion": "justificación de la asignación propuesta",
  "disclaimer": "aviso legal obligatorio sobre riesgos"
}}

REGLAS:
1. La suma de porcentajes debe ser EXACTAMENTE 100
2. Solo usa instrumentos del catálogo oficial
3. Colores disponibles: #2563eb (azul), #10b981 (verde), #38bdf8 (celeste), #a7f3d0 (verde claro)
4. NO prometas rentabilidades específicas
""",
        expected_output="JSON con asignacion, riesgo, justificacion y disclaimer",
        agent=agente_analista,
        context=[tarea_perfil]
    )

    # Tarea 3: Explicaciones con instrucciones JSON estrictas
    tarea_explicacion = Task(
        description=f"""Genera explicaciones claras para el cliente y el asesor.

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown, sin texto adicional):
{{
  "explicacion_cliente": "explicación en lenguaje simple para el cliente",
  "resumen_asesor": "resumen técnico para el asesor humano",
  "alertas": ["alerta 1 si existe alguna incoherencia o riesgo"],
  "version_reglas": "v1.0"
}}

REGLAS:
1. Usa lenguaje claro y simple para el cliente
2. El resumen del asesor debe ser técnico pero conciso
3. Solo incluye alertas si hay inconsistencias o riesgos importantes
4. Si no hay alertas, usa un array vacío: []
""",
        expected_output="JSON con explicacion_cliente, resumen_asesor, alertas y version_reglas",
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
    
    resultado_final = {**out1, **out2, **out3}
    
    # VALIDACIÓN CRÍTICA: Verificar que NO hay textos basura en los valores
    resultado_limpio = _validar_y_limpiar_resultado(resultado_final)
    
    return resultado_limpio


def _validar_y_limpiar_resultado(data: dict) -> dict:
    """
    VALIDACIÓN FINAL: Asegura que el resultado NO contiene textos basura.
    
    Elimina formatos como "Score: -30/50" de cualquier campo de texto.
    """
    import re
    
    # Campos que deben ser strings limpios (sin métricas inventadas)
    campos_texto = [
        'perfil', 'explicacion_perfil', 'riesgo', 'justificacion', 
        'disclaimer', 'explicacion_cliente', 'resumen_asesor', 'version_reglas'
    ]
    
    for campo in campos_texto:
        if campo in data and isinstance(data[campo], str):
            # Eliminar patrones de "Score: X/Y" o similares
            data[campo] = re.sub(
                r'(?:Score|Puntaje|Rating|Calificación)\s*:\s*[-+]?\d+(?:/\d+)?',
                '',
                data[campo]
            ).strip()
    
    # Validar que el score sea un número entero válido (no string)
    if 'score' in data:
        try:
            data['score'] = int(data['score'])
        except (ValueError, TypeError):
            logger.warning(f"⚠️  Score inválido: {data.get('score')}. Usando None.")
            data['score'] = None
    
    # Validar que los porcentajes sumen 100
    if 'asignacion' in data and isinstance(data['asignacion'], list):
        total = sum(a.get('porcentaje', 0) for a in data['asignacion'])
        if abs(total - 100) > 1:  # Tolerancia de 1%
            logger.warning(f"⚠️  Los porcentajes suman {total}%, no 100%")
    
    logger.info("✅ Resultado validado y limpiado exitosamente")
    return data


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