const express = require('express');
const cors = require('cors');
const pool = require('./src/utils/db.js');
const AppRoutes = require('./src/routes/appRoutes.js');


const app = express();
app.use(cors());
app.use(express.json({ type: '*/*' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('BizTrack running!');
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // console.log(`⏳ Starting server (pid ${process.pid}) — connecting to database...`);
    const dbConnection = await pool.connect();
    console.log('✅ Database connection established');
    dbConnection.release();

    app.use('/api/',AppRoutes);

    const server = app.listen(PORT, () => {
            console.log(`🚀 Server is running!`);
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use — another instance of the server is probably running. Stop it (or free the port) and try again.`);
        } else {
            console.error('❌ Server error:', error);
        }
        process.exit(1);
    });

  } catch (error) {
    // res.status(500).send('Error starting server: ' + error.message);
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer();
