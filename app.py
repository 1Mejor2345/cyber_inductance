"""
app.py — Flask routes del sistema Robo-Advisor multi-agente.
Delega toda la lógica de IA al módulo agents/crew.py.
"""

import os
import uuid
from datetime import datetime

os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

from flask import Flask, jsonify, render_template, request

try:
    from dotenv import load_dotenv
    load_dotenv()
except ModuleNotFoundError:
    pass

try:
    from flask_cors import CORS
except ModuleNotFoundError:
    CORS = None

from agents.crew import run_crew, run_revisor

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURACIÓN DE LA APP
# ─────────────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev_secret_key")

if CORS:
    CORS(app)

# Base de datos en memoria (suficiente para el Hackathon)
db_propuestas = {}


# ─────────────────────────────────────────────────────────────────────────────
# PÁGINAS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def home():
    """Página principal — flujo del cliente."""
    return render_template("index.html")


@app.route("/asesor")
def panel_asesor():
    """Panel del asesor humano — revisión de propuestas."""
    return render_template("asesor.html")


# ─────────────────────────────────────────────────────────────────────────────
# API — FLUJO DEL CLIENTE (Agentes 1, 2 y 3)
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/analizar", methods=["POST"])
def analizar():
    """
    Recibe la meta e inclinación de riesgo del cliente.
    Ejecuta la cadena de 3 agentes y guarda la propuesta resultante.
    Devuelve el resultado completo con el ID asignado.
    """
    datos = request.get_json(silent=True) or {}
    goal_text = datos.get("goalText", "").strip()
    answers = datos.get("answers", {})

    if not goal_text:
        return jsonify({"error": "El campo 'goalText' es obligatorio."}), 400

    try:
        resultado = run_crew(goal_text, answers)
    except Exception as exc:
        return jsonify({
            "error": "Error al ejecutar los agentes de IA.",
            "detalle": str(exc),
        }), 500

    id_propuesta = str(uuid.uuid4())[:8]
    db_propuestas[id_propuesta] = {
        "id": id_propuesta,
        "goal": goal_text,
        "respuestas": answers,
        "estado": "Pendiente",
        "datos": resultado,
        "log": None,
        "creado_en": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    return jsonify({"id": id_propuesta, **resultado})


# ─────────────────────────────────────────────────────────────────────────────
# API — PANEL DEL ASESOR (Agente 4)
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/propuestas", methods=["GET"])
def get_propuestas():
    """Devuelve todas las propuestas guardadas para el panel del asesor."""
    return jsonify(list(db_propuestas.values()))


@app.route("/api/asesor/accion/<id>", methods=["POST"])
def accion_asesor(id):
    """
    Registra la decisión del asesor (Aprobado / Editado y Aprobado / Rechazado).
    Activa el Agente 4 (Revisor) para generar el log de auditoría.
    """
    if id not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada."}), 404

    datos = request.get_json(silent=True) or {}
    accion = datos.get("accion", "").strip()
    asesor_nombre = datos.get("asesor_nombre", "Asesor Anónimo").strip()
    observaciones = datos.get("observaciones", "").strip()

    if not accion:
        return jsonify({"error": "El campo 'accion' es obligatorio."}), 400

    # Agente 4: genera el log de auditoría
    try:
        log = run_revisor(
            db_propuestas[id]["datos"],
            accion,
            asesor_nombre,
            observaciones,
        )
    except Exception:
        # Fallback determinístico si el agente falla
        log = {
            "fecha": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "responsable": asesor_nombre,
            "accion": accion,
            "version_reglas": db_propuestas[id]["datos"].get(
                "version_reglas", "v1.0 - Catálogo Q3-2026"
            ),
            "observaciones": observaciones or "Sin observaciones",
        }

    db_propuestas[id]["estado"] = accion
    db_propuestas[id]["log"] = log

    return jsonify({"status": "ok", "log": log})


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
