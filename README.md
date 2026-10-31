# NutriLog

Diario de comidas y calorías como app web instalable (PWA). Funciona en Android, iPhone y ordenador, y guarda todos los datos solo en el dispositivo.

## Funciones

- **Diario por día:** desayuno, almuerzo, cena y snacks, con calorías restantes y barras de proteínas, carbohidratos y grasas.
- **Buscador de alimentos** con la base de datos abierta [Open Food Facts](https://world.openfoodfacts.org).
- **Escáner de código de barras** con la cámara (Chrome en Android) o escribiendo el número.
- **Entrada manual** de alimentos y lista de recientes para repetir rápido.
- **Objetivo calórico** calculado con Mifflin-St Jeor según sexo, edad, altura, peso, actividad y objetivo (o un valor propio).
- **Progreso:** registro de peso con gráfica e IMC, y calorías de los últimos 7 días.
- **Agua:** contador diario.
- **Copia de seguridad:** exportar e importar los datos en JSON.
- **Sin conexión:** la interfaz se abre sin internet; buscar y escanear necesitan conexión.

## Probar en local

Requiere Node.js 20 o superior. No hay dependencias que instalar.

```bash
npm start      # http://localhost:8080
npm test       # tests de cálculos, datos y Open Food Facts
```

## Publicar e instalar en el móvil

La app es estática, así que basta con servirla por HTTPS. Con GitHub Pages:

1. En el repositorio, ve a **Settings → Pages**.
2. En *Source* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
3. Abre en el móvil la dirección que te da GitHub:
   - **Android (Chrome):** pulsa **Instalar** en la app o *Menú → Añadir a pantalla de inicio*.
   - **iPhone (Safari):** *Compartir → Añadir a pantalla de inicio*.

## Estructura

```
index.html            Interfaz
css/styles.css        Estilos (modo claro y oscuro)
js/app.js             Lógica de pantallas
js/calc.js            Cálculos de nutrición (sin DOM)
js/store.js           Guardado en el dispositivo
js/off.js             Cliente de Open Food Facts
sw.js                 Service worker (uso sin conexión)
manifest.webmanifest  Datos para instalar la app
tests/                Tests con node:test
```

## Datos y licencias

Los datos de alimentos vienen de Open Food Facts con licencia [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). El código de esta app es MIT.
