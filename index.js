const http = require('http');
const express = require('express');
const mysql = require('mysql');
const WebSocket = require('ws');
const cors = require('cors');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'illuminiq'
};

const db = mysql.createConnection(dbConfig);

// Povezivanje na bazu podataka
db.connect((err) => {
  if (err) {
    console.error('Neuspješno povezivanje s bazom podataka:', err);
    process.exit(1);
  }
  console.log('Uspješno povezivanje s bazom podataka.');
});
// Adresa stranice s podacima
const url = 'http://192.168.4.1';

// Lista podataka
let dataList = [];
const fetchDataFromUrl = () => {
  http.get(url, (res) => {
    let data = '';
    // Dohvaćanje podataka sa stranice
    res.on('data', (chunk) => {
      data += chunk;
    });
    // Obrada podataka
    res.on('end', () => {
      if (data) {
        const pattern = /(PIR\s+(\d+)\s+(activated|deactivated)|ASC\s+(\d+)\s+(\d+))/gi;
        const matches = data.matchAll(pattern);

        const currentDataList = [];

        for (const match of matches) {
          if (match[1].startsWith('PIR')) {
            const sensorName = `PIR${match[2]}`;
            const sensorState = match[3].charAt(0).toUpperCase() + match[3].slice(1);
            currentDataList.push([sensorName, sensorState]);
          } else if (match[1].startsWith('ASC')) {
            const sensorName = `ASC${match[4]}`;
            const sensorState = match[5];
            currentDataList.push([sensorName, sensorState]);
          }
        }
        

        // Provjera prisutnosti podataka na listi i brisanje nepostojećih
        dataList = dataList.filter((item) => {
          return currentDataList.some(
            (currentItem) => currentItem[0] === item[0] && currentItem[1] === item[1]
          );
        });

        for (const currentData of currentDataList) {
          const foundIndex = dataList.findIndex(
            (item) => item[0] === currentData[0] && item[1] === currentData[1]
          );

          if (foundIndex === -1) {
            const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

            const sql = currentData[0].startsWith('ASC') ? `INSERT INTO senzor (naziv, stanje, vrijeme) VALUES ('${currentData[0]}', '${currentData[1]}', '${timestamp}')` : `INSERT INTO senzor (naziv, stanje, vrijeme) VALUES ('${currentData[0]}', '${currentData[1]}', '${timestamp}')`;


            db.query(sql, (err) => {
              if (err) {
                console.error('Greška prilikom spremanja podataka:', err);
              } else {
                console.log('Podaci uspješno spremljeni.');

                // Slanje podataka preko WebSocket-a
                const message = {
                  sensorName: currentData[0],
                 sensorState: currentData[0].startsWith('ASC') ? undefined : currentData[1],
                sensorValue: currentData[0].startsWith('ASC') ? currentData[1] : undefined,
                timestamp: timestamp
                };
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(message));
                  }
                });
              }
            });
          }
        }

        dataList = currentDataList;
      } else {
        console.log('Nisu pronađeni odgovarajući podaci.');
        // Brisanje svih podataka ako nisu pronađeni podaci
        dataList = [];
      }

      fetchDataFromUrl(); // Ponovno dohvaćanje podataka nakon obrade
    });
  }).on('error', (err) => {
    console.error('Greška prilikom dohvaćanja podataka:', err);
    // Ponovno dohvaćanje podataka nakon greške
    fetchDataFromUrl();
  });
};

// Pokretanje dohvaćanja podataka
fetchDataFromUrl();
const app = express();
const corsOptions = {
  origin: 'http://localhost:3000', // Postavite željenu domenu i port
  optionsSuccessStatus: 200 // Dodatna konfiguracija ako je potrebno
};

app.use(cors(corsOptions));
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

const PORT = process.env.PORT || 3001;

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  db.query('SELECT * FROM senzor;', (err, results) => {
    if (err) {
      console.error('Error fetching data from the database:', err);
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(results));
    }
  });

  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);
  });
});

// Ruta za brojanje aktivacija senzora
app.get('/count', (req, res) => {
  const sql = `SELECT naziv, COUNT(*) as count FROM senzor WHERE stanje = 'Activated' GROUP BY naziv`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching data from the database:', err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    res.json(results);
  });
});

// Ruta za dohvat ukupnog trajanja aktivnosti senzora
app.get('/total-duration', (req, res) => {
  const sql = `SELECT 
    activated.naziv,
    SUM(TIMESTAMPDIFF(SECOND, activated.vrijeme, deactivated.vrijeme)) as total_duration
  FROM
    (
      SELECT
        t1.id,
        t1.naziv,
        t1.vrijeme
      FROM 
        senzor t1
      WHERE 
        t1.stanje = 'Activated'
    ) as activated
  JOIN 
    (
      SELECT
        t2.id,
        t2.naziv,
        t2.vrijeme
      FROM 
        senzor t2
      WHERE 
        t2.stanje = 'Deactivated'
    ) as deactivated
  ON 
    activated.naziv = deactivated.naziv AND 
    activated.id < deactivated.id
  GROUP BY
    activated.naziv`;

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error fetching data from the database:', err);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }

    res.json(results);
  });
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
