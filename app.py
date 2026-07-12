import os
import json
import uuid
import hashlib
from datetime import datetime, timezone
from functools import wraps

os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    session,
    redirect,
    url_for,
    abort,
)

try:
    from dotenv import load_dotenv
    load_dotenv = load_dotenv
except ModuleNotFoundError:
    load_dotenv = None

try:
    from flask_cors import CORS
except ModuleNotFoundError:
    CORS = None

from agents.crew import run_crew, run_revisor

# ─── CARGA DE VARIABLES DE ENTORNO ──────────────────────────────
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
app.secret_key = os.getenv("FLASK_SECRET_KEY", "cyber_inductance_secret_2025")
if CORS:
    CORS(app)

# ─── CONFIGURACIÓN DEL SISTEMA ──────────────────────────────────
VERSION_CATALOGO = "v2.0"
MODELO_IA = "gpt-4o-mini"

ASESORES_AUTORIZADOS = {
    "admin": {
        "password": "admin123",
        "nombre": "Carlos Méndez",
        "cargo": "Asesor Financiero Senior",
    },
    "asesor": {
        "password": "asesor123",
        "nombre": "Ana Torres",
        "cargo": "Analista de Riesgo",
    },
}


# ─── BASES DE DATOS EN MEMORIA ──────────────────────────────────
db_propuestas = {}
db_auditoria = []


# ─── FUNCIONES UTILITARIAS ──────────────────────────────────────
def generar_firma(propuesta_json):
    """Genera un hash SHA-256 del JSON de la propuesta como firma digital."""
    contenido = json.dumps(propuesta_json, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(contenido.encode("utf-8")).hexdigest()[:16]


def timestamp_ahora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def requiere_login_asesor(f):
    """Decorator para proteger rutas del asesor."""
    @wraps(f)
    def decorada(*args, **kwargs):
        if "asesor_usuario" not in session:
            return redirect(url_for("login_asesor"))
        return f(*args, **kwargs)
    return decorada


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


# ─── SEED DE DATOS DEMO ─────────────────────────────────────────
def seed_propuestas_demo():
    """Crea propuestas de ejemplo para demostración del hackathon."""
    demos = [
        {
            "meta_usuario": "Quiero comprar una moto en 6 meses, puedo aportar $200 al mes",
            "perfil_ia": "Balanceado",
            "respuesta_perfil": "balanced",
            "proyeccion_anual": "~6%",
        },
        {
            "meta_usuario": "Necesito un fondo de emergencia de $5,000 en 1 año",
            "perfil_ia": "Conservador",
            "respuesta_perfil": "conservative",
            "proyeccion_anual": "~4%",
        },
    ]

    for i, demo in enumerate(demos, 1):
        id_prop = str(i).zfill(4)
        portafolio = propuesta_mock(demo["perfil_ia"])

        db_propuestas[id_prop] = {
            "id": id_prop,
            "goal": demo["meta_usuario"],
            "perfil_ia": demo["perfil_ia"],
            "respuestas": demo["respuesta_perfil"],
            "proyeccion_anual": demo["proyeccion_anual"],
            "datos": {
                "asignacion": portafolio["assets"],
                "justificacion": portafolio["aiJustification"],
                "explicacion_cliente": "Ejemplo de explicación al cliente.",
                "resumen_asesor": "Resumen técnico para el asesor.",
                "alertas": ["Ejemplo de alerta"],
            },
            "estado": "pendiente",
            "fecha_creacion": f"2025-07-11T{10 + i}:{15 + i * 7 % 60:02d}:00Z",
            "version_reglas": VERSION_CATALOGO,
            "modelo_ia": MODELO_IA,
        }

    # Marcar una como aprobada para variedad en la demo
    db_propuestas["0002"]["estado"] = "aprobada"
    db_auditoria.append(
        {
            "id_propuesta": "0002",
            "accion": "aprobada",
            "asesor": "Ana Torres",
            "cargo": "Analista de Riesgo",
            "timestamp": "2025-07-11T14:22:00Z",
            "firma_id": generar_firma(db_propuestas["0002"]),
            "version_reglas": VERSION_CATALOGO,
            "nota": "Propuesta revisada. Perfil conservador adecuado para fondo de emergencia.",
        }
    )

seed_propuestas_demo()


# ═══════════════════════════════════════════════════════════════
# RUTA PRINCIPAL
# ═══════════════════════════════════════════════════════════════

@app.route("/")
def home():
    """Página principal — flujo del cliente."""
    return render_template("index.html")


# ─────────────────────────────────────────────────────────────────────────────
# API — FLUJO DEL CLIENTE (Agentes 1, 2 y 3)
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/analizar", methods=["POST"])
def analizar():
    """
    Recibe la meta y el cuestionario de riesgo del cliente.
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
        "estado": "pendiente",
        "datos": resultado,
        "log": None,
        "fecha_creacion": timestamp_ahora(),
        "version_reglas": VERSION_CATALOGO,
        "modelo_ia": MODELO_IA,
    }

    return jsonify({"id": id_propuesta, **resultado})


# ═══════════════════════════════════════════════════════════════
# RUTAS DEL ASESOR — VISTAS HTML
# ═══════════════════════════════════════════════════════════════

@app.route("/asesor/login", methods=["GET", "POST"])
def login_asesor():
    if request.method == "GET":
        if "asesor_usuario" in session:
            return redirect(url_for("dashboard_asesor"))
        return render_template("login_asesor.html", error=None)

    usuario = request.form.get("usuario", "").strip()
    password = request.form.get("password", "").strip()

    asesor = ASESORES_AUTORIZADOS.get(usuario)
    if not asesor or asesor["password"] != password:
        return render_template("login_asesor.html", error="Credenciales inválidas")

    session["asesor_usuario"] = usuario
    session["asesor_nombre"] = asesor["nombre"]
    session["asesor_cargo"] = asesor["cargo"]
    return redirect(url_for("dashboard_asesor"))


@app.route("/asesor/logout")
def logout_asesor():
    session.clear()
    return redirect(url_for("login_asesor"))


@app.route("/asesor/dashboard")
@requiere_login_asesor
def dashboard_asesor():
    return render_template(
        "dashboard_asesor.html",
        asesor_nombre=session["asesor_nombre"],
        asesor_cargo=session["asesor_cargo"],
    )


@app.route("/asesor/propuesta/<id_propuesta>")
@requiere_login_asesor
def vista_detalle_propuesta(id_propuesta):
    propuesta = db_propuestas.get(id_propuesta)
    if not propuesta:
        abort(404)
    return render_template(
        "detalle_propuesta.html",
        propuesta=propuesta,
        asesor_nombre=session["asesor_nombre"],
        asesor_cargo=session["asesor_cargo"],
    )


# ═══════════════════════════════════════════════════════════════
# API DEL ASESOR — JSON (Con Agente 4 Integrado)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/asesor/propuestas")
@requiere_login_asesor
def api_listar_propuestas():
    filtro_estado = request.args.get("estado", "todos")
    propuestas = list(db_propuestas.values())

    if filtro_estado != "todos":
        propuestas = [p for p in propuestas if p.get("estado", "").lower() == filtro_estado.lower()]

    propuestas.sort(key=lambda p: p.get("fecha_creacion", ""), reverse=True)

    total = len(db_propuestas)
    pendientes = sum(1 for p in db_propuestas.values() if p.get("estado", "").lower() == "pendiente")
    aprobadas = sum(1 for p in db_propuestas.values() if p.get("estado", "").lower() == "aprobada")
    rechazadas = sum(1 for p in db_propuestas.values() if p.get("estado", "").lower() == "rechazada")

    return jsonify(
        {
            "propuestas": propuestas,
            "stats": {
                "total": total,
                "pendientes": pendientes,
                "aprobadas": aprobadas,
                "rechazadas": rechazadas,
            },
        }
    )


@app.route("/api/asesor/propuesta/<id_propuesta>")
@requiere_login_asesor
def api_detalle_propuesta(id_propuesta):
    propuesta = db_propuestas.get(id_propuesta)
    if not propuesta:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    historial = [
        log for log in db_auditoria if log["id_propuesta"] == id_propuesta
    ]
    return jsonify({"propuesta": propuesta, "historial": historial})


@app.route("/api/asesor/aprobar", methods=["POST"])
@requiere_login_asesor
def api_aprobar_propuesta():
    datos = request.get_json(silent=True) or {}
    id_propuesta = datos.get("id_propuesta")
    nota = datos.get("nota", "")

    propuesta = db_propuestas.get(id_propuesta)
    if not propuesta:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    if propuesta.get("estado") != "pendiente":
        return jsonify({"error": "Solo se pueden aprobar propuestas pendientes"}), 400

    propuesta["estado"] = "aprobada"
    firma = generar_firma(propuesta)

    # Inyección de Agente 4 (Revisor)
    try:
        log_ia = run_revisor(
            propuesta.get("datos", {}),
            "Aprobada",
            session["asesor_nombre"],
            nota
        )
    except Exception:
        log_ia = None

    registro = {
        "id_propuesta": id_propuesta,
        "accion": "aprobada",
        "asesor": session["asesor_nombre"],
        "cargo": session["asesor_cargo"],
        "timestamp": timestamp_ahora(),
        "firma_id": firma,
        "version_reglas": VERSION_CATALOGO,
        "nota": nota or "Propuesta revisada y aprobada sin observaciones.",
        "log_ia": log_ia
    }
    db_auditoria.append(registro)
    propuesta["log"] = log_ia or registro

    return jsonify({"status": "ok", "registro": registro})


@app.route("/api/asesor/rechazar", methods=["POST"])
@requiere_login_asesor
def api_rechazar_propuesta():
    datos = request.get_json(silent=True) or {}
    id_propuesta = datos.get("id_propuesta")
    motivo = datos.get("motivo", "")
    nota = datos.get("nota", "")

    propuesta = db_propuestas.get(id_propuesta)
    if not propuesta:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    if propuesta.get("estado") != "pendiente":
        return jsonify({"error": "Solo se pueden rechazar propuestas pendientes"}), 400

    if not nota or len(nota) < 20:
        return jsonify({"error": "La nota de corrección debe tener al menos 20 caracteres"}), 400

    propuesta["estado"] = "rechazada"
    firma = generar_firma(propuesta)

    # Inyección de Agente 4 (Revisor)
    try:
        log_ia = run_revisor(
            propuesta.get("datos", {}),
            "Rechazada",
            session["asesor_nombre"],
            f"[{motivo}] {nota}"
        )
    except Exception:
        log_ia = None

    registro = {
        "id_propuesta": id_propuesta,
        "accion": "rechazada",
        "asesor": session["asesor_nombre"],
        "cargo": session["asesor_cargo"],
        "timestamp": timestamp_ahora(),
        "firma_id": firma,
        "version_reglas": VERSION_CATALOGO,
        "motivo": motivo,
        "nota": nota,
        "log_ia": log_ia
    }
    db_auditoria.append(registro)
    propuesta["log"] = log_ia or registro

    return jsonify({"status": "ok", "registro": registro})


@app.route("/api/asesor/auditoria")
@requiere_login_asesor
def api_log_auditoria():
    return jsonify({"log": list(reversed(db_auditoria))})


# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
