// src/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./db.js";
import { storage } from "./storage.js";
import UserManagementRoutes from "./routes/UsermanagementRoutes.js";
import AuthRoutes from "./routes/AuthRoutes.js";
import BusinessRoutes from "./routes/BusinessRoutes.js";
import path from 'path';
import { fileURLToPath } from 'url';
import ProductRoutes from "./routes/kiosk/ProductRoutes.js";
import TransactionRoutes from "./routes/kiosk/TransactionRoutes.js";
import MpesaRoutes from "./routes/MpesaRoutes.js";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Serve static files from assets folder
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Standard body parsers for JSON and URL-encoded data.
// Multer will handle multipart/form-data for the file upload routes.
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Good practice for general form data
app.use(cors());

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Connect to database (no-op for Prisma — connects lazily)
        await connectDB();
        await storage.initialize();

        // Pass storage to all routes
        app.use("/api/users", UserManagementRoutes(storage));
        app.use("/api/auth", AuthRoutes(storage));
        app.use("/api/business", BusinessRoutes(storage));
        app.use("/api/products", ProductRoutes);
        app.use("/api/transactions", TransactionRoutes);
        app.use('/api/mpesa', MpesaRoutes);

        // Global business status check middleware for all authenticated routes
        // (Optional - if you want to enforce business status check globally)
        app.use('/api', (req, res, next) => {
            // Skip auth routes
            if (req.path.startsWith('/auth') || req.path === '/auth') {
                return next();
            }

            // For other API routes, we'll rely on route-specific middleware
            next();
        });

        app.get("/", (req, res) => {
            res.send("WELCOME TO ALVIN API");
        });

        app.get("/health", (req, res) => {
            res.status(200).json({
                status: "OK",
                message: "Server is running correctly",
                timestamp: new Date().toISOString(),
            });
        });

        // Error handling middleware
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

        app.listen(PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

startServer();