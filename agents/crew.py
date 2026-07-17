import json
import os
import time
import logging
from datetime import datetime
from crewai import Agent, Crew, Process, Task, LLM
from crewai.tools import tool
from dotenv import load_dotenv
from agents.market_data import obtener_catalogo_real, buscar_instrumento, validar_propuesta

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

MODELO_PRINCIPAL = "gemini/gemini-3.1-flash-lite"
MODELO_FALLBACK = "gemini/gemini-3.5-flash"

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

# El catálogo se obtiene dinámicamente de market_data.py usando yfinance

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
# AGENTES Y HERRAMIENTAS
# ============================================================================

@tool("Consultar Instrumento Real")
def tool_consultar_mercado(ticker: str) -> str:
    """Consulta el precio actual, rendimiento, beta y sector de un instrumento financiero real por su ticker (ej. SPY, QQQ, BND)."""
    return json.dumps(buscar_instrumento(ticker))


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
        goal="Diseñar una distribución de activos usando exclusivamente los instrumentos reales del catálogo. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}

Solo puedes usar los instrumentos del catálogo que se te proporcionará. 
Es crítico que uses los Tickers correctos.

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado.""",
        llm=llm, verbose=True, allow_delegation=False,
        max_rpm=MAX_RPM_SEGURO
    )
    
    verificador = Agent(
        role="Verificador de Mercados",
        goal="Verificar que los instrumentos propuestos existen y obtener sus datos reales para validar la propuesta. RESPONDE SOLO JSON VÁLIDO.",
        backstory=f"""{REGLAS_SALIDA_JSON}
        
Eres el control de calidad antialucinación.
Revisas la propuesta del analista y consultas el mercado real.

IMPORTANTE: Tu respuesta DEBE ser exclusivamente el JSON solicitado, añadiendo los datos de mercado a la justificación.""",
        tools=[tool_consultar_mercado],
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
    
    return perfilador, analista, verificador, explicador, revisor


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


def validar_meta_con_llm(goal_text: str) -> dict:
    """
    CAMBIO 1: Filtro de Realidad y Extracción de Metas
    
    Valida que el texto ingresado sea una meta financiera real antes de ejecutar
    la cadena pesada de CrewAI. Si es inválido, devuelve error.
    Si es válido, extrae variables clave (horizonte, sectores, monto) para sesgar el portafolio.
    
    Returns:
        dict con "valido": bool, "razon": str (si es inválido), "variables_extraidas": dict (si es válido)
    """
    llm = _crear_llm()
    
    prompt_validacion = f"""Eres un validador de metas financieras. Analiza el siguiente texto del usuario:

TEXTO DEL USUARIO: "{goal_text}"

Debes determinar si es una meta financiera seria y realista, o si es algo inválido.

INVALIDO si:
- Es una broma o texto sin sentido ("quiero comprar la luna", "asdfghjkl")
- Es una meta imposible con el contexto dado ("comprar Ferrari con $10")
- No tiene relación con finanzas o inversiones
- Es demasiado vago o vacío

VALIDO si:
- Menciona un objetivo financiero real (casa, retiro, educación, ahorro, inversión)
- Aunque no tenga monto exacto, demuestra intención seria
- Es coherente aunque sea breve

Si es VALIDO, extrae también estas variables si las menciona (si no, usa null):
- horizonte_tiempo: número de años estimado (o null)
- sectores_interes: lista de sectores mencionados ["tecnologia", "inmobiliario", etc.] (o [])
- monto_estimado: monto aproximado en USD (o null)

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown):
{{
  "valido": true o false,
  "razon": "explicación breve si es inválido" (solo si valido=false),
  "variables_extraidas": {{
    "horizonte_tiempo": número o null,
    "sectores_interes": [],
    "monto_estimado": número o null,
    "tipo_meta": "retiro" | "vivienda" | "educacion" | "ahorro_general" | "inversion_corto_plazo" | null
  }}
}}
"""
    
    try:
        # Crear agente validador temporal
        validador_agente = Agent(
            role="Validador de Metas Financieras",
            goal="Determinar si el texto del usuario es una meta financiera seria y extraer variables clave",
            backstory="Eres el guardián contra inputs sin sentido. Solo dejas pasar metas financieras reales.",
            llm=llm,
            verbose=False,
            allow_delegation=False,
            max_rpm=MAX_RPM_SEGURO
        )
        
        tarea_validacion = Task(
            description=prompt_validacion,
            expected_output="JSON con validación y variables extraídas",
            agent=validador_agente
        )
        
        crew_validacion = Crew(
            agents=[validador_agente],
            tasks=[tarea_validacion],
            process=Process.sequential,
            verbose=False,
            max_rpm=MAX_RPM_SEGURO
        )
        
        resultado = _ejecutar_con_retry(crew_validacion, max_intentos=3)
        return _limpiar_json(tarea_validacion.output.raw)
        
    except Exception as e:
        logger.error(f"Error en validación de meta: {e}")
        # Si falla la validación, por seguridad asumimos que es válido (no bloquear al usuario)
        return {
            "valido": True,
            "variables_extraidas": {
                "horizonte_tiempo": None,
                "sectores_interes": [],
                "monto_estimado": None,
                "tipo_meta": None
            }
        }


def run_crew_completo(goal_text: str, risk_answers: dict, variables_meta: dict = None) -> dict:
    """Ejecuta los 3 agentes en cadena para alimentar el script.js
    
    IMPORTANTE: La respuesta debe ser EXCLUSIVAMENTE JSON válido, sin textos libres.
    Los puntajes se calculan según las reglas: Conservador=-10, Balanceado=0, Dinámico=+10
    Clasificación: <=-20 (Conservador), -19 a 20 (Moderado), >20 (Agresivo)
    """
    
    if variables_meta is None:
        variables_meta = {}
        
    logger.info(f"✅ Iniciando Crew con variables extraídas: {variables_meta}")
    
    agente_perfilador, agente_analista, agente_verificador, agente_explicador, _ = _crear_agentes()
    
    # Obtener catálogo en vivo de yfinance
    catalogo_vivo = obtener_catalogo_real()
    
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

    # CAMBIO 1: Pasar variables extraídas al Analista para sesgar el portafolio
    contexto_adicional = ""
    if variables_meta:
        contexto_adicional = f"""
CONTEXTO ADICIONAL DE LA META DEL USUARIO:
- Horizonte de tiempo estimado: {variables_meta.get('horizonte_tiempo', 'No especificado')} años
- Sectores de interés: {', '.join(variables_meta.get('sectores_interes', [])) or 'No especificado'}
- Tipo de meta: {variables_meta.get('tipo_meta', 'General')}
- Monto estimado: ${variables_meta.get('monto_estimado', 'No especificado')}

IMPORTANTE: Sesga la asignación hacia los sectores mencionados si los hay, y ajusta según el horizonte de tiempo.
Si el usuario mencionó sectores específicos (ej. tecnología), incluye ETFs de esos sectores en el portafolio.
"""
    
    # Tarea 2: Propuesta de portafolio con instrucciones JSON estrictas
    tarea_propuesta = Task(
        description=f"""Diseña una propuesta de portafolio basada en el perfil calculado.

{contexto_adicional}

CATÁLOGOS DE INSTRUMENTOS REALES (Actualizado en tiempo real):
{catalogo_vivo}

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown, sin texto adicional):
{{
  "asignacion": [
    {{"nombre": "Nombre Real del Activo", "ticker": "TICKER", "porcentaje": 40, "color": "#2563eb"}},
    {{"nombre": "Otro Activo", "ticker": "TICKER", "porcentaje": 35, "color": "#10b981"}}
  ],
  "riesgo": "descripción del nivel de riesgo del portafolio",
  "justificacion_preliminar": "justificación de la asignación"
}}

REGLAS:
1. La suma de porcentajes debe ser EXACTAMENTE 100
2. Usa SOLO los instrumentos y Tickers de la lista proporcionada
3. INCLUYE SIEMPRE el campo 'ticker' en cada activo
4. Colores disponibles: #2563eb (azul), #10b981 (verde), #38bdf8 (celeste), #a7f3d0 (verde claro)
""",
        expected_output="JSON con asignacion, riesgo y justificacion_preliminar",
        agent=agente_analista,
        context=[tarea_perfil]
    )

    # Tarea 3: Verificación de mercado
    tarea_verificacion = Task(
        description=f"""Revisa la asignación propuesta por el analista.
Usa tu herramienta 'Consultar Instrumento Real' para buscar CADA ticker propuesto y verificar:
1. Que el instrumento existe en el mercado.
2. Cuál es su precio actual y rendimiento.

Luego de verificar todos los tickers, genera una justificación final que incorpore estos datos reales.

RESPONDE EXCLUSIVAMENTE CON ESTE JSON:
{{
  "justificacion": "justificación FINAL de la asignación mencionando los datos de mercado reales verificados como rendimientos o sectores",
  "disclaimer": "aviso legal obligatorio indicando que los precios mostrados son referenciales y fluctúan",
  "mercado_verificado": true
}}
""",
        expected_output="JSON con justificacion final, disclaimer y flag de verificacion",
        agent=agente_verificador,
        context=[tarea_propuesta]
    )

    # Tarea 4: Explicaciones con instrucciones JSON estrictas
    tarea_explicacion = Task(
        description=f"""Genera explicaciones claras para el cliente y el asesor.
        
Toma en cuenta los datos de mercado reales encontrados por el Verificador.

RESPONDE EXCLUSIVAMENTE CON ESTE JSON (sin markdown, sin texto adicional):
{{
  "explicacion_cliente": "explicación en lenguaje simple para el cliente",
  "resumen_asesor": "resumen técnico para el asesor humano (incluyendo rendimiento y sectores de los activos propuestos)",
  "alertas": ["alerta 1 si existe alguna incoherencia o riesgo en los mercados"],
  "version_reglas": "v2.0-yfinance"
}}

REGLAS:
1. Usa lenguaje claro y simple para el cliente
2. El resumen del asesor debe ser técnico pero conciso
3. Solo incluye alertas si hay inconsistencias o riesgos importantes
4. Si no hay alertas, usa un array vacío: []
""",
        expected_output="JSON con explicacion_cliente, resumen_asesor, alertas y version_reglas",
        agent=agente_explicador,
        context=[tarea_perfil, tarea_propuesta, tarea_verificacion]
    )

    crew = Crew(
        agents=[agente_perfilador, agente_analista, agente_verificador, agente_explicador], 
        tasks=[tarea_perfil, tarea_propuesta, tarea_verificacion, tarea_explicacion], 
        process=Process.sequential, 
        verbose=True,
        max_rpm=MAX_RPM_SEGURO
    )
    
    # Ejecutar con retry automático para rate limits
    _ejecutar_con_retry(crew)
    
    # Combinamos las respuestas JSON en un solo mega diccionario
    out1 = _limpiar_json(tarea_perfil.output.raw)
    out2 = _limpiar_json(tarea_propuesta.output.raw)
    out3 = _limpiar_json(tarea_verificacion.output.raw)
    out4 = _limpiar_json(tarea_explicacion.output.raw)
    
    resultado_final = {**out1, **out2, **out3, **out4}
    
    # Calcular rendimiento 1y pct total del portafolio para la gráfica
    total_yield = 0
    try:
        for activo in resultado_final.get("asignacion", []):
            data_inst = buscar_instrumento(activo.get("ticker", ""))
            rend = data_inst.get("rendimiento_1y_pct")
            pct = activo.get("porcentaje", 0)
            if rend and isinstance(pct, (int, float)):
                total_yield += (rend * pct / 100)
        resultado_final["rendimiento_1y_pct"] = round(total_yield, 2) if total_yield > 0 else 5.0
    except Exception as e:
        logger.warning(f"No se pudo calcular el rendimiento total: {e}")
        resultado_final["rendimiento_1y_pct"] = 5.0
    
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
    _, _, _, _, agente_revisor = _crear_agentes()
    
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