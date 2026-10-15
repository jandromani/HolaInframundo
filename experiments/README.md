# CANARY-001 — Primer experimento REAL (16/10/2026)

**No es una señal de compra.** Prueba preregistrada para demostrar o refutar que GearWatch puede identificar una transmisión económica fuera de sus 26 temas programados y conectarla con una compañía antes de observar su resultado.

**Preregistración congelada:** [CANARY-001.preregistered.json](./CANARY-001.preregistered.json). La fecha de creación y commit SHA inicial de GitHub es la prueba pública de que los criterios fueron fijados antes de observar los retornos posteriores. No reescribir ese archivo tras conocer resultados.

## Pregunta
¿La escasez de fertilizantes nitrogenados por Hormuz, combinada con una ventaja de costes de gas estadounidense, favorece de forma demostrable a **LSB Industries (NYSE: LXU)** y provoca una reacción superior a **CF Industries (NYSE: CF)**?

### Evidencia ya disponible (NO original ni novedosa)
- WTO: disrupción del comercio de fertilizantes desde el inicio del conflicto (julio).
- Reuters 14 octubre: negociación de corredor ONU fertilizantes, pendiente de acuerdo.
- LSB 29 julio: Q2 2026 netback UAN USD 433/short ton, ammonia USD 658/short ton; gas USD 2.96/MMBtu; EBITDA ajustado USD 53.1M; Q2 afectado por paradas planificadas.
- FertilizerPrice.com 15 octubre (fuente secundaria; NO precios netback de LXU): UAN 32% USD 622.14/short ton, ammonia USD 905.67/short ton; metodología por verificar.
- LSB 14 octubre: Q3 resultados 28 octubre tras cierre; llamada 29 octubre.
- Cierre LXU USD 10.46 y CF USD 119.77 del 15 octubre 2026. LXU after-hours USD 10.91: NO es cierre ni precio de entrada.

## Hipótesis registradas
1. **Física:** fertilizantes del Golfo siguen sufriendo restricción logística objetiva; exigir 2 fuentes independientes. Noticias sobre falta de acuerdo no son medición de flujo.
2. **Económica:** LXU preserva la realización por tonelada y mejora volumen/capacidad mientras mantiene ventaja relativa de gas. Validador corporativo: publicación 28/10 y llamada 29/10. Q3 cerró 30 septiembre, así que no prueba efecto de anuncios de 14 octubre.
3. **Mercado (control):** con primer OPEN regular del 16 octubre de LXU y CF, medir 5/10/20 sesiones después de apertura. Condición de investigación: LXU supera CF en 5 puntos porcentuales y tiene retorno absoluto positivo a 20 sesiones. Es criterio de contraste, NO objetivo de beneficio.
4. **Sesgo:** si LXU abre 16 octubre 8% o más sobre USD 10.46, clasificar ALREADY_MOVED_ENTRY. Nunca sustituir el open por una sesión posterior conveniente.

## Funcionamiento
- npm run canary:test: fixtures adversariales de no-lookahead, gap, silencio del proveedor y ausencia de órdenes.
- npm run canary:observe: OHLC diarios LXU/CF desde Yahoo Chart; sólo barras de sesión completa. Fallos → MARKET_DATA_UNAVAILABLE.
- Cada scan de seis horas guarda sólo nuevas observaciones en data/experiments/CANARY-001.observations.json.
- El briefing 14:30 Europe/Madrid evalúa fuentes independientes para las patas física y empresarial.
- SUPPORTED sólo si **las tres patas** superan los gates; una subida bursátil sola no demuestra causalidad. Datos ausentes: INCONCLUSIVE.

## Limitaciones y KILL
- Tesis no novedosa para inversores: LXU ya informó en Q1/Q2 y analistas hablaron de ello.
- Henry Hub spot ≠ coste realizado LSB. Precios minoristas UAN ≠ netback corporativo.
- Contratos, mix de producto, deuda USD 441.3M, turnarounds, potencial dilución, volatilidad.
- Los precios altos pueden destruir demanda.
- Sin corroboración física o si LXU no supera CF en el horizonte de control, no hay canario demostrado.
- Un único experimento favorable no demostraría ventaja estadística: sirve para verificar la disciplina y revelar los datos ausentes.

**No hay dinero invertido ni órdenes automáticas asociadas a CANARY-001.**
