const express = require('express');
const cors = require('cors');
const pool = require('./src/utils/db.js');
const AppRoutes = require('./src/routes/appRoutes.js');
const path = require('path');
const storage = require('./src/utils/storage.js');


const app = express();
app.use(cors());
app.use(express.json({ type: '*/*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/assets', express.static(path.join(__dirname, 'assets')));


app.get('/', (req, res) => {
  res.send('BizTrack running!');
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Server is running correctly",
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);

  // Handle business disabled errors
  if (err.code === 'BUSINESS_DISABLED' || err.message?.includes('BUSINESS_DISABLED')) {
      return res.status(403).json({
          success: false,
          message: 'Your business account has been disabled. Please contact your administrator.',
          code: 'BUSINESS_DISABLED'
      });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
          success: false,
          message: 'Authentication failed. Please login again.',
          code: 'AUTH_ERROR'
      });
  }

  // Generic error
  res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});


const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // console.log(`⏳ Starting server (pid ${process.pid}) — connecting to database...`);
    const dbConnection = await pool.connect();
    console.log("Storage:", storage);
    console.log("Storage type:", typeof storage);
    console.log("Storage keys:", Object.keys(storage));
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
