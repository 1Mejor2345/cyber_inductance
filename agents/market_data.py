"""
market_data.py — Módulo de consulta de datos financieros reales.

Utiliza yfinance para obtener datos del mercado en tiempo real.
Incluye cache en memoria (1 hora) para no saturar Yahoo Finance.
"""

import json
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Cache en memoria: {ticker: {data: ..., timestamp: ...}}
_cache = {}
CACHE_TTL_SECONDS = 3600  # 1 hora

# ─── Catálogo de instrumentos reales para el Robo-Advisor ────────────────────
CATALOGO_TICKERS = {
    # ETFs de Renta Variable
    "SPY": {"nombre": "SPDR S&P 500 ETF", "tipo": "ETF Renta Variable", "riesgo": "Medio"},
    "QQQ": {"nombre": "Invesco QQQ Trust (Tecnología)", "tipo": "ETF Tecnología", "riesgo": "Alto"},
    "VTI": {"nombre": "Vanguard Total Stock Market ETF", "tipo": "ETF Renta Variable", "riesgo": "Medio"},
    "VWO": {"nombre": "Vanguard FTSE Emerging Markets ETF", "tipo": "ETF Mercados Emergentes", "riesgo": "Alto"},
    # ETFs de Renta Fija / Bonos
    "BND": {"nombre": "Vanguard Total Bond Market ETF", "tipo": "ETF Bonos", "riesgo": "Bajo"},
    "TLT": {"nombre": "iShares 20+ Year Treasury Bond ETF", "tipo": "ETF Bonos Largo Plazo", "riesgo": "Bajo-Medio"},
    "LQD": {"nombre": "iShares Investment Grade Corp Bond ETF", "tipo": "ETF Bonos Corporativos", "riesgo": "Bajo-Medio"},
    "SHV": {"nombre": "iShares Short Treasury Bond ETF", "tipo": "ETF Bonos Corto Plazo", "riesgo": "Muy Bajo"},
    # Fondos Monetarios / Liquidez
    "SGOV": {"nombre": "iShares 0-3 Month Treasury Bond ETF", "tipo": "Fondo Monetario", "riesgo": "Muy Bajo"},
    "BIL": {"nombre": "SPDR Bloomberg 1-3 Month T-Bill ETF", "tipo": "Fondo Monetario", "riesgo": "Muy Bajo"},
    # Alternativos
    "GLD": {"nombre": "SPDR Gold Shares", "tipo": "Commodities (Oro)", "riesgo": "Medio"},
    "VNQ": {"nombre": "Vanguard Real Estate ETF", "tipo": "Real Estate (REITs)", "riesgo": "Medio-Alto"},
}


def _obtener_de_cache(ticker: str):
    """Retorna datos del cache si no han expirado."""
    if ticker in _cache:
        entry = _cache[ticker]
        if time.time() - entry["timestamp"] < CACHE_TTL_SECONDS:
            return entry["data"]
    return None


def _guardar_en_cache(ticker: str, data: dict):
    """Guarda datos en el cache con timestamp."""
    _cache[ticker] = {"data": data, "timestamp": time.time()}


def buscar_instrumento(ticker: str) -> dict:
    """
    Consulta datos reales de un instrumento financiero.
    
    Returns:
        dict con: ticker, nombre, precio_actual, moneda, sector, beta, 
                  rendimiento_1y, tipo, riesgo, existe
    """
    cached = _obtener_de_cache(ticker)
    if cached:
        logger.info(f"📦 Cache hit para {ticker}")
        return cached
    
    try:
        import yfinance as yf
        stock = yf.Ticker(ticker)
        info = stock.info
        
        if not info or info.get("regularMarketPrice") is None:
            return {"ticker": ticker, "existe": False, "error": "Instrumento no encontrado"}
        
        rendimiento_1y = None
        try:
            hist = stock.history(period="1y")
            if len(hist) >= 2:
                precio_inicio = hist["Close"].iloc[0]
                precio_fin = hist["Close"].iloc[-1]
                rendimiento_1y = round(((precio_fin - precio_inicio) / precio_inicio) * 100, 2)
        except Exception:
            pass
        
        data = {
            "ticker": ticker,
            "existe": True,
            "nombre": info.get("shortName") or info.get("longName", ticker),
            "precio_actual": info.get("regularMarketPrice") or info.get("previousClose"),
            "moneda": info.get("currency", "USD"),
            "sector": info.get("sector", "N/A"),
            "industria": info.get("industry", "N/A"),
            "beta": info.get("beta"),
            "rendimiento_1y_pct": rendimiento_1y,
            "market_cap": info.get("marketCap"),
            "tipo": CATALOGO_TICKERS.get(ticker, {}).get("tipo", "Otro"),
            "riesgo_catalogo": CATALOGO_TICKERS.get(ticker, {}).get("riesgo", "Desconocido"),
            "fecha_consulta": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
        
        _guardar_en_cache(ticker, data)
        logger.info(f"✅ Datos obtenidos para {ticker}: ${data['precio_actual']} {data['moneda']}")
        return data
        
    except ImportError:
        logger.error("❌ yfinance no está instalado. Ejecuta: pip install yfinance")
        return {"ticker": ticker, "existe": False, "error": "yfinance no instalado"}
    except Exception as e:
        logger.error(f"❌ Error consultando {ticker}: {e}")
        return {"ticker": ticker, "existe": False, "error": str(e)}


def obtener_catalogo_real() -> str:
    """
    Genera un catálogo de instrumentos con datos reales de mercado.
    Retorna un string formateado listo para inyectar en prompts de IA.
    """
    lineas = ["Catálogo de Instrumentos con Datos Reales de Mercado — Actualizado"]
    lineas.append("=" * 60)
    
    for ticker, meta in CATALOGO_TICKERS.items():
        data = buscar_instrumento(ticker)
        
        if data.get("existe"):
            precio = data.get("precio_actual", "N/A")
            rendimiento = data.get("rendimiento_1y_pct")
            beta = data.get("beta")
            
            rend_str = f", Rendimiento 1 año: {rendimiento}%" if rendimiento is not None else ""
            beta_str = f", Beta: {beta}" if beta is not None else ""
            
            lineas.append(
                f"- {ticker} | {meta['nombre']} | Tipo: {meta['tipo']} | "
                f"Riesgo: {meta['riesgo']} | Precio: ${precio}{rend_str}{beta_str}"
            )
        else:
            lineas.append(
                f"- {ticker} | {meta['nombre']} | Tipo: {meta['tipo']} | "
                f"Riesgo: {meta['riesgo']} | (datos no disponibles)"
            )
    
    lineas.append("")
    lineas.append("IMPORTANTE: Solo recomienda instrumentos de este catálogo.")
    lineas.append("Usa los tickers reales (ej. SPY, BND, QQQ) en tus recomendaciones.")
    
    return "\n".join(lineas)


def validar_propuesta(asignacion: list) -> dict:
    """
    Valida una propuesta de portafolio contra datos reales del mercado.
    
    Args:
        asignacion: lista de dicts con {nombre, porcentaje, ticker}
    
    Returns:
        dict con: valida (bool), errores (list), datos_verificados (list)
    """
    errores = []
    datos_verificados = []
    total_porcentaje = 0
    
    for activo in asignacion:
        ticker = activo.get("ticker", "")
        porcentaje = activo.get("porcentaje", 0)
        total_porcentaje += porcentaje
        
        if ticker:
            data = buscar_instrumento(ticker)
            if data.get("existe"):
                datos_verificados.append({
                    "ticker": ticker,
                    "nombre_real": data["nombre"],
                    "precio": data["precio_actual"],
                    "rendimiento_1y": data.get("rendimiento_1y_pct"),
                    "verificado": True
                })
            else:
                errores.append(f"El instrumento '{ticker}' no existe o no tiene datos disponibles.")
                datos_verificados.append({"ticker": ticker, "verificado": False})
        else:
            errores.append(f"El activo '{activo.get('nombre', '?')}' no tiene ticker asignado.")
    
    if abs(total_porcentaje - 100) > 1:
        errores.append(f"Los porcentajes suman {total_porcentaje}%, no 100%.")
    
    return {
        "valida": len(errores) == 0,
        "errores": errores,
        "datos_verificados": datos_verificados,
        "total_porcentaje": total_porcentaje
    }
