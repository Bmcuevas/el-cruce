# El Cruce 2026

App web para que Bruno y Marco preparen El Cruce: equipaje de cada uno, checklist nocturno por etapa, pendientes e itinerario.

- **Frontend:** archivos estáticos en GitHub Pages (`index.html`, `styles.css`, `app.js`).
- **Datos:** Firebase Firestore, en `trips/<código del viaje>/…`. Funciona sin señal y sincroniza cuando vuelve la conexión.
- **Instalable:** desde el navegador del celular, "Agregar a pantalla de inicio".

## Puesta en marcha

1. Crear un proyecto en Firebase, activar Firestore y registrar una app web.
2. Pegar la config en `firebase-config.js`.
3. Copiar `firestore.rules` en Firestore → Reglas → Publicar.
4. Abrir la app con el link del viaje (`…/#v-<código>`). La primera vez carga la lista inicial (`src/seed.json`).

## Desarrollo

```
npm install
npm run build   # genera app.js desde src/main.js
```
