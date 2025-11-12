// src/index.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "./db.js";
import { MongoStorage } from "./mongoStorage.js";
import UserManagementRoutes from "./routes/UsermanagementRoutes.js";
import AuthRoutes from "./routes/AuthRoutes.js";
import BusinessRoutes from "./routes/BusinessRoutes.js";
import path from 'path';
import { fileURLToPath } from 'url';

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
        // Connect to database
        await connectDB();

        // Create MongoStorage instance
        const storage = new MongoStorage();
        await storage.initialize();

        console.log("✅ Storage methods available:", {
            getBusinessByName: typeof storage.getBusinessByName,
            createBusiness: typeof storage.createBusiness,
            getUserByUsername: typeof storage.getUserByUsername,
            createUser: typeof storage.createUser
        });

        // Pass storage to all routes
        app.use("/api", UserManagementRoutes(storage));
        app.use("/api/auth", AuthRoutes(storage)); 
        app.use("/api/businesses", BusinessRoutes(storage));

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

        app.listen(PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

startServer();