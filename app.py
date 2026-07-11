import json
import os

os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

from flask import Flask, jsonify, render_template, request
import google.generativeai as genai

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None


try:
    from flask_cors import CORS
except ModuleNotFoundError:
    CORS = None


def cargar_env_local():
    if load_dotenv:
        load_dotenv()
        return

    if not os.path.exists(".env"):
        return

    with open(".env", encoding="utf-8") as archivo_env:
        for linea in archivo_env:
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, valor = linea.split("=", 1)
            os.environ.setdefault(clave.strip(), valor.strip())


cargar_env_local()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev_secret_key")
if CORS:
    CORS(app)

gemini_api_key = os.getenv("GEMINI_API_KEY")
if gemini_api_key:
    genai.configure(api_key=gemini_api_key)


CATALOGO_INVERSIONES = """
- Bonos del Estado (Riesgo Bajo, Proyección 4% anual)
- ETFs S&P 500 (Riesgo Medio, Proyección 8% anual)
- Acciones Tecnológicas y Cripto (Riesgo Alto, Proyección 15% anual)
- Fondo de Emergencia Líquido (Riesgo Muy Bajo, Proyección 2% anual)
"""

db_propuestas = {}


def limpiar_json_respuesta(texto):
    texto_limpio = texto.replace("```json", "").replace("```", "").strip()
    return json.loads(texto_limpio)


def obtener_modelo_gemini():
    if not gemini_api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en .env")
    return genai.GenerativeModel("gemini-1.5-flash")


def propuesta_mock(perfil="Balanceado"):
    perfiles = {
        "Conservador": [
            {"name": "Bonos grado inversión", "value": 55, "color": "#2563eb"},
            {"name": "Fondos monetarios", "value": 25, "color": "#38bdf8"},
            {"name": "ETF renta variable global", "value": 15, "color": "#10b981"},
            {"name": "Alternativos líquidos", "value": 5, "color": "#a7f3d0"},
        ],
        "Balanceado": [
            {"name": "Bonos grado inversión", "value": 40, "color": "#2563eb"},
            {"name": "ETF renta variable global", "value": 30, "color": "#10b981"},
            {"name": "Fondos monetarios", "value": 20, "color": "#38bdf8"},
            {"name": "Alternativos líquidos", "value": 10, "color": "#a7f3d0"},
        ],
        "Dinámico": [
            {"name": "ETF renta variable global", "value": 45, "color": "#10b981"},
            {"name": "Bonos grado inversión", "value": 25, "color": "#2563eb"},
            {"name": "Acciones tecnología", "value": 20, "color": "#38bdf8"},
            {"name": "Fondos monetarios", "value": 10, "color": "#a7f3d0"},
        ],
    }

    return {
        "label": "Proyección Histórica del Portafolio",
        "aiJustification": (
            "La IA sugiere una composición balanceada entre estabilidad, liquidez y crecimiento "
            "según el objetivo declarado. Esta propuesta queda pendiente de revisión por un asesor humano."
        ),
        "assets": perfiles.get(perfil, perfiles["Balanceado"]),
    }


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/chat_agente", methods=["POST"])
def chat_agente():
    datos = request.get_json(silent=True) or {}
    mensaje_usuario = datos.get("mensaje", "")
    historial = datos.get("historial", [])

    if not mensaje_usuario:
        return jsonify({"error": "El campo 'mensaje' es obligatorio."}), 400

    prompt_sistema = f"""
    Eres un Asesor Financiero IA experto. Tu objetivo es perfilar al usuario y recomendarle un portafolio.
    El usuario te dirá su meta. Si no tienes claro su horizonte de tiempo o tolerancia al riesgo,
    debes hacerle UNA SOLA pregunta de opción múltiple para averiguarlo.

    REGLA ESTRICTA: Tu respuesta debe ser ÚNICAMENTE un objeto JSON válido.

    SI NECESITAS MÁS INFORMACIÓN, responde con este formato JSON:
    {{"estado": "preguntando", "pregunta": "Tu pregunta aquí", "opciones": ["Opción A", "Opción B", "Opción C"]}}

    SI YA TIENES TODA LA INFORMACIÓN, usa este catálogo para armar una propuesta:
    {CATALOGO_INVERSIONES}

    Responde con este formato JSON final:
    {{"estado": "completado", "perfil": "Conservador/Moderado/Agresivo", "distribucion": {{"Bonos": 60, "ETFs": 40}}, "proyeccion_anual": "6%", "justificacion": "Explicación clara..."}}
    """

    contexto_completo = f"{prompt_sistema}\nHistorial:\n{historial}\nUsuario: {mensaje_usuario}"

    try:
        respuesta = obtener_modelo_gemini().generate_content(contexto_completo)
        return jsonify(limpiar_json_respuesta(respuesta.text))
    except Exception as exc:
        return jsonify({"error": "No se pudo generar respuesta IA.", "detalle": str(exc)}), 500


@app.route("/api/question", methods=["POST"])
def generar_pregunta():
    datos = request.get_json(silent=True) or {}
    meta = datos.get("goalText") or datos.get("mensaje", "")

    if not meta:
        return jsonify({"error": "El campo 'goalText' es obligatorio."}), 400

    prompt = f"""
    Genera UNA pregunta de opción múltiple para perfilar riesgo de inversión.
    Meta del usuario: {meta}

    Responde únicamente JSON válido con este formato:
    {{
      "title": "Pregunta principal",
      "subtitle": "Texto breve de apoyo",
      "options": [
        {{"id": "conservative", "label": "Opción conservadora", "riskProfile": "Conservador"}},
        {{"id": "balanced", "label": "Opción balanceada", "riskProfile": "Balanceado"}},
        {{"id": "dynamic", "label": "Opción dinámica", "riskProfile": "Dinámico"}}
      ]
    }}
    """

    try:
        respuesta = obtener_modelo_gemini().generate_content(prompt)
        return jsonify(limpiar_json_respuesta(respuesta.text))
    except Exception:
        return jsonify(
            {
                "title": "Para afinar la propuesta, necesito entender tu tolerancia al movimiento del mercado.",
                "subtitle": "Si el portafolio baja temporalmente, ¿qué opción se parece más a ti?",
                "options": [
                    {
                        "id": "conservative",
                        "label": "Prefiero estabilidad, aunque el crecimiento sea menor",
                        "riskProfile": "Conservador",
                    },
                    {
                        "id": "balanced",
                        "label": "Acepto variaciones moderadas si la meta sigue clara",
                        "riskProfile": "Balanceado",
                    },
                    {
                        "id": "dynamic",
                        "label": "Puedo tolerar más movimiento por mayor potencial",
                        "riskProfile": "Dinámico",
                    },
                ],
            }
        )


@app.route("/api/proposal", methods=["POST"])
def generar_propuesta():
    datos = request.get_json(silent=True) or {}
    respuesta_perfil = datos.get("answer", "balanced")
    perfil = {
        "conservative": "Conservador",
        "balanced": "Balanceado",
        "dynamic": "Dinámico",
    }.get(respuesta_perfil, "Balanceado")

    return jsonify(propuesta_mock(perfil))


@app.route("/api/guardar_para_asesor", methods=["POST"])
@app.route("/api/advisor-review", methods=["POST"])
def guardar_propuesta():
    propuesta = request.get_json(silent=True) or {}
    id_propuesta = str(len(db_propuestas) + 1)
    propuesta["estado"] = "Pendiente de Revisión"
    db_propuestas[id_propuesta] = propuesta
    return jsonify({"status": "ok", "id": id_propuesta})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
