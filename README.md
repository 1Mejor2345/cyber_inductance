# Cyber Inductance - Hackathon Agentic Scale (Track 3)

## Descripción
Plataforma de Robo-Advisory con IA (CrewAI + Gemini) y panel de Asesor humano. Incluye validación de datos de mercado en tiempo real usando `yfinance` y flujos de revisión.

## Requisitos y Configuración

1. Instala las dependencias:
```bash
pip install -r requirements.txt
```

2. Configura tu API Key de Gemini:
```bash
export GEMINI_API_KEY="tu-api-key"
```

3. Ejecuta la aplicación:
```bash
python3 app.py
```
Accede a `http://localhost:5000` (Cliente) y `http://localhost:5000/asesor/login` (Asesor).

---

## 🧪 Pruebas Automatizadas (TDD y Mocks)

Según los requisitos del Hackathon, este proyecto incluye una suite de pruebas unitarias automatizadas. Se utilizan **Mocks** para simular las respuestas de los Agentes (LLM) y la API financiera, garantizando que los tests se ejecuten de forma rápida y sin consumir cuota de internet o API.

### Ejecución de Pruebas

Para correr la suite de pruebas obligatoria, ejecuta:

```bash
pytest tests/ -v
```

### ¿Qué se está probando?
- `test_agent.py`: Verifica el parsing JSON y mockea la cadena de `CrewAI` para confirmar que las respuestas simuladas se interpretan correctamente.
- `test_backend.py`: Prueba la lógica de la API Flask, validando el límite máximo de la cola (HTTP 429) y el flujo de estados desde que se crea hasta que se aprueba o edita.
- `test_market_data.py`: Comprueba el sistema de caché en memoria de activos financieros simulando la API de `yfinance`.
