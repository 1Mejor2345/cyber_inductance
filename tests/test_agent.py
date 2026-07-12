import pytest
from unittest.mock import patch, MagicMock
from agents.crew import _limpiar_json, _validar_y_limpiar_resultado, run_crew_completo

def test_limpiar_json():
    # Test valid JSON directly
    valid_json = '{"perfil": "Moderado"}'
    assert _limpiar_json(valid_json) == {"perfil": "Moderado"}
    
    # Test JSON inside markdown code blocks
    markdown_json = '```json\n{"perfil": "Conservador"}\n```'
    assert _limpiar_json(markdown_json) == {"perfil": "Conservador"}
    
    # Test text trailing before or after the JSON block
    dirty_json = 'Here is your result:\n```json\n{"perfil": "Dinámico"}\n```\nHope it helps.'
    assert _limpiar_json(dirty_json) == {"perfil": "Dinámico"}

def test_validar_y_limpiar_resultado():
    # Test complete valid structure
    raw_dict = {
        "perfil": "Score: 10/20 Moderado",
        "asignacion": [{"nombre": "SPY", "porcentaje": 100}]
    }
    
    parsed = _validar_y_limpiar_resultado(raw_dict)
    assert parsed["perfil"] == "Moderado"
    assert "asignacion" in parsed
    
    # Test invalid percentage logic (just checking it doesn't crash)
    invalid_dict = {"asignacion": [{"porcentaje": 50}]}
    parsed = _validar_y_limpiar_resultado(invalid_dict)
    assert parsed == invalid_dict

@patch('agents.crew._ejecutar_con_retry')
def test_run_crew_completo_mocked(mock_ejecutar):
    # Setup mock to populate task outputs
    def mock_side_effect(crew_instance):
        # The crew_instance has tasks
        for task in crew_instance.tasks:
            # Create a mock output for each task based on its expected output
            mock_out = MagicMock()
            if "perfil" in task.expected_output:
                mock_out.raw = '{"perfil": "Conservador simulado", "score": -10}'
            elif "asignacion" in task.expected_output:
                mock_out.raw = '{"asignacion": [{"nombre": "TLT", "porcentaje": 100}]}'
            else:
                mock_out.raw = '{}'
            task.output = mock_out
            
    mock_ejecutar.side_effect = mock_side_effect
    
    goal = "Quiero invertir 1000 sin riesgo"
    answers = {"horizon": "corto plazo"}
    
    # Call the actual function
    with patch('agents.crew.obtener_catalogo_real', return_value="Catalogo Fake"):
        result = run_crew_completo(goal, answers)
    
    # Assertions
    mock_ejecutar.assert_called_once()
    assert result["perfil"] == "Conservador simulado"
    assert len(result["asignacion"]) == 1
    assert result["asignacion"][0]["nombre"] == "TLT"
