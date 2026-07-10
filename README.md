# 🚗 RouteTrack — Suivi automobile en direct

Application web complète de suivi de trajets automobiles : tableau de bord de
vitesse en temps réel, historique persistant, suggestions basées sur vos
meilleurs trajets, et trafic en direct (TomTom) — dans une interface sombre
style tableau de bord, en français québécois.

**Déployable sur [Vercel](https://vercel.com) avec une base de données
[Turso](https://turso.tech) (libSQL).**

---

## ✨ Fonctionnalités

1. **Tableau de bord de vitesse en direct** — suivi GPS (`watchPosition`, haute
   précision), compteur semi-circulaire animé (0–160 km/h), vitesse instantanée,
   distance, durée, vitesse moyenne et maximale, tracé Leaflet en direct.
2. **Persistance** — chaque trajet (> 50 m) est sauvegardé dans Turso avec son
   tracé complet.
3. **Suggestion basée sur l'historique** — en tapant une destination déjà
   visitée, RouteTrack retrouve votre **meilleur** trajet (vitesse moyenne la
   plus haute) et l'affiche en pointillé sur la carte.
4. **Trafic en direct (TomTom)** — temps ajusté au trafic + badge « plus lent /
   plus rapide que la normale », et couche de trafic coloré optionnelle.
   **La clé TomTom reste toujours côté serveur.**
5. **Recherche d'adresse + itinéraire** — tapez une adresse réelle et cliquez
   sur **🧭 Itinéraire** : l'app géocode l'adresse, trace le chemin vers la
   destination sur la carte (ligne bleue) et affiche le temps de trajet estimé
   avec le trafic. ⚠️ Nécessite `TOMTOM_API_KEY`.

---

## 🧱 Stack technique

| Couche       | Technologies                                          |
| ------------ | ----------------------------------------------------- |
| Frontend     | React + Vite + TypeScript, Leaflet.js                 |
| Backend      | Express + TypeScript, en **fonction serverless Vercel** |
| Base données | **Turso / libSQL** (`@libsql/client`)                 |
| Cartographie | Leaflet + tuiles OpenStreetMap                        |
| Trafic       | API TomTom (Routing + Traffic Flow tiles)             |

---

## 📁 Structure du projet

```
.
├── api/
│   └── index.ts          # Fonction serverless Vercel → app Express partagée
├── server/src/           # Code backend partagé (dev local + serverless)
│   ├── app.ts            # createApp() : fabrique l'app Express
│   ├── db.ts             # Client Turso/libSQL + schéma
│   ├── index.ts          # Serveur de dev local (listen)
│   └── routes/           # trips.ts, traffic.ts
├── client/               # Frontend React + Vite
│   └── src/
│       ├── components/   # Speedometer, TripMap, StatsPanel, ...
│       └── lib/          # api, geo (Haversine), useTracker, types
├── vercel.json           # Config de déploiement Vercel
├── package.json          # Deps backend + scripts de dev
└── .env.example
```

Le backend est écrit une seule fois (`server/src/app.ts`) et réutilisé par le
serveur de dev local **et** par la fonction serverless Vercel (`api/index.ts`),
qui exporte simplement l'app Express — une app Express étant une fonction
`(req, res) => …`, elle est directement utilisable comme handler Vercel.

---

## 🚀 Développement local

Deux processus : le backend (port `3001`) et le frontend (port `5173`). Vite
relaie automatiquement `/api` vers le backend.

```bash
# 1. Installer les dépendances backend + config
npm install
cp .env.example .env          # (optionnel en local — voir ci-dessous)

# 2. Lancer le backend
npm run dev:server            # http://localhost:3001

# 3. Lancer le frontend (2e terminal)
npm run dev:client            # http://localhost:5173
```

Ouvrez **http://localhost:5173**.

> 💡 **En local, Turso est optionnel.** Si `TURSO_DATABASE_URL` n'est pas défini,
> l'app retombe automatiquement sur un fichier SQLite local (`routetrack.db`).
> Vous n'avez donc pas besoin de compte Turso pour développer.

> ⚠️ La géolocalisation exige un contexte sécurisé : `localhost` fonctionne, mais
> en production il faut du **HTTPS** (fourni par Vercel).

---

## 🗄️ Configurer Turso

```bash
# Installer la CLI : https://docs.turso.tech/cli/installation
turso db create routetrack
turso db show routetrack --url          # → TURSO_DATABASE_URL
turso db tokens create routetrack       # → TURSO_AUTH_TOKEN
```

La table `trips` est créée automatiquement au premier appel API
(`CREATE TABLE IF NOT EXISTS`), aucune migration manuelle n'est nécessaire.

---

## ▲ Déploiement sur Vercel

1. Poussez le dépôt sur GitHub et importez-le dans Vercel.
2. Vercel détecte `vercel.json` : il construit le frontend (`client/dist`) et
   déploie `api/index.ts` comme fonction serverless. Rien d'autre à régler.
3. Dans **Project Settings → Environment Variables**, ajoutez :

   | Variable              | Exemple                          |
   | --------------------- | -------------------------------- |
   | `TURSO_DATABASE_URL`  | `libsql://routetrack-xxx.turso.io` |
   | `TURSO_AUTH_TOKEN`    | `eyJhbGci...`                    |
   | `TOMTOM_API_KEY`      | `votre_cle_tomtom`               |

4. Déployez. Le frontend appelle `/api/...` sur le même domaine — la clé TomTom
   n'est jamais exposée au navigateur.

> Les clés/token ne sont jamais committés : `.env` est dans `.gitignore`.

---

## 🔌 API REST

| Méthode | Route                                                       | Description                                    |
| ------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `POST`  | `/api/trips`                                                | Sauvegarder un trajet complété (> 50 m)        |
| `GET`   | `/api/trips`                                                | Lister tous les trajets (récents → anciens)    |
| `GET`   | `/api/trips/best?destination=X`                             | Meilleur trajet (vitesse moyenne la plus haute)|
| `DELETE`| `/api/trips/:id`                                            | Supprimer un trajet                            |
| `DELETE`| `/api/trips`                                                | Tout effacer                                   |
| `GET`   | `/api/traffic/geocode?q=adresse`                           | Adresse → `{ lat, lng, label }` (TomTom Search)|
| `GET`   | `/api/traffic/route?originLat=&originLng=&destLat=&destLng=`| Itinéraire : temps + géométrie à tracer        |
| `GET`   | `/api/traffic/eta?originLat=&originLng=&destLat=&destLng=`  | `{ liveSeconds, freeFlowSeconds }` (TomTom)    |
| `GET`   | `/api/traffic/tile/:z/:x/:y`                                | Proxy des tuiles de trafic TomTom              |
| `GET`   | `/api/health`                                               | État du serveur + présence de la clé TomTom    |

---

## 🧯 Gestion d'erreurs

- **Géolocalisation refusée / indisponible / délai dépassé** → bandeau clair.
- **Clé TomTom absente** → `503` explicite, l'app reste utilisable.
- **API TomTom indisponible** → `502`, affiché sans planter.
- **Trajet trop court (< 50 m)** → non sauvegardé, avec notification.

---

Bonne route ! 🛣️
