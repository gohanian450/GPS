# 🚗 RouteTrack — Suivi automobile en direct

Application web complète de suivi de trajets automobiles : tableau de bord de
vitesse en temps réel, historique persistant, suggestions basées sur vos
meilleurs trajets, et trafic en direct (TomTom) — le tout dans une interface
sombre style tableau de bord, en français québécois.

---

## ✨ Fonctionnalités

1. **Tableau de bord de vitesse en direct** — suivi GPS via l'API Geolocation du
   navigateur (`watchPosition`, haute précision), compteur semi-circulaire animé
   (0–160 km/h), vitesse instantanée, distance, durée, vitesse moyenne et
   maximale. Carte Leaflet qui trace le trajet en direct.
2. **Persistance en base de données** — chaque trajet (> 50 m) est sauvegardé
   en SQLite avec son tracé complet.
3. **Suggestion basée sur l'historique** — en tapant une destination déjà
   visitée, RouteTrack retrouve votre **meilleur** trajet (vitesse moyenne la
   plus haute) et affiche son temps, sa date et son tracé en pointillé.
4. **Trafic en direct (TomTom)** — temps de trajet ajusté au trafic + badge
   « plus lent / plus rapide que la normale », et couche de trafic coloré
   optionnelle sur la carte. **La clé TomTom reste toujours côté serveur.**

---

## 🧱 Stack technique

| Couche       | Technologies                                  |
| ------------ | --------------------------------------------- |
| Frontend     | React + Vite + TypeScript, Leaflet.js         |
| Backend      | Node.js + Express + TypeScript                |
| Base données | SQLite (`better-sqlite3`)                     |
| Cartographie | Leaflet + tuiles OpenStreetMap                |
| Trafic       | API TomTom (Routing + Traffic Flow tiles)     |

---

## 📁 Structure du projet

```
.
├── client/          # Frontend React + Vite
│   └── src/
│       ├── components/   # Speedometer, TripMap, StatsPanel, ...
│       └── lib/          # api, geo (Haversine), useTracker, types
├── server/          # Backend Express + SQLite
│   ├── src/
│   │   ├── routes/       # trips.ts, traffic.ts
│   │   ├── db.ts
│   │   └── index.ts
│   └── .env.example
└── README.md
```

---

## 🚀 Installation & lancement

Il faut lancer **deux processus** : le backend (port `3001`) et le frontend
(port `5173`). Le serveur de dev Vite relaie automatiquement toutes les
requêtes `/api` vers le backend.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env      # puis ajoutez votre clé TomTom dans .env
npm run dev               # démarre l'API sur http://localhost:3001
```

### 2. Frontend (dans un second terminal)

```bash
cd client
npm install
npm run dev               # démarre l'app sur http://localhost:5173
```

Ouvrez ensuite **http://localhost:5173** dans votre navigateur.

> ⚠️ La géolocalisation exige un contexte sécurisé : `localhost` fonctionne, mais
> en production il faut du **HTTPS**.

### Clé TomTom

Créez un compte gratuit sur [developer.tomtom.com](https://developer.tomtom.com/),
générez une clé API, puis renseignez-la dans `server/.env` :

```
TOMTOM_API_KEY=votre_cle_ici
```

Sans clé, l'application fonctionne quand même : seules les fonctions de trafic
(ETA en direct et couche de trafic) sont désactivées proprement.

---

## 🔌 API REST (backend)

| Méthode | Route                                                          | Description                                            |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `POST`  | `/api/trips`                                                   | Sauvegarder un trajet complété (> 50 m)                |
| `GET`   | `/api/trips`                                                   | Lister tous les trajets (du plus récent au plus ancien)|
| `GET`   | `/api/trips/best?destination=X`                                | Meilleur trajet (vitesse moyenne la plus haute)        |
| `DELETE`| `/api/trips/:id`                                               | Supprimer un trajet                                    |
| `DELETE`| `/api/trips`                                                   | Tout effacer                                           |
| `GET`   | `/api/traffic/eta?originLat=&originLng=&destLat=&destLng=`     | `{ liveSeconds, freeFlowSeconds }` via TomTom Routing  |
| `GET`   | `/api/traffic/tile/:z/:x/:y`                                   | Proxy des tuiles de trafic TomTom (flow/relative)      |
| `GET`   | `/api/health`                                                 | État du serveur + présence de la clé TomTom            |

---

## 🛠️ Build de production

```bash
# Backend
cd server && npm run build && npm start

# Frontend
cd client && npm run build && npm run preview
```

En production, servez le dossier `client/dist` derrière un reverse-proxy qui
route `/api` vers le backend Express.

---

## 🧯 Gestion d'erreurs

- **Géolocalisation refusée / indisponible / délai dépassé** → message clair
  dans un bandeau.
- **Clé TomTom absente** → réponse `503` explicite, l'app reste utilisable.
- **API TomTom indisponible** → réponse `502`, le frontend affiche l'erreur sans
  planter.
- **Trajet trop court (< 50 m)** → non sauvegardé, avec notification.

---

Bonne route ! 🛣️
