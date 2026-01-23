import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Cache pour les données GTFS statiques
let gtfsData = {
  stopTimes: [],
  trips: [],
  calendar: [],
  calendarDates: [],
  loaded: false,
  lastUpdate: null
};

// Télécharger et parser le GTFS statique
async function loadGTFS() {
  console.log('📥 Téléchargement du GTFS statique...');
  
  try {
    const gtfsUrl = 'https://api.mrn.cityway.fr/dataflow/offre-tc/download?provider=ASTUCE&dataFormat=gtfs&dataProfil=ASTUCE';
    const response = await fetch(gtfsUrl);
    
    if (!response.ok) {
      throw new Error(`Erreur téléchargement GTFS: ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    const zipPath = path.join(__dirname, 'gtfs.zip');
    fs.writeFileSync(zipPath, Buffer.from(buffer));
    
    console.log('📦 Extraction du GTFS...');
    
    // Utiliser unzipper ou extraction manuelle
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(zipPath);
    const extractPath = path.join(__dirname, 'gtfs_data');
    
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
    }
    
    zip.extractAllTo(extractPath, true);
    
    console.log('📊 Parsing des fichiers GTFS...');
    
    // Parser stop_times.txt
    const stopTimesPath = path.join(extractPath, 'stop_times.txt');
    if (fs.existsSync(stopTimesPath)) {
      gtfsData.stopTimes = parseCSV(fs.readFileSync(stopTimesPath, 'utf-8'));
      console.log(`   - stop_times: ${gtfsData.stopTimes.length} entrées`);
    }
    
    // Parser trips.txt
    const tripsPath = path.join(extractPath, 'trips.txt');
    if (fs.existsSync(tripsPath)) {
      gtfsData.trips = parseCSV(fs.readFileSync(tripsPath, 'utf-8'));
      console.log(`   - trips: ${gtfsData.trips.length} entrées`);
    }
    
    // Parser calendar.txt
    const calendarPath = path.join(extractPath, 'calendar.txt');
    if (fs.existsSync(calendarPath)) {
      gtfsData.calendar = parseCSV(fs.readFileSync(calendarPath, 'utf-8'));
      console.log(`   - calendar: ${gtfsData.calendar.length} entrées`);
    }
    
    // Parser calendar_dates.txt
    const calendarDatesPath = path.join(extractPath, 'calendar_dates.txt');
    if (fs.existsSync(calendarDatesPath)) {
      gtfsData.calendarDates = parseCSV(fs.readFileSync(calendarDatesPath, 'utf-8'));
      console.log(`   - calendar_dates: ${gtfsData.calendarDates.length} entrées`);
    }
    
    // Filtrer uniquement les trips du métro (route TCAR:90)
    const metroTrips = gtfsData.trips.filter(t => t.route_id === 'TCAR:90');
    const metroTripIds = new Set(metroTrips.map(t => t.trip_id));
    
    // Filtrer les stop_times pour le métro uniquement
    gtfsData.stopTimes = gtfsData.stopTimes.filter(st => metroTripIds.has(st.trip_id));
    gtfsData.trips = metroTrips;
    
    console.log(`   - Après filtrage métro: ${gtfsData.trips.length} trips, ${gtfsData.stopTimes.length} stop_times`);
    
    gtfsData.loaded = true;
    gtfsData.lastUpdate = new Date();
    
    // Nettoyer le fichier zip
    fs.unlinkSync(zipPath);
    
    console.log('✅ GTFS chargé avec succès!');
    
  } catch (error) {
    console.error('❌ Erreur chargement GTFS:', error.message);
  }
}

// Parser CSV simple
function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx];
      });
      data.push(obj);
    }
  }
  
  return data;
}

// Parser une ligne CSV (gère les guillemets)
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  
  return values;
}

// Vérifier si un service est actif aujourd'hui
function isServiceActiveToday(serviceId) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10).replace(/-/g, '');
  const dayOfWeek = now.getDay(); // 0 = dimanche
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayOfWeek];
  
  // Vérifier les exceptions (calendar_dates)
  const exception = gtfsData.calendarDates.find(cd => 
    cd.service_id === serviceId && cd.date === today
  );
  
  if (exception) {
    return exception.exception_type === '1'; // 1 = ajouté, 2 = retiré
  }
  
  // Vérifier le calendrier normal
  const service = gtfsData.calendar.find(c => c.service_id === serviceId);
  if (!service) return false;
  
  // Vérifier les dates de validité
  if (today < service.start_date || today > service.end_date) {
    return false;
  }
  
  return service[dayName] === '1';
}

// Convertir "HH:MM:SS" en secondes depuis minuit
function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
}

// Obtenir les prochains passages statiques pour une station
function getStaticSchedule(stopId, direction) {
  if (!gtfsData.loaded) return [];
  
  const now = new Date();
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  
  // Trouver les trips actifs aujourd'hui dans la bonne direction
  const activeTrips = gtfsData.trips.filter(trip => {
    const dirMatch = (direction === 'boulingrin' && trip.direction_id === '1') ||
                     (direction !== 'boulingrin' && trip.direction_id === '0');
    return dirMatch && isServiceActiveToday(trip.service_id);
  });
  
  const activeTripIds = new Set(activeTrips.map(t => t.trip_id));
  
  // Trouver les stop_times pour cette station
  const stopTimes = gtfsData.stopTimes.filter(st => 
    st.stop_id === stopId && activeTripIds.has(st.trip_id)
  );
  
  // Convertir en timestamps et filtrer les passages futurs
  const upcomingStatic = [];
  
  stopTimes.forEach(st => {
    const arrivalSeconds = timeToSeconds(st.arrival_time);
    
    // Gérer les horaires après minuit (ex: 25:30:00)
    let arrivalTime;
    if (arrivalSeconds >= 86400) {
      // Après minuit = demain
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      arrivalTime = Math.floor(tomorrow.getTime() / 1000) + (arrivalSeconds - 86400);
    } else {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      arrivalTime = Math.floor(today.getTime() / 1000) + arrivalSeconds;
    }
    
    const nowTimestamp = Math.floor(Date.now() / 1000);
    
    if (arrivalTime > nowTimestamp) {
      const trip = activeTrips.find(t => t.trip_id === st.trip_id);
      upcomingStatic.push({
        arrival: arrivalTime,
        tripId: st.trip_id,
        isStatic: true,
        direction: direction === 'boulingrin' ? 'Boulingrin' : 
                   direction === 'gb' ? 'Georges Braque' : 'Technopôle',
        headsign: trip?.trip_headsign || ''
      });
    }
  });
  
  // Trier par heure d'arrivée et prendre les 5 premiers
  return upcomingStatic
    .sort((a, b) => a.arrival - b.arrival)
    .slice(0, 5);
}

// Route pour les données temps réel
app.get('/api/metro', async (req, res) => {
  try {
    const response = await fetch('https://gtfs.bus-tracker.fr/gtfs-rt/tcar/trip-updates.json');
    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error('Erreur API temps réel:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des données' });
  }
});

// Route pour les horaires statiques
app.get('/api/static', (req, res) => {
  const { stopId, direction } = req.query;
  
  if (!stopId || !direction) {
    return res.status(400).json({ error: 'Paramètres stopId et direction requis' });
  }
  
  if (!gtfsData.loaded) {
    return res.json({ 
      schedule: [], 
      message: 'GTFS non chargé' 
    });
  }
  
  const schedule = getStaticSchedule(stopId, direction);
  
  res.json({
    schedule,
    lastUpdate: gtfsData.lastUpdate
  });
});

// Route pour le statut GTFS
app.get('/api/gtfs-status', (req, res) => {
  res.json({
    loaded: gtfsData.loaded,
    lastUpdate: gtfsData.lastUpdate,
    stats: {
      trips: gtfsData.trips.length,
      stopTimes: gtfsData.stopTimes.length,
      calendar: gtfsData.calendar.length
    }
  });
});

app.use(express.static('public'));

// Démarrer le serveur
app.listen(PORT, async () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  
  // Charger le GTFS au démarrage
  await loadGTFS();
  
  // Recharger le GTFS toutes les 24h
  setInterval(loadGTFS, 24 * 60 * 60 * 1000);
});
