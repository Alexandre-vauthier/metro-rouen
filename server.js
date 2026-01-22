import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = 3000;

app.use(cors());

// Route pour récupérer les données du métro
app.get('/api/metro', async (req, res) => {
  try {
    const response = await fetch('https://gtfs.bus-tracker.fr/gtfs-rt/tcar/trip-updates.json');
    const data = await response.json();
    
    // DÉBOGAGE : Afficher les infos dans la console
    console.log('\n=== DONNÉES REÇUES ===');
    console.log(`Nombre d'entités: ${data.entity?.length || 0}`);
    
    // Chercher les métros (route TCAR:90)
    const metros = data.entity?.filter(e => 
      e.tripUpdate?.trip?.routeId === 'TCAR:90'
    ) || [];
    
    console.log(`Métros trouvés (TCAR:90): ${metros.length}`);
    
    // Collecter TOUS les stopIds uniques
    const allStops = new Map(); // stopId -> { directions, vehicleLabels }
    
    metros.forEach(metro => {
      const direction = metro.tripUpdate.trip.directionId;
      const vehicleLabel = metro.tripUpdate.vehicle?.label || 'Inconnu';
      
      metro.tripUpdate.stopTimeUpdate?.forEach(stop => {
        const stopId = stop.stopId;
        if (!allStops.has(stopId)) {
          allStops.set(stopId, { directions: new Set(), vehicleLabels: new Set() });
        }
        allStops.get(stopId).directions.add(direction);
        allStops.get(stopId).vehicleLabels.add(vehicleLabel);
      });
    });
    
    // Afficher tous les stops triés par ID
    console.log('\n=== TOUS LES ARRÊTS DU MÉTRO ===');
    const sortedStops = [...allStops.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedStops.forEach(([stopId, info]) => {
      const dirs = [...info.directions].join(', ');
      const vehicles = [...info.vehicleLabels].join(', ');
      console.log(`${stopId} | Dir: ${dirs} | Dest: ${vehicles}`);
    });
    
    console.log(`\nTotal: ${allStops.size} arrêts uniques`);
    
    // Résumé par direction et destination
    console.log('\n=== RÉSUMÉ PAR DIRECTION ===');
    const byDirection = {};
    metros.forEach(m => {
      const dir = m.tripUpdate.trip.directionId;
      const dest = m.tripUpdate.vehicle?.label || 'Inconnu';
      const key = `Dir ${dir} → ${dest}`;
      byDirection[key] = (byDirection[key] || 0) + 1;
    });
    Object.entries(byDirection).forEach(([key, count]) => {
      console.log(`  ${key}: ${count} métro(s)`);
    });
    
    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des données' });
  }
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📡 API disponible sur http://localhost:${PORT}/api/metro`);
});
