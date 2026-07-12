import os
import uuid
import hashlib
import logging
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from dotenv import load_dotenv

# Importamos las funciones adaptadas de CrewAI
from agents.crew import run_crew_completo, registrar_auditoria

load_dotenv()

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "super_secreta_hackathon_2026")

# ═══════════════════════════════════════════════════════════════════════════════
# BASE DE DATOS SIMULADA EN MEMORIA
# ═══════════════════════════════════════════════════════════════════════════════
db_propuestas = {}

# COLA FIFO DE PROPUESTAS PENDIENTES (MAX 5)
# Lista que mantiene orden de llegada (First In, First Out)
propuestas_pendientes = []
MAX_COLA = 5

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

# Usuarios de demo para el login del CLIENTE
CLIENTES_DEMO = {
    "cliente_demo": {
        "password": "1234",
        "nombre": "Cliente Demo",
        "email": "cliente@demo.com",
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


@app.route('/api/login_cliente', methods=['POST'])
def api_login_cliente():
    """
    Endpoint de autenticación para el cliente final.
    
    Valida credenciales de demo y devuelve éxito o error.
    """
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    
    # Validación básica
    if not username or not password:
        return jsonify({
            "success": False,
            "error": "Usuario y contraseña son requeridos"
        }), 400
    
    # Verificar credenciales
    if username in CLIENTES_DEMO:
        cliente = CLIENTES_DEMO[username]
        if cliente["password"] == password:
            # Login exitoso
            return jsonify({
                "success": True,
                "nombre": cliente["nombre"],
                "email": cliente.get("email", ""),
                "mensaje": "Inicio de sesión exitoso"
            }), 200
    
    # Credenciales incorrectas
    return jsonify({
        "success": False,
        "error": "Usuario o contraseña incorrectos"
    }), 401


@app.route('/api/analizar', methods=['POST'])
def api_analizar():
    """Ejecuta los 3 agentes IA en cadena y guarda la propuesta."""
    data = request.json
    goal_text = data.get('goalText', '')
    answers = data.get('answers', {})
    slider_adjustments = data.get('sliderAdjustments')
    
    if slider_adjustments:
        answers['AJUSTES_MANUALES_DEL_USUARIO'] = slider_adjustments

    try:
        # Ejecutamos los 3 agentes en cadena para obtener el JSON
        resultado_json = run_crew_completo(goal_text, answers)

        # Guardamos en la "Base de Datos"
        id_propuesta = str(uuid.uuid4())[:8]
        db_propuestas[id_propuesta] = {
            "id": id_propuesta,
            "perfil": resultado_json.get('perfil', 'Desconocido'),
            "estado": "Generada",
            "estado_interno": "generada",  # Estado inicial antes de enviar
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


@app.route('/api/enviar_propuesta', methods=['POST'])
def api_enviar_propuesta():
    """
    Endpoint para enviar una propuesta a la cola de asesores.
    
    VALIDACIÓN ESTRICTA: Máximo 5 propuestas en cola.
    Si está llena, devuelve HTTP 429 (Too Many Requests).
    
    ACTUALIZACIÓN: Vincula propuesta al usuario actual.
    """
    data = request.json
    id_propuesta = data.get('id_propuesta', '')
    usuario_cliente = data.get('usuario', 'cliente_demo')  # Usuario actual
    
    if not id_propuesta or id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404
    
    # VALIDACIÓN CRÍTICA: Verificar límite de cola
    if len(propuestas_pendientes) >= MAX_COLA:
        return jsonify({
            "error": "La cola de asesores está llena (Máx 5). Intente en unos minutos.",
            "cola_llena": True,
            "posiciones_disponibles": 0
        }), 429
    
    propuesta = db_propuestas[id_propuesta]
    
    # Verificar que no esté ya en cola
    if id_propuesta in propuestas_pendientes:
        return jsonify({"error": "Esta propuesta ya está en la cola"}), 400
    
    # Agregar al FINAL de la cola (FIFO)
    propuestas_pendientes.append(id_propuesta)
    
    # Actualizar estado y vincular al usuario
    propuesta["estado_interno"] = "pendiente"
    propuesta["estado"] = "Pendiente"
    propuesta["estado_revision"] = "Pendiente"  # NUEVO: Estado específico para cliente
    propuesta["usuario_cliente"] = usuario_cliente  # NUEVO: Vinculación
    propuesta["fecha_envio"] = datetime.now().isoformat()
    propuesta["posicion_cola"] = len(propuestas_pendientes)
    
    return jsonify({
        "ok": True,
        "mensaje": "Propuesta enviada a revisión exitosamente",
        "id": id_propuesta,
        "posicion_en_cola": len(propuestas_pendientes),
        "total_en_cola": len(propuestas_pendientes)
    }), 200


@app.route('/api/propuestas', methods=['GET'])
def api_obtener_propuestas_cola():
    """
    Devuelve la lista de propuestas en cola ORDENADAS por llegada (FIFO).
    Primera en entrar = Primera en salir.
    """
    propuestas_ordenadas = []
    
    for idx, id_prop in enumerate(propuestas_pendientes):
        if id_prop in db_propuestas:
            prop = db_propuestas[id_prop]
            propuesta_dict = propuesta_a_dict_asesor(id_prop, prop)
            propuesta_dict["posicion_cola"] = idx + 1  # 1-indexed para mostrar
            propuestas_ordenadas.append(propuesta_dict)
    
    return jsonify({
        "propuestas": propuestas_ordenadas,
        "total": len(propuestas_ordenadas),
        "capacidad_maxima": MAX_COLA,
        "espacios_disponibles": MAX_COLA - len(propuestas_ordenadas)
    })


@app.route('/api/resolver_propuesta/<id_propuesta>', methods=['POST'])
def api_resolver_propuesta(id_propuesta):
    """
    Resuelve (aprueba o rechaza) una propuesta y la ELIMINA de la cola.
    
    NUEVO: NO elimina de db_propuestas, solo actualiza estado_revision.
    El cliente puede ver el historial completo.
    
    Acción: "aprobar" | "rechazar"
    """
    if id_propuesta not in db_propuestas:
        return jsonify({"error": "Propuesta no encontrada"}), 404
    
    data = request.json
    accion = data.get("accion", "")
    nota = data.get("nota", "")
    
    if accion not in ["aprobar", "rechazar", "editar_y_aprobar"]:
        return jsonify({"error": "Acción inválida. Use 'aprobar', 'rechazar' o 'editar_y_aprobar'"}), 400
    
    # CORRECCIÓN: Asegurarnos de que modificamos el objeto original en db_propuestas
    propuesta = db_propuestas[id_propuesta]
    
    # Actualizar estado
    if accion == "aprobar":
        propuesta["estado_interno"] = "aprobada"
        propuesta["estado"] = "Aprobada"
        propuesta["estado_revision"] = "Aprobada"  # CRÍTICO: Para el cliente
        logger.info(f"✅ Propuesta {id_propuesta} APROBADA - estado_revision={propuesta['estado_revision']}")
    elif accion == "editar_y_aprobar":
        propuesta_editada = data.get("propuesta_editada", {})
        if propuesta_editada and "asignacion" in propuesta_editada:
            # Guardar original antes de sobrescribir
            propuesta["detalles"]["asignacion_original"] = propuesta["detalles"].get("asignacion", [])
            propuesta["detalles"]["asignacion"] = propuesta_editada["asignacion"]
            propuesta["fue_editada"] = True
        
        propuesta["estado_interno"] = "aprobada"
        propuesta["estado"] = "Aprobada (Editada)"
        propuesta["estado_revision"] = "Aprobada"
        logger.info(f"✏️✅ Propuesta {id_propuesta} EDITADA Y APROBADA - estado_revision={propuesta['estado_revision']}")
    else:
        propuesta["estado_interno"] = "rechazada"
        propuesta["estado"] = "Rechazada"
        propuesta["estado_revision"] = "Rechazada"  # CRÍTICO: Para el cliente
        logger.info(f"❌ Propuesta {id_propuesta} RECHAZADA - estado_revision={propuesta['estado_revision']}")
    
    # CRÍTICO: Eliminar de la cola FIFO (pero NO de db_propuestas)
    if id_propuesta in propuestas_pendientes:
        propuestas_pendientes.remove(id_propuesta)
        logger.info(f"🗑️  Propuesta {id_propuesta} eliminada de cola FIFO")
    
    # Registrar auditoría simplificada
    asesor_nombre = session.get("asesor_nombre", "Asesor Standalone")
    asesor_cargo = session.get("asesor_cargo", "Asesor de Inversiones")
    
    firma_data = f"{asesor_nombre}-{accion}-{datetime.now().isoformat()}"
    firma = generar_firma_digital(firma_data)
    
    log_entry = {
        "fecha": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "timestamp": datetime.now().isoformat(),
        "responsable": asesor_nombre,
        "asesor": asesor_nombre,
        "cargo": asesor_cargo,
        "accion": propuesta["estado"],
        "version_reglas": "v1.0 Q3-2026",
        "observaciones": nota or f"Propuesta {accion}da desde panel standalone",
        "nota": nota,
        "firma_id": firma,
    }
    
    propuesta["log"] = log_entry
    propuesta.setdefault("historial", []).append(log_entry)
    propuesta["fecha_resolucion"] = datetime.now().isoformat()
    
    # Verificar que se guardó correctamente
    logger.info(f"📝 Estado final en db_propuestas: {db_propuestas[id_propuesta]['estado_revision']}")
    
    return jsonify({
        "ok": True,
        "estado": propuesta["estado"],
        "estado_revision": propuesta["estado_revision"],
        "mensaje": f"Propuesta {accion}da exitosamente",
        "cola_restante": len(propuestas_pendientes)
    })


@app.route('/api/mis_propuestas', methods=['GET'])
def api_mis_propuestas():
    """
    Devuelve todas las propuestas del usuario autenticado.
    
    Query params:
    - usuario: nombre del usuario (ej. cliente_demo)
    
    Returns: Lista de propuestas con su estado actual.
    """
    usuario = request.args.get('usuario', 'cliente_demo')
    
    # Filtrar propuestas por usuario
    propuestas_usuario = []
    
    for id_prop, prop in db_propuestas.items():
        # Solo propuestas de este usuario que fueron enviadas (tienen usuario_cliente)
        if prop.get("usuario_cliente") == usuario:
            detalles = prop.get("detalles", {})
            propuestas_usuario.append({
                "id": id_prop,
                "perfil": detalles.get("perfil", "N/A"),
                "estado_revision": prop.get("estado_revision", "Generada"),
                "fecha_creacion": prop.get("fecha_creacion", ""),
                "fecha_envio": prop.get("fecha_envio", ""),
                "fecha_resolucion": prop.get("fecha_resolucion", ""),
                "goal": prop.get("goal", ""),
                "asesor": prop.get("log", {}).get("asesor", "") if prop.get("log") else "",
                "observaciones": prop.get("log", {}).get("observaciones", "") if prop.get("log") else "",
                "fue_editada": prop.get("fue_editada", False),
                "asignacion": detalles.get("asignacion", []),
                "asignacion_original": detalles.get("asignacion_original", [])
            })
    
    # Ordenar por fecha de creación (más reciente primero)
    propuestas_usuario.sort(
        key=lambda x: x["fecha_creacion"] or "",
        reverse=True
    )
    
    return jsonify({
        "propuestas": propuestas_usuario,
        "total": len(propuestas_usuario),
        "usuario": usuario
    })


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