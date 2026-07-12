import os
import uuid
import hashlib
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from dotenv import load_dotenv

# Importamos las funciones adaptadas de CrewAI
from agents.crew import run_crew_completo, registrar_auditoria

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "super_secreta_hackathon_2026")

# ═══════════════════════════════════════════════════════════════════════════════
# BASE DE DATOS SIMULADA EN MEMORIA
# ═══════════════════════════════════════════════════════════════════════════════
db_propuestas = {}

# Usuarios de demo para el login del asesor
USUARIOS_DEMO = {
    "admin": {
        "password": "admin123",
        "nombre": "Administrador General",
        "cargo": "Gerente de Inversiones",
    },
    "asesor": {
        "password": "asesor123",
        "nombre": "Carlos Méndez",
        "cargo": "Asesor Senior de Inversiones",
    },
}


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def generar_firma_digital(data_str: str) -> str:
    """Genera una firma SHA-256 simulada para auditoría."""
    return hashlib.sha256(data_str.encode()).hexdigest()[:16].upper()


def propuesta_a_dict_asesor(id_prop: str, prop: dict) -> dict:
    """Convierte una propuesta interna al formato que esperan los JS del asesor."""
    detalles = prop.get("detalles", {})
    return {
        "id": id_prop,
        "estado": prop.get("estado_interno", "pendiente"),
        "meta_usuario": prop.get("goal", ""),
        "goal": prop.get("goal", ""),
        "perfil_ia": detalles.get("perfil", "N/A"),
        "score": detalles.get("score"),
        "fecha_creacion": prop.get("fecha_creacion", ""),
        "version_reglas": detalles.get("version_reglas", "v1.0"),
        "modelo_ia": "gemini-3.5-flash",
        "proyeccion_anual": detalles.get("riesgo", "—"),
        "aiJustification": detalles.get("justificacion", ""),
        "resumen_asesor": detalles.get("resumen_asesor", ""),
        "explicacion_cliente": detalles.get("explicacion_cliente", ""),
        "disclaimer": detalles.get("disclaimer", ""),
        "alertas": detalles.get("alertas", []),
        "reglas_usadas": detalles.get("reglas_usadas", []),
        "assets": [
            {
                "name": a.get("nombre", ""),
                "value": a.get("porcentaje", 0),
                "color": a.get("color", "#2563eb"),
            }
            for a in detalles.get("asignacion", [])
        ],
        # Campos para asesor.html (standalone)
        "datos": detalles,
        "log": prop.get("log"),
        "creado_en": prop.get("fecha_creacion", ""),
    }


def login_requerido(f):
    """Decorador para proteger rutas del asesor."""
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "asesor_usuario" not in session:
            return redirect(url_for("asesor_login"))
        return f(*args, **kwargs)

    return decorated_function


# ═══════════════════════════════════════════════════════════════════════════════
# RUTAS DEL CLIENTE / INVERSIONISTA
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/analizar', methods=['POST'])
def api_analizar():
    """Ejecuta los 3 agentes IA en cadena y guarda la propuesta."""
    data = request.json
    goal_text = data.get('goalText', '')
    answers = data.get('answers', {})

    try:
        # Ejecutamos los 3 agentes en cadena para obtener el JSON
        resultado_json = run_crew_completo(goal_text, answers)

        # Guardamos en la "Base de Datos"
        id_propuesta = str(uuid.uuid4())[:8]
        db_propuestas[id_propuesta] = {
            "id": id_propuesta,
            "perfil": resultado_json.get('perfil', 'Desconocido'),
            "estado": "Pendiente",
            "estado_interno": "pendiente",
            "detalles": resultado_json,
            "goal": goal_text,
            "fecha_creacion": datetime.now().isoformat(),
            "log": None,
            "historial": [],
        }

        # Le inyectamos el ID al resultado para que el frontend lo muestre
        resultado_json["id"] = id_propuesta

        return jsonify(resultado_json)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════════
# RUTAS DE AUTENTICACIÓN DEL ASESOR
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/asesor/login', methods=['GET', 'POST'])
def asesor_login():
    """Página de login para el asesor/gerente."""
    error = None

    if request.method == 'POST':
        usuario = request.form.get('usuario', '').strip()
        password = request.form.get('password', '').strip()

        if usuario in USUARIOS_DEMO and USUARIOS_DEMO[usuario]["password"] == password:
            session["asesor_usuario"] = usuario
            session["asesor_nombre"] = USUARIOS_DEMO[usuario]["nombre"]
            session["asesor_cargo"] = USUARIOS_DEMO[usuario]["cargo"]
            return redirect(url_for("asesor_dashboard"))
        else:
            error = "Usuario o contraseña incorrectos"

    return render_template('login_asesor.html', error=error)


@app.route('/asesor/logout')
def asesor_logout():
    """Cierra sesión del asesor."""
    session.pop("asesor_usuario", None)
    session.pop("asesor_nombre", None)
    session.pop("asesor_cargo", None)
    return redirect(url_for("asesor_login"))


# ═══════════════════════════════════════════════════════════════════════════════
# RUTAS DEL PANEL DEL ASESOR (requieren sesión)
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/asesor')
def panel_asesor_standalone():
    """asesor.html — Panel standalone con JS inline (no requiere login)."""
    return render_template('asesor.html')


@app.route('/asesor/dashboard')
@login_requerido
def asesor_dashboard():
    """dashboard_asesor.html — Dashboard con login requerido."""
    return render_template(
        'dashboard_asesor.html',
        propuestas=db_propuestas.values(),
        asesor_nombre=session.get("asesor_nombre", "Asesor"),
        asesor_cargo=session.get("asesor_cargo", "Asesor de Inversiones"),
    )


@app.route('/asesor/propuesta/<id_propuesta>')
@login_requerido
def detalle_propuesta(id_propuesta):
    """detalle_propuesta.html — Vista detallada de una propuesta."""
    if id_propuesta not in db_propuestas:
        return redirect(url_for("asesor_dashboard"))

    prop = db_propuestas[id_propuesta]
    propuesta_view = {
        "id": id_propuesta,
        "estado": prop.get("estado_interno", "pendiente"),
    }

    return render_template(
        'detalle_propuesta.html',
        propuesta=propuesta_view,
        asesor_nombre=session.get("asesor_nombre", "Asesor"),
        asesor_cargo=session.get("asesor_cargo", "Asesor de Inversiones"),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# APIs DEL ASESOR
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/propuestas')
def api_propuestas_simple():
    """API para asesor.html standalone — devuelve array de propuestas."""
    propuestas_list = []
    for id_prop, prop in db_propuestas.items():
        p = propuesta_a_dict_asesor(id_prop, prop)
        # Mapear estado_interno al formato que espera asesor.html standalone
        estado_map = {"pendiente": "Pendiente", "aprobada": "Aprobado", "rechazada": "Rechazado"}
        p["estado"] = estado_map.get(prop.get("estado_interno", "pendiente"), prop.get("estado", "Pendiente"))
        propuestas_list.append(p)

    return jsonify(propuestas_list)


@app.route('/api/asesor/propuestas')
def api_asesor_propuestas():
    """API para dashboard_asesor.html — devuelve propuestas con stats y filtro."""
    filtro_estado = request.args.get('estado', 'todos')

    propuestas_list = []
    stats = {"pendientes": 0, "aprobadas": 0, "rechazadas": 0, "total": 0}

    for id_prop, prop in db_propuestas.items():
        estado = prop.get("estado_interno", "pendiente")

        # Contar stats
        stats["total"] += 1
        if estado == "pendiente":
            stats["pendientes"] += 1
        elif estado == "aprobada":
            stats["aprobadas"] += 1
        elif estado == "rechazada":
            stats["rechazadas"] += 1

        # Filtrar si es necesario
        if filtro_estado != "todos" and estado != filtro_estado:
            continue

        propuestas_list.append(propuesta_a_dict_asesor(id_prop, prop))

    return jsonify({"propuestas": propuestas_list, "stats": stats})


@app.route('/api/asesor/propuesta/<id_propuesta>')
def api_asesor_propuesta_detalle(id_propuesta):
    """API para detalle_propuesta.html — devuelve detalle de una propuesta."""
    if id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    prop = db_propuestas[id_propuesta]
    propuesta_data = propuesta_a_dict_asesor(id_propuesta, prop)

    return jsonify({
        "propuesta": propuesta_data,
        "historial": prop.get("historial", []),
    })


@app.route('/api/asesor/accion/<id_propuesta>', methods=['POST'])
def api_asesor_accion(id_propuesta):
    """API para asesor.html standalone — aprobar/rechazar/editar una propuesta."""
    if id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    data = request.json
    accion = data.get("accion", "")
    asesor_nombre = data.get("asesor_nombre", "Asesor")
    observaciones = data.get("observaciones", "")

    prop = db_propuestas[id_propuesta]

    # Mapear acción al estado interno
    estado_map = {
        "Aprobado": "aprobada",
        "Rechazado": "rechazada",
        "Editado y Aprobado": "aprobada",
    }
    prop["estado_interno"] = estado_map.get(accion, "pendiente")
    prop["estado"] = accion

    # Generar firma digital simulada
    firma_data = f"{asesor_nombre}-{accion}-{datetime.now().isoformat()}"
    firma = generar_firma_digital(firma_data)

    # Registrar en historial de auditoría
    log_entry = {
        "fecha": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "timestamp": datetime.now().isoformat(),
        "responsable": asesor_nombre,
        "asesor": asesor_nombre,
        "cargo": "Asesor",
        "accion": accion,
        "version_reglas": "v1.0 Q3-2026",
        "observaciones": observaciones or "Sin observaciones",
        "nota": observaciones,
        "firma_id": firma,
    }
    prop["log"] = log_entry
    prop.setdefault("historial", []).append(log_entry)

    return jsonify({"ok": True, "estado": accion, "log": log_entry})


@app.route('/api/asesor/aprobar', methods=['POST'])
def api_asesor_aprobar():
    """API para detalle_propuesta.html — aprobar propuesta con modal."""
    data = request.json
    id_propuesta = data.get("id_propuesta", "")
    nota = data.get("nota", "")

    if id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    prop = db_propuestas[id_propuesta]
    if prop.get("estado_interno") != "pendiente":
        return jsonify({"error": "La propuesta ya fue procesada"}), 400

    asesor_nombre = session.get("asesor_nombre", "Asesor")
    asesor_cargo = session.get("asesor_cargo", "Asesor de Inversiones")

    # Actualizar estado
    prop["estado_interno"] = "aprobada"
    prop["estado"] = "Aprobada"

    # Generar firma digital
    firma_data = f"{asesor_nombre}-aprobar-{datetime.now().isoformat()}"
    firma = generar_firma_digital(firma_data)

    # Registrar auditoría
    log_entry = {
        "fecha": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "timestamp": datetime.now().isoformat(),
        "responsable": asesor_nombre,
        "asesor": asesor_nombre,
        "cargo": asesor_cargo,
        "accion": "aprobada",
        "version_reglas": "v1.0 Q3-2026",
        "observaciones": nota or "Sin observaciones",
        "nota": nota,
        "firma_id": firma,
    }
    prop["log"] = log_entry
    prop.setdefault("historial", []).append(log_entry)

    return jsonify({"ok": True, "log": log_entry})


@app.route('/api/asesor/rechazar', methods=['POST'])
def api_asesor_rechazar():
    """API para detalle_propuesta.html — rechazar propuesta con modal."""
    data = request.json
    id_propuesta = data.get("id_propuesta", "")
    motivo = data.get("motivo", "")
    nota = data.get("nota", "")

    if id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404

    prop = db_propuestas[id_propuesta]
    if prop.get("estado_interno") != "pendiente":
        return jsonify({"error": "La propuesta ya fue procesada"}), 400

    if len(nota) < 20:
        return jsonify({"error": "La nota debe tener al menos 20 caracteres"}), 400

    asesor_nombre = session.get("asesor_nombre", "Asesor")
    asesor_cargo = session.get("asesor_cargo", "Asesor de Inversiones")

    # Actualizar estado
    prop["estado_interno"] = "rechazada"
    prop["estado"] = "Rechazada"

    # Generar firma digital
    firma_data = f"{asesor_nombre}-rechazar-{datetime.now().isoformat()}"
    firma = generar_firma_digital(firma_data)

    # Registrar auditoría
    nota_completa = f"Motivo: {motivo}. {nota}" if motivo else nota
    log_entry = {
        "fecha": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "timestamp": datetime.now().isoformat(),
        "responsable": asesor_nombre,
        "asesor": asesor_nombre,
        "cargo": asesor_cargo,
        "accion": "rechazada",
        "version_reglas": "v1.0 Q3-2026",
        "observaciones": nota_completa,
        "nota": nota_completa,
        "firma_id": firma,
    }
    prop["log"] = log_entry
    prop.setdefault("historial", []).append(log_entry)

    return jsonify({"ok": True, "log": log_entry})


# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    app.run(debug=True)