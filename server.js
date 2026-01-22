import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Route pour récupérer les données du métro
app.get('/api/metro', async (req, res) => {
  try {
    const response = await fetch('https://gtfs.bus-tracker.fr/gtfs-rt/tcar/trip-updates.json');
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des données' });
  }
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});
