// Fonction serverless Vercel : toutes les requêtes /api/* sont routées ici
// (fichier catch-all) et confiées à l'application Express partagée.
// Une app Express est une fonction (req, res) => …, donc directement
// utilisable comme handler Vercel.
import { createApp } from '../server/src/app.js';

export default createApp();
