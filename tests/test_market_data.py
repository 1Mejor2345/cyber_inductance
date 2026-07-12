import pytest
from unittest.mock import patch, MagicMock
from agents.market_data import buscar_instrumento, _cache

@pytest.fixture(autouse=True)
def reset_cache():
    """Reset market data cache before each test"""
    _cache.clear()

@patch('yfinance.Ticker')
def test_buscar_instrumento_success(mock_ticker_class):
    # Setup mock to simulate yfinance Ticker behavior
    mock_ticker_instance = MagicMock()
    mock_ticker_instance.info = {
        "regularMarketPrice": 450.5,
        "52WeekChange": 0.15,
        "beta": 1.1,
        "sector": "Technology"
    }
    mock_ticker_class.return_value = mock_ticker_instance
    
    # Primera llamada (debería llamar a yfinance)
    resultado = buscar_instrumento("SPY")
    assert resultado["precio_actual"] == 450.5
    assert resultado["beta"] == 1.1
    mock_ticker_class.assert_called_once_with("SPY")
    
    # Segunda llamada (debería usar caché, no llama a yfinance otra vez)
    resultado_cache = buscar_instrumento("SPY")
    assert resultado_cache["precio_actual"] == 450.5
    # La cantidad de llamadas a Ticker() debe seguir siendo 1
    mock_ticker_class.assert_called_once()

@patch('yfinance.Ticker')
def test_buscar_instrumento_not_found(mock_ticker_class):
    # Simular un Ticker que no devuelve info (ej. no existe)
    mock_ticker_instance = MagicMock()
    mock_ticker_instance.info = {}
    mock_ticker_class.return_value = mock_ticker_instance
    
    resultado = buscar_instrumento("FAKE_TICKER")
    assert "error" in resultado
    assert "Instrumento no encontrado" in resultado["error"]
