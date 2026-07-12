import pytest
from app import app, db_propuestas, propuestas_pendientes, MAX_COLA

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

@pytest.fixture(autouse=True)
def reset_state():
    """Reset the mock database and queue before each test"""
    db_propuestas.clear()
    propuestas_pendientes.clear()
    
def test_cola_llena_429(client):
    # Llenar la cola al máximo
    for i in range(MAX_COLA):
        id_mock = f"mock_{i}"
        db_propuestas[id_mock] = {"id": id_mock}
        propuestas_pendientes.append(id_mock)
        
    # Crear una nueva propuesta e intentar enviarla
    db_propuestas["mock_overflow"] = {"id": "mock_overflow"}
    
    response = client.post('/api/enviar_propuesta', json={
        "id_propuesta": "mock_overflow",
        "usuario": "cliente_test"
    })
    
    assert response.status_code == 429
    data = response.get_json()
    assert "cola_llena" in data
    assert data["cola_llena"] is True

def test_flujo_aprobar_propuesta(client):
    # Preparar datos
    id_test = "test_prop_1"
    db_propuestas[id_test] = {
        "id": id_test,
        "estado": "Generada",
        "estado_interno": "generada",
        "detalles": {"asignacion": [{"nombre": "SPY", "porcentaje": 100}]}
    }
    
    # 1. Enviar a cola
    client.post('/api/enviar_propuesta', json={"id_propuesta": id_test})
    assert id_test in propuestas_pendientes
    assert db_propuestas[id_test]["estado_revision"] == "Pendiente"
    
    # 2. Aprobar (resolver)
    response = client.post(f'/api/resolver_propuesta/{id_test}', json={
        "accion": "aprobar",
        "nota": "Todo correcto"
    })
    
    assert response.status_code == 200
    assert id_test not in propuestas_pendientes
    
    propuesta = db_propuestas[id_test]
    assert propuesta["estado"] == "Aprobada"
    assert propuesta["estado_revision"] == "Aprobada"

def test_flujo_editar_y_aprobar(client):
    id_test = "test_prop_2"
    db_propuestas[id_test] = {
        "id": id_test,
        "estado": "Pendiente",
        "detalles": {"asignacion": [{"nombre": "SPY", "porcentaje": 100}]}
    }
    
    nueva_asignacion = [{"nombre": "SPY", "porcentaje": 50}, {"nombre": "TLT", "porcentaje": 50}]
    
    response = client.post(f'/api/resolver_propuesta/{id_test}', json={
        "accion": "editar_y_aprobar",
        "propuesta_editada": {"asignacion": nueva_asignacion},
        "nota": "Diversificando riesgo"
    })
    
    assert response.status_code == 200
    propuesta = db_propuestas[id_test]
    assert propuesta["fue_editada"] is True
    assert propuesta["estado_revision"] == "Aprobada"
    assert propuesta["detalles"]["asignacion_original"] == [{"nombre": "SPY", "porcentaje": 100}]
    assert propuesta["detalles"]["asignacion"] == nueva_asignacion
